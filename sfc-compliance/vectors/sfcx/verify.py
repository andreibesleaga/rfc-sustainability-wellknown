"""One scenario in, report out: the independent Python counterpart of the checker in lib/ (sfc-check.mjs), plus the pure-function scenarios."""
import re
from urllib.parse import urlsplit
from .base import A, DECLARED, DepthLimit, NumberOutOfRange, FAIL, INFO, NE, NOT_DECLARED, PASS, add_months, before, canonicalize, ed_verify, figure_ok, is_month_bound, month_of, parse_dec, parse_instant, read_ijson, round_half_even, row, same_host, text_hash, to_text, unb64u, without_sig
from .model import active_in, build_context, evidence_value, location_figures, norm_entry, replay, top_level, with_limits
from .decl import EXT, body_shape_rows, usable_period, claims_sfc, ext_of, label_of, level_of, mistyped_members, objects_of, read_as_absent, same_period_target
from .window import normalise_mechanism, time_info
from .deep import deep_check, derive_for
from .shallow import csfc2_disclosure, csfc5, declaration_uri_rows, event_uri_rows, s3, s6, select_annual

WORDS = [PASS, FAIL, NE, DECLARED, NOT_DECLARED, INFO]


def _has_evidence(o):
    return ext_of(o, "ledger-evidence-2") is not None


def _carbon_omitted(o):
    return _has_evidence(o) and all(o.get(k) is None for k in ("scope-2", "scope-3", "carbon-footprint"))


def _energy_omitted(o):
    return _has_evidence(o) and o.get("energy-consumption") is None


def _is_incomplete(o):
    return _energy_omitted(o) or _carbon_omitted(o)


def verdict_row(ctx, o, level):
    label = label_of(o)
    p = o.get("period") or {}
    if ctx is not None and _has_evidence(o) and usable_period(o) is not None:
        d = derive_for(ctx, o.get("updated"), o["period"], o, level)
        parts = (["silent: %s, %s, EnergyAttested" % (x["operator"], x["month"][:7]) for x in d["silentEnergy"]]
                 + ["silent: %s, %s, CarbonAttested" % (x["operator"], x["month"][:7]) for x in d["silentCarbon"]]
                 + ["no operator: %s" % m[:7] for m in d["noOperator"]])
        return row("VERDICT", "INCOMPLETE" if parts else "COMPLETE", "; ".join(sorted(parts)) or None, label)
    return row("VERDICT", "INCOMPLETE" if _is_incomplete(o) else "COMPLETE", None, label)


def summary_of(rows):
    s = {w: 0 for w in WORDS}
    for r in rows:
        if r["result"] in s:
            s[r["result"]] += 1
    return s


def effective_list(ctx, cutoff):
    st = replay(ctx, cutoff)
    out = []
    for k, v in st["E"].items():
        operator, type_, month = k.split("|")
        out.append({"operator": operator, "type": type_, "month": month, "hash": v["hash"]})
    out.sort(key=lambda x: (x["operator"] + x["type"] + x["month"]).encode("utf-16-be"))
    return out


def derived_for(ctx, spec):
    level = spec.get("level") or "network"
    decl = {"extensions": {EXT + "ledger-evidence-2": {"operators": [{"operator": spec.get("operator")}]}}} if spec.get("level") == "operator" else None
    d = derive_for(ctx, spec["cutoff"], spec["period"], decl, level)
    t = top_level(d, spec.get("energyUnit", "MWh"), spec.get("carbonUnit", "tCO2e"), spec.get("consensus", "proof-of-authority"), level)
    silent = (["%s %s EnergyAttested" % (x["operator"], x["month"][:7]) for x in d["silentEnergy"]]
              + ["%s %s CarbonAttested" % (x["operator"], x["month"][:7]) for x in d["silentCarbon"]]
              + ["no operator %s" % m[:7] for m in d["noOperator"]])
    return {
        "spec": spec, "incomplete": {"energy": d["incompleteEnergy"], "carbon": d["incompleteCarbon"]},
        "silent": sorted(silent, key=lambda s: s.encode("utf-16-be")),
        "evidence": evidence_value(d, level), "top": t["top"], "carbonNeutrality": t["carbonNeutrality"], "networkTopology": t["networkTopology"],
        "location": location_figures(d, spec.get("carbonUnit", "tCO2e")),
    }


LITERAL_LIMIT = "characters in a number literal"


def parse_text(text, limits):
    """(value, issues, error): error is ("syntax", message) or ("limit", name). A number that no binary64 value holds and whose literal is over the literal limit is a limit, never a syntax error."""
    try:
        value, issues = read_ijson(text)
        return value, issues, None
    except DepthLimit as e:
        return None, None, ("limit", e.limit)
    except NumberOutOfRange as e:
        if e.literal_length > limits["literalChars"]:
            return None, None, ("limit", LITERAL_LIMIT)
        return None, None, ("syntax", str(e))
    except ValueError as e:
        return None, None, ("syntax", str(e))


def no_read_rows(objs, cause):
    """D1 and C-SFC-7 for each object that points to ledger evidence when no read is held (9.2)."""
    out = []
    for o in objs:
        if _has_evidence(o):
            out.append(row("D1", NE, cause, label_of(o)))
            out.append(row("C-SFC-7", NE, cause, label_of(o)))
    return out


def excerpt_error_text(error):
    kind, text = error
    return "limit: " + text if kind == "limit" else "read is not valid JSON: " + text


def object_issues_of(doc, issues):
    """The reader's per-element findings aligned with objects_of(doc), or None without served text."""
    if issues is None:
        return None
    if not isinstance(doc, list):
        return [issues.elements[0]]
    return [issues.elements[i] for i, x in enumerate(doc) if isinstance(x, dict)]


def _host_of_uri(uri):
    try:
        return urlsplit(uri).hostname if isinstance(uri, str) else None
    except ValueError:
        return None


def retrieval_host_rows(network, retrieval_uri):
    """When the document was fetched, each network object whose target is not the retrieval host is noted (9.3 S4)."""
    host = _host_of_uri(retrieval_uri)
    if host is None:
        return []
    return [row("S4.info", INFO, "target differs from retrieval host", label_of(o)) for o in network if not same_host(o.get("target"), host)]


def verify_scenario(sc):
    sc = dict(sc)
    limits = with_limits(sc.get("limits"))
    excerpt_error = None
    if isinstance(sc.get("excerptText"), str) and len(sc["excerptText"].encode("utf-8", "surrogatepass")) > limits["readBytes"]:
        excerpt_error = ("limit", "bytes per read")
    elif isinstance(sc.get("excerptText"), str):
        value, issues, excerpt_error = parse_text(sc["excerptText"], limits)
        if excerpt_error is None:
            sc["excerpt"], sc["excerptIssues"] = value, issues
    rows = []
    body_issues = None
    has_body = "declarations" in sc
    doc = sc.get("declarations")
    if isinstance(sc.get("declarationText"), str):
        doc, body_issues, decl_error = parse_text(sc["declarationText"], limits)
        has_body = decl_error is None
        if decl_error is None and body_issues.max_literal > limits["literalChars"]:
            decl_error, has_body = ("limit", LITERAL_LIMIT), False
        if decl_error is not None:
            doc, body_issues = None, None
            rows.append(row("S2", FAIL, "not valid JSON: " + decl_error[1], None) if decl_error[0] == "syntax" else row("S2", NE, "limit: " + decl_error[1], None))
    # `served` is what S2, S3 and the URI rows read; `objs` has a wrong-typed member read as absent (every figure check reads these)
    served = objects_of(doc) if has_body else []
    objs = [read_as_absent(o) for o in served]
    object_issues = object_issues_of(doc, body_issues) if has_body else None
    if has_body:
        rows.extend(body_shape_rows(doc))
    raw_claims = isinstance(sc.get("declarationText"), str) and re.search(r'"%s"\s*:' % re.escape(EXT + "ledger-evidence-2"), sc["declarationText"]) is not None
    ctx = ti = None
    if sc.get("excerpt"):
        ctx = build_context(sc)
        ctx.limits = limits
        ctx.object_issues = object_issues
        ctx.served = served
        ti = time_info(ctx)
    T = sc.get("T") or sc.get("now") or (sc.get("excerpt") or {}).get("read-at")
    skew = limits["skewSeconds"]
    valid = (sc.get("consumer") or {}).get("valid") or []

    def s2valid(i):
        return not (i < len(valid) and valid[i] is False)

    if len(objs) > limits["declarationObjects"]:
        rows.append(row("S2", NE, "limit: objects in a declaration array"))
    else:
        for i, o in enumerate(served):
            rows.append(row("S2", PASS if s2valid(i) else FAIL, None, label_of(o)))
    rows.extend(declaration_uri_rows(served, sc.get("retrievalUri")))
    pair_rows = {}
    for idx, o in enumerate(objs):
        if o.get("carbon-accounting") != "location-based":
            continue
        primary = next((p for p in objs if p is not o and same_period_target(p, o) and p.get("carbon-accounting") != "location-based" and claims_sfc(p)
                        and (p.get("carbon-accounting") == "market-based" or _carbon_omitted(p))), None)
        if primary is None:
            pair_rows[idx] = row("PAIR", INFO, "unpaired object", label_of(o))
        elif _carbon_omitted(primary):
            pair_rows[idx] = row("PAIR", INFO, "location object not applicable (incomplete)", label_of(o))
    s3rows = {}
    for idx, o in enumerate(objs):
        if idx in pair_rows:
            continue
        claims = claims_sfc(o) or (raw_claims and len(objs) == 1)
        r = s3(served[idx], level_of(o), claims, sc.get("pins") or {}, object_issues[idx] if object_issues else None)
        s3rows[idx] = r
        rows.extend(r)
    net = [o for o in objs if o.get("target-type") == "service" and not isinstance((ext_of(o, "network-topology") or {}).get("member-of-network"), str)]
    if objs and T:
        target = sc.get("network") if sc.get("network") is not None else (net[0].get("target") if net else None)
        if target is not None:
            sel = select_annual(objs, target, T)
            rows.extend(retrieval_host_rows(net, sc.get("retrievalUri")))
            rows.extend(sel["rows"])
            if sel["selected"]:
                rows.append(csfc2_disclosure(sel["selected"], sel["primary"], _is_incomplete(sel["primary"]) if sel["primary"] else False))
    for idx, o in enumerate(objs):
        level = level_of(o)
        if idx in pair_rows:
            rows.append(pair_rows[idx])
            continue
        if ext_of(o, "ledger-evidence") is not None and ext_of(o, "ledger-evidence-2") is None:
            rows.append(row("LEGACY", INFO, "profile 1.1 evidence, pre-10 wire" if not s2valid(idx) else "profile 1.1 evidence, not an SFC 2.0 declaration", label_of(o)))
            rows.append(row("VERDICT", "NOT-APPLICABLE", None, label_of(o)))
            continue
        claims = claims_sfc(o) or (raw_claims and len(objs) == 1)
        if not claims:
            rows.append(row("VERDICT", "NOT-APPLICABLE", None, label_of(o)))
            continue
        if T:
            rows.append(csfc5(o, level, objs, T, skew, s2valid(idx), s3rows[idx]))
        rows.extend(s6(o, level, objs, label_of(o), mistyped_members(served[idx])))
        rows.append(verdict_row(ctx, o, level))
    if ctx is None:
        rows.extend(no_read_rows(objs, excerpt_error_text(excerpt_error) if excerpt_error else "no ledger read given"))
    if ctx is not None:
        rows.extend(event_uri_rows(ctx))
        with_ev = [o for o in objs if ext_of(o, "ledger-evidence-2") is not None]
        if with_ev:
            for o in with_ev:
                rows.extend(deep_check(ctx, ti, o, objs))
        else:
            rows.extend(deep_check(ctx, ti, None, objs))
    select = sc.get("select")
    out = [r for r in rows if any(r["id"] == s or r["id"].startswith(s + ".") for s in select)] if select else rows
    report = {"rows": out, "summary": summary_of(out)}
    if ctx is not None and sc.get("effectiveAt") is not None:
        report["effective"] = effective_list(ctx, sc["effectiveAt"])
    if ctx is not None and sc.get("derive"):
        report["derived"] = [derived_for(ctx, spec) for spec in sc["derive"]]
    return report


# ---- pure-function scenarios ------------------------------------------------------------------------------

_MECH_LIST = ["proof-of-work", "proof-of-stake", "proof-of-authority", "dag", "hybrid", "bft", "crash-fault-tolerant"]


def convert_1x_entry(entry):
    def month(date):
        return month_of(date + "T00:00:00Z")

    raw = [{"from": month(a["from"]), "to": None if a["to"] is None else add_months(month(a["to"]), 1)} for a in entry["active"]]
    raw.sort(key=lambda x: parse_instant(x["from"]))
    merged = []
    for iv in raw:
        last = merged[-1] if merged else None
        if last and (last["to"] is None or not before(last["to"], iv["from"])):
            if last["to"] is not None and (iv["to"] is None or before(last["to"], iv["to"])):
                last["to"] = iv["to"]
        else:
            merged.append(dict(iv))
    return {"active": merged, "keys": [{"jwk": k["public-jwk"], "validFromCommit": k["valid-from-commit"], "validToCommit": k["valid-to-commit"]} for k in entry["keys"]]}


def f_canonical(sc):
    out = []
    for v in sc["values"]:
        text = canonicalize(v)
        out.append({"canonical": text, "bytesHex": text.encode("utf-8").hex(), "sha256": text_hash(text)})
    return out


def f_ed25519(sc):
    out = []
    for c in sc["cases"]:
        ok, reason = ed_verify(bytes.fromhex(c["pub"]), bytes.fromhex(c["msg"]), bytes.fromhex(c["sig"]))
        out.append({"ok": True} if ok else {"ok": False, "reason": reason})
    return out


def f_event_hash(sc):
    event = sc["event"]
    rest = without_sig(event)
    text = canonicalize(rest)
    raw = unb64u(event["sig"]["value"]) or b""
    ok, _ = ed_verify(bytes.fromhex(sc["pub"]), text.encode("utf-8"), raw)
    return {"signingInput": text, "signingInputHex": text.encode("utf-8").hex(), "hash": text_hash(canonicalize(event)), "verified": ok}


def f_mechanism(sc):
    out = []
    for v in sc["values"]:
        n = normalise_mechanism(v)
        out.append({"normalised": n, "test1": "FAIL" if n == "proof-of-work" else ("PASS" if n in _MECH_LIST else "NOT-EVALUABLE")})
    return out


def f_registry_1x_to_2x(sc):
    entry = sc["entry"]
    conv = convert_1x_entry(entry)
    one = norm_entry(entry)
    two_raw = dict(entry)
    two_raw.update({"active": conv["active"], "keys": conv["keys"], "network": "x", "sig": {}})
    two = norm_entry(two_raw)
    m1 = [m for m in sc["months"] if active_in(one, m)]
    m2 = [m for m in sc["months"] if active_in(two, m)]
    return {"active": conv["active"], "keys": conv["keys"], "activeMonths1x": m1, "activeMonths20": m2, "same": m1 == m2}


def f_b64url(sc):
    out = []
    for s in sc["values"]:
        b = unb64u(s)
        out.append({"bytesHex": None if b is None else b.hex()})
    return out


def f_figure(sc):
    out = []
    for t in sc["texts"]:
        out.append({"ok": figure_ok(read_ijson(t)[0]) and re.fullmatch(r"(0|[1-9][0-9]*)(\.[0-9]+)?", t, A) is not None})
    return out


def f_round(sc):
    return [{"rounded": to_text(round_half_even(parse_dec(c["value"]), c["places"]))} for c in sc["cases"]]


FUNCS = {"canonical": f_canonical, "ed25519": f_ed25519, "eventHash": f_event_hash, "mechanism": f_mechanism,
         "registry1xTo2x": f_registry_1x_to_2x, "b64url": f_b64url, "figure": f_figure, "round": f_round}
