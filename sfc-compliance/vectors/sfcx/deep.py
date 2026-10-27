"""The deep check (9.4): D1 to D8 and C-SFC-7."""
import re
from .base import A, FAIL, INFO, NE, PASS, ZERO, add_months, at_or_before, before, canonicalize, cmp_instant, decode_point, due_of, from_number, hash_of, is_instant, is_month_bound, is_num_type, is_small_order, jlist, months_between, parse_instant, row, same_host, shift, text_hash
from .model import CARBON_SHIFT, ENERGY_SHIFT, METHODS, active_in, dec_of, derive, e_key, entry_shape, intervals_ordered, keys_valid_at, location_figures, methodology_pinned, month_of_event, pub, pub_of, r6, registrar_keys, replay, scope2_basis, sig_info, verify_under, void_infos
from .shallow import s3
from .decl import ext_of, label_of, level_of, same_period_target, scan_limits, usable_period
from .window import CAP_KWH, c6_follows_ledger, csfc4, window_facts, window_rows

D3_TOKENS = ["L1", "L2", "L3", "L5", "encoding", "weak"]
# limits on the size or count of the read itself: a read that hits one is not walked at all
STOPPING_LIMITS = ("bytes per read", "events per chain", "entries in voids", "entries in the Registry")
D5_TOKENS = ["L4", "L6", "L7", "L8", "L8b", "L9", "L10", "L11", "L11b", "L12"]


def type_short(t):
    return "Energy" if t == "EnergyAttested" else "Carbon"


def _ev_get(ev, k):
    return ev.event.get(k) if isinstance(ev.event, dict) else None


def ev_scope(ev):
    return "%s %s %s" % (_ev_get(ev, "subject"), type_short(_ev_get(ev, "type")), ev.commit)


def chain_key(ev):
    return "%s|%s" % (_ev_get(ev, "subject"), _ev_get(ev, "type"))


def derive_for(ctx, cutoff, period, decl, level):
    if level == "operator":
        e2 = ext_of(decl, "ledger-evidence-2") if decl else None
        ops = (e2 or {}).get("operators")
        operator = ops[0].get("operator") if isinstance(ops, list) and ops and isinstance(ops[0], dict) else None
        return derive(ctx, cutoff, period, [operator])
    return derive(ctx, cutoff, period)


def registry_signed_rows(ctx, decl, level, siblings, d2_rows, label):
    """D2.signed: the operator declaration's `signed` under a Registry key valid at T, once D2 authenticated the entry (7.2 rule 2)."""
    if level != "operator":
        return []
    ops = (ext_of(decl, "ledger-evidence-2") or {}).get("operators")
    operator = ops[0].get("operator") if isinstance(ops, list) and ops and isinstance(ops[0], dict) else None
    entry = ctx.by_operator.get(operator) if isinstance(operator, str) else None
    served_objs = getattr(ctx, "served", None)
    served = served_objs[siblings.index(decl)] if served_objs else decl   # the object as served: the signed payload is compared with it
    if entry is None or entry.form != "2x" or not isinstance(served.get("signed"), str):
        return []
    if not any(r["id"] == "D2.entry" and r["result"] == PASS and r.get("scope") == operator for r in d2_rows):
        return []
    t = ctx.sc.get("T") or ctx.sc.get("now") or ctx.read_at
    keys = [{"kty": "OKP", "crv": "Ed25519", "x": k["x"]} for k in keys_valid_at(entry, t) if isinstance(k.get("x"), str)]
    issues = getattr(ctx, "object_issues", None)
    result = s3(served, "operator", True, {"operatorKeys": keys}, issues[siblings.index(decl)] if issues else None)
    return [row("D2.signed", PASS, "verified under a Registry key valid at T", label)] if result[0]["result"] == PASS else []


def deep_check(ctx, ti, decl, siblings):
    rows = []
    label = label_of(decl) if decl else "read"
    updated = decl.get("updated") if decl else None
    e2 = ext_of(decl, "ledger-evidence-2") if decl else None
    level = level_of(decl) if decl else None
    hits = scan_limits(ctx.ex, ctx.limits, ctx.sc.get("excerptIssues"), ctx.params)
    ctx.limit_hits = hits
    limit_names = jlist([h["limit"] for h in hits])
    d1 = (PASS, None)
    if ctx.ex.get("excerpt-version") != 2:
        d1 = (NE, "excerpt version 1")
    elif hits:
        d1 = (NE, "limit: " + limit_names)
    elif decl and before(ctx.read_at, updated):
        d1 = (NE, "read-at before updated")
    elif decl and ti["stale"]:
        d1 = (NE, "stale read")
    rows.append(row("D1", d1[0], d1[1], label))
    stop = ctx.ex.get("excerpt-version") != 2 or any(h["limit"] in STOPPING_LIMITS for h in hits) or (decl and (before(ctx.read_at, updated) or ti["stale"]))
    profile_not_read = bool(e2 is not None and not (re.fullmatch(r"2\.[0-9]+", str(e2.get("profile-version")), A) and re.fullmatch(r"2\.[0-9]+", str(ctx.ex.get("profile-version")), A)))
    if stop:
        if decl:
            rows.append(row("C-SFC-7", NE, d1[1], label))
        return rows
    cutoff = updated if updated is not None else ti["anchor"]
    st = replay(ctx, cutoff)
    rows.append(ledger_order(ctx))
    period_ok = usable_period(decl) is not None
    rows.extend(d2(ctx, decl if period_ok else None, level, e2, label))
    if decl:
        rows.extend(registry_signed_rows(ctx, decl, level, siblings, rows, label))
    rows.extend(d3(ctx, st, cutoff, hits))
    rows.extend(d4(ctx, st, cutoff, decl, level, label))
    rows.extend(d5(ctx, st, cutoff, hits))
    period = decl["period"] if period_ok else None
    consensus = None
    if decl is not None:
        consensus = (ext_of(decl, "network-topology") or {}).get("consensus-mechanism")
    if consensus is None and siblings:
        consensus = next((x for x in ((ext_of(o, "network-topology") or {}).get("consensus-mechanism") for o in siblings) if isinstance(x, str)), None)
    w = window_rows(ctx, ti, consensus, not decl)
    if decl:
        months = months_between(period["start"], period["end"]) if period else []
        b = ("limit: " + limit_names) if hits else None
        if period:
            rows.extend(csfc4(ctx, months, updated, "period %s..%s" % (period["start"][:7], add_months(period["end"], -1)[:7]), b))
        else:
            rows.append(row("C-SFC-4", NE, "period not one month or one calendar year", label))
    if hits:
        for r in w["rows"]:
            rows.append(dict(r, result=NE, detail="limit: " + limit_names) if r["id"] in ("C-SFC-1", "C-SFC-2", "C-SFC-4") else r)
    else:
        rows.extend(w["rows"])
    if decl:
        rows.extend(d7(ctx, ti, decl, period, w, label))
    rows.append(row("D8", NE, "not performed", label))
    if decl and period and e2 is not None and not profile_not_read:
        d = derive_for(ctx, updated, period, decl, level)
        if d["status"] == "achieved" and not d["incompleteCarbon"] and d["footprint"] == 0 and d["Off"] == 0:
            rows.append(row("D6.info", INFO, "no emissions to cover", label))
    if decl:
        rows.append(c7(ctx, ti, decl, level, e2, period, siblings, rows, hits, profile_not_read, label))
    return mark_unauthenticated(rows, ctx, ti)


def mark_unauthenticated(rows, ctx, ti):
    """9.4 D2: with a D2.entry row NOT-EVALUABLE, a PASS of C-SFC-1, 2, 4 (and 6 when it follows C-SFC-2) reads NOT-EVALUABLE, after C-SFC-7 has read the rows."""
    if not any(r["id"] == "D2.entry" and r["result"] == NE for r in rows):
        return rows
    from_registry = {"C-SFC-1", "C-SFC-2", "C-SFC-4"}
    if c6_follows_ledger(ctx, window_facts(ctx, ti)):
        from_registry.add("C-SFC-6")
    return [dict(r, result=NE, detail="consistent but not authenticated") if r["result"] == PASS and r["id"] in from_registry else r for r in rows]


# ---- D2 -------------------------------------------------------------------------------------------------

def _attested_months(ctx):
    """The attested months of each subject, built once per read."""
    if "attestedMonths" not in ctx.cache:
        table = {}
        for e in ctx.events:
            subject = e.event.get("subject") if isinstance(e.event, dict) else None
            month = month_of_event(e)
            if isinstance(subject, str) and month is not None:
                table.setdefault(subject, set()).add(month)
        ctx.cache["attestedMonths"] = table
    return ctx.cache["attestedMonths"]


def d2(ctx, decl, level, e2, label):
    rows = []
    keys = registrar_keys(ctx)
    pinned = len(keys) > 0
    if decl and e2 is not None:
        period = decl.get("period")
        months = months_between(period["start"], period["end"]) if (is_month_bound((period or {}).get("start")) and is_month_bound((period or {}).get("end"))) else []
        entries = e2.get("operators") if isinstance(e2.get("operators"), list) else []
        if level == "network":
            active = [en for en in ctx.registry if any(active_in(en, m) for m in months)]
            a = jlist([en.operator for en in active])
            b = jlist([x.get("operator") if isinstance(x, dict) else None for x in entries])
            origins = True
            for x in entries:
                xo = x.get("operator") if isinstance(x, dict) else None
                en = ctx.by_operator.get(xo)
                eo = en.origin.lower() if en is not None and isinstance(en.origin, str) else None
                if eo is None or eo != str(x.get("origin") if isinstance(x, dict) else None).lower():
                    origins = False
            rows.append(row("D2.operator-set", PASS if (a == b and origins) else FAIL, None if a == b and origins else ("origin differs" if a == b else "operator set differs"), label))
            rows.append(row("D2.network", PASS if same_host(ctx.network, decl.get("target")) else FAIL, None, label))
        else:
            member = (ext_of(decl, "network-topology") or {}).get("member-of-network")
            first = entries[0] if entries and isinstance(entries[0], dict) else {}
            en = ctx.by_operator.get(first.get("operator"))
            ok_set = len(entries) == 1 and en is not None and same_host(en.origin, decl.get("target")) and any(active_in(en, m) for m in months)
            rows.append(row("D2.operator-set", PASS if ok_set else FAIL, None, label))
            if not isinstance(member, str):
                rows.append(row("D2.network", NE, "member-of-network missing", label))
            elif not same_host(ctx.network, member):
                rows.append(row("D2.network", FAIL, None, label))
            else:
                rows.append(row("D2.network", PASS if pinned else NE, None if pinned else "claimed, not authenticated", label))
    dup = []
    seen_op, seen_or = set(), set()
    for en in ctx.registry:
        if not isinstance(en.operator, str) or not isinstance(en.origin, str):
            continue
        if en.operator in seen_op:
            dup.append("operator " + en.operator)
        if en.origin.lower() in seen_or:
            dup.append("origin " + en.origin)
        seen_op.add(en.operator)
        seen_or.add(en.origin.lower())
    unordered = [en for en in ctx.registry if isinstance(en.operator, str) and not intervals_ordered(en)]
    fail_u = bool(dup) or any(en.form == "2x" for en in unordered)
    u_detail = dup + ["active " + en.operator for en in unordered]
    if dup or unordered:
        rows.append(row("D2.unique", FAIL if fail_u else INFO, jlist(u_detail), label))
    else:
        rows.append(row("D2.unique", PASS, None, label))
    two_x = {}
    for ev in ctx.events:
        if ev.kind == "2x" and month_of_event(ev):
            two_x.setdefault(ev.event["subject"], []).append(month_of_event(ev))
    for i, en in enumerate(ctx.registry):
        scope = en.operator if isinstance(en.operator, str) else "registry[%d]" % i
        rows.extend(entry_1x(ctx, en, scope) if en.form == "1x" else entry_2x(ctx, en, keys, pinned, two_x, scope))
    copy = ((ctx.ex.get("registrar") or {}).get("jwk") or {}).get("x")
    if copy is not None:
        if not pinned:
            rows.append(row("D2.registrar-copy", NE, "only source of the registrar key", label))
        else:
            rows.append(row("D2.registrar-copy", PASS if any(k["x"] == copy for k in keys) else FAIL, None, label))
    months = _attested_months(ctx)
    for en in ctx.registry:
        attested = months.get(en.operator, set())
        over = sorted(m for m in attested if not active_in(en, m) and any(iv["to"] is not None and at_or_before(iv["to"], m) for iv in en.intervals))
        if over:
            rows.append(row("D2.interval", FAIL, "interval closed over attested months: " + ", ".join(m[:7] for m in over), en.operator))
    st = replay(ctx, ctx.read_at)
    for ev in ctx.events:
        v = st["verdicts"].get(ev.i)
        if v and "L1" in v["reasons"] and v["month"] and ev.event.get("subject") in ctx.by_operator and not active_in(ctx.by_operator[ev.event["subject"]], v["month"]) \
                and ev.event.get("subject") == ev.event.get("actor") and (ev.kind == "1x" or same_host(ev.event.get("network"), ctx.network)):
            rows.append(row("D2.inactive-month", INFO, "%s %s" % (ev.event["subject"], v["month"][:7]), "%s @%s" % (type_short(ev.event.get("type")), ev.commit)))
    infos = void_infos(ctx)
    for v, i in zip(ctx.voids, infos):
        scope = "void @%s" % ((v.get("commit") if isinstance(v, dict) else None) if (isinstance(v, dict) and v.get("commit") is not None) else "-")
        if i["ok"]:
            rows.append(row("D2.void", PASS, None, scope))
            if i.get("status") == "former":
                rows.append(row("D2.void.info", INFO, "void signed under a former key", scope))
        elif i.get("unpinned"):
            rows.append(row("D2.void", NE, i["reason"], scope))
        else:
            rows.append(row("D2.void", FAIL if i.get("fail") else INFO, i["reason"] if i.get("fail") else "void ignored: " + i["reason"], scope))
    for en in ctx.registry:
        prior = ((ctx.sc.get("prior") or {}).get("versions") or {}).get(en.operator)
        if prior is not None and en.version is not None:
            rows.append(row("D2.rollback", FAIL if en.version < prior else PASS, "rollback" if en.version < prior else None, en.operator))
    return rows


def _entry_authenticated(ctx, en):
    digest = text_hash(canonicalize(en.raw))
    listed = methodology_pinned(ctx) and any(x.get("operator") == en.operator and x.get("sha256") == digest for x in ctx.params.get("registry-1x-digests") or [])
    return listed or digest in (ctx.pins.get("entries1x") or [])


def entry_1x(ctx, en, scope):
    ok = _entry_authenticated(ctx, en)
    return [row("D2.entry", PASS if ok else NE, "1.x entry authenticated by digest" if ok else "unsigned Registry entry not authenticated", scope)]


def entry_2x(ctx, en, keys, pinned, two_x, scope):
    raw = en.raw
    tokens = []
    if entry_shape(raw):
        tokens.append("shape")
    if not same_host(en.network, ctx.network):
        tokens.append("network")
    for k in en.keys:
        pub = pub_of(k)
        pt = decode_point(pub) if pub else None
        if not pt:
            tokens.append("key encoding")
        elif is_small_order(pt):
            tokens.append("weak key")
    if en.profile2_from:
        if any(before(m, en.profile2_from) for m in two_x.get(en.operator, [])):
            tokens.append("profile2From")
    if not isinstance(raw.get("sig"), dict):
        tokens.append("sig absent")
    if not pinned:
        return [row("D2.entry", NE, "registrar key not pinned", scope)]
    v = verify_under(keys, raw) if isinstance(raw.get("sig"), dict) else {"ok": False, "reason": "absent"}
    if isinstance(raw.get("sig"), dict) and not v["ok"]:
        tokens.append("sig encoding" if v["reason"] == "encoding" else "sig")
    out = [row("D2.entry", FAIL if tokens else PASS, jlist(tokens), scope)]
    if v["ok"] and v.get("status") == "former":
        out.append(row("D2.entry.info", INFO, "signed under a former key", scope))
    return out


# ---- D3 -------------------------------------------------------------------------------------------------

def chains_of(ctx, cutoff):
    m = {}
    for ev in ctx.events:
        if not is_instant(ev.commit) or not at_or_before(ev.commit, cutoff) or not isinstance(ev.event, dict) or not isinstance(ev.event.get("subject"), str):
            continue
        m.setdefault(chain_key(ev), []).append(ev)
    return m


def hit_for(hits, ev):
    return [h["limit"] for h in hits if h["event"] == ev.i]


def d3(ctx, st, cutoff, hits):
    rows = []
    for k, evs in chains_of(ctx, cutoff).items():
        op, type_ = k.split("|")
        result = PASS
        ev_rows = []
        for ev in evs:
            v = st["verdicts"][ev.i]
            sig = sig_info(ctx, ev)
            tokens, nes = [], []
            lim = hit_for(hits, ev)
            if lim:
                nes.append("limit: " + ", ".join(lim))
            if ev.hash != ev.computed:
                tokens.append("hash")
            for t in D3_TOKENS:
                if t in v["reasons"]:
                    tokens.append("weak key" if t == "weak" else t)
            if "L5:alg" in v["ne"]:
                nes.append("L5 alg %s" % sig["algName"])
            entry = ctx.by_operator.get(op)
            if entry is not None and entry.form == "1x" and not _entry_authenticated(ctx, entry) and "L5" not in tokens:
                nes.append("L5 entry not authenticated")
            if tokens:
                ev_rows.append(row("D3.event", FAIL, jlist(tokens), ev_scope(ev)))
                result = FAIL
            elif nes:
                ev_rows.append(row("D3.event", NE, jlist(nes), ev_scope(ev)))
                if result != FAIL:
                    result = NE
        rows.append(row("D3", result, "%d events" % len(evs), "%s %s" % (op, type_short(type_))))
        rows.extend(ev_rows)
    return rows


def _instant_key(t):
    p = parse_instant(t)
    return "%s.%s" % p if p else "bad:%s" % t


def ledger_order(ctx):
    bad = []
    for i in range(1, len(ctx.events)):
        a, b = ctx.events[i - 1], ctx.events[i]
        if is_instant(a.commit) and is_instant(b.commit) and cmp_instant(a.commit, b.commit) >= 0:
            bad.append("commit instants do not strictly increase")
    hashes = [e.hash for e in ctx.events]
    if len(set(hashes)) != len(hashes):
        bad.append("hash repeats")
    commits = set(_instant_key(e.commit) for e in ctx.events)
    vc = set()
    for v in ctx.voids:
        c = v.get("commit") if isinstance(v, dict) else None
        if _instant_key(c) in commits or _instant_key(c) in vc:
            bad.append("void commit not distinct")
        vc.add(_instant_key(c))
    return row("D3.order", FAIL if bad else PASS, ("ledger order: " + jlist(bad)) if bad else None, "ledger")


# ---- D4 -------------------------------------------------------------------------------------------------

def d4(ctx, st, cutoff, decl, level, label):
    rows = []
    ctx.unverified_takeovers = []
    for k, evs in chains_of(ctx, cutoff).items():
        op, type_ = k.split("|")
        tokens, infos = [], []
        unverified = False
        prevs = {}
        for ev in evs:
            p = ev.event.get("prev")
            if p is not None:
                prevs[p] = prevs.get(p, 0) + 1
        starts = [ev for i, ev in enumerate(evs) if i == 0 or ev.event.get("prev") is None]
        if any(n > 1 for n in prevs.values()):
            tokens.append("fork: shared prev")
        if len(starts) > 1:
            tokens.append("fork: more than one chain start")
        first0 = evs[0]
        take = next((x for x in ctx.params.get("takeovers") or [] if x.get("operator") == op and x.get("type") == type_), None)
        if first0 is not None and first0.event.get("prev") is not None:
            if not methodology_pinned(ctx):
                infos.append("takeover not verified (methodology document not pinned)")
                unverified = True
            elif take is None or take.get("tip") != first0.event.get("prev"):
                tokens.append("takeover link not listed")
        old = next((x for x in ctx.sc.get("oldLedgers") or [] if x.get("operator") == op and x.get("type") == type_), None)
        ne = False
        if take is not None and methodology_pinned(ctx):
            if old is None:
                ne = True
            else:
                hs = [hash_of(e) for e in old["chain"]]
                linked = all(e.get("prev") == (None if i == 0 else hs[i - 1]) for i, e in enumerate(old["chain"]))
                if not linked or hs[-1] != take.get("tip"):
                    tokens.append("cross-ledger fork")
        result = FAIL if tokens else (NE if (ne or unverified) else PASS)
        causes = tokens + (["old ledger unreachable"] if ne else []) + (["takeover not verified"] if unverified else [])
        rows.append(row("D4.chain", result, jlist(causes), "%s %s" % (op, type_short(type_))))
        if unverified:
            ctx.unverified_takeovers.append("%s %s" % (op, type_short(type_)))
        for i in infos:
            rows.append(row("D4.info", INFO, i, "%s %s" % (op, type_short(type_))))
    for ev in ctx.events:
        if is_instant(ev.commit) and before(ctx.read_at, ev.commit):
            rows.append(row("D4.event", FAIL, "commit after read-at", ev_scope(ev)))
    rows.extend(checkpoint_rows(ctx))
    if decl and decl.get("updated") and ext_of(decl, "ledger-evidence-2") is not None:
        rows.extend(declared_heads(ctx, st, cutoff, decl, level, label))
    return rows


_CP_KEYS = ["network", "read-at", "chains", "registry-digest", "ledger-digest", "voids-digest", "sig"]


def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _cp_chain_ok(c):
    return isinstance(c, dict) and isinstance(c.get("operator"), str) and isinstance(c.get("type"), str) and _is_int(c.get("count")) and c["count"] >= 0 and (c.get("tip") is None or isinstance(c["tip"], str)) and "tip" in c


def _cp_shape_ok(cp):
    """The member types the checks read: read-at an instant, chains an array of well-formed counts, digests strings."""
    chains = cp.get("chains") if "chains" in cp else []
    chains_ok = isinstance(chains, list) and all(_cp_chain_ok(c) for c in chains)
    digests_ok = all(m not in cp or isinstance(cp[m], str) for m in ("registry-digest", "ledger-digest", "voids-digest"))
    return is_instant(cp.get("read-at")) and chains_ok and digests_ok


def checkpoint_rows(ctx):
    cp = ctx.checkpoint
    if not cp:
        return [row("D4.checkpoint", INFO, "absent: ledger read not authenticated: commit instants and completeness are the source's claim", "checkpoint")]
    tokens = []
    if not isinstance(cp, dict) or any(k not in _CP_KEYS for k in cp):
        tokens.append("extra member")
    current = [k for k in registrar_keys(ctx) if k.get("status") == "current"]
    if not tokens and not _cp_shape_ok(cp):
        return [row("D4.checkpoint", FAIL, "mismatch: shape", "checkpoint")]
    if not tokens:
        if not current:
            return [row("D4.checkpoint", NE, "registrar key not pinned", "checkpoint")]
        if not verify_under(current, cp)["ok"]:
            tokens.append("signature")
        if not same_host(cp.get("network"), ctx.network) or cmp_instant(cp.get("read-at"), ctx.read_at) != 0:
            tokens.append("network or read-at")
        st = replay(ctx, ctx.read_at)
        missing = []
        for c in cp.get("chains") or []:
            chain = st["chains"].get("%s|%s" % (c.get("operator"), c.get("type")), [])
            if len(chain) == 0 and (c.get("count") or 0) > 0:
                missing.append("%s %s" % (c.get("operator"), type_short(c.get("type"))))
                continue
            tip = chain[-1]["hash"] if chain else None
            if tip != c.get("tip") or len(chain) != c.get("count"):
                tokens.append("chain %s %s" % (c.get("operator"), type_short(c.get("type"))))
        registry_sorted = sorted(ctx.ex.get("registry") or [], key=lambda x: x.get("operator").encode("utf-16-be"))
        if cp.get("registry-digest") is not None and cp["registry-digest"] != text_hash(canonicalize(registry_sorted)):
            tokens.append("registry-digest")
        if cp.get("ledger-digest") is not None and cp["ledger-digest"] != text_hash(canonicalize(ctx.ex.get("ledger"))):
            tokens.append("ledger-digest")
        vd = cp.get("voids-digest")
        if vd is not None and vd != text_hash(canonicalize(ctx.ex.get("voids") or [])):
            tokens.append("voids-digest")
        rows = [row("D4.checkpoint", FAIL if tokens else PASS, ("mismatch: " + jlist(tokens)) if tokens else "verified", "checkpoint")]
        ctx.missing_chains = sorted(set(missing), key=lambda s: s.encode("utf-16-be"))
        for m in ctx.missing_chains:
            rows.append(row("D4.info", INFO, "chain of %s not in read" % m, "checkpoint"))
        if not tokens and cp.get("ledger-digest") is None:
            rows.append(row("D4.info", INFO, "commit instants not authenticated: no ledger-digest", "checkpoint"))
        if not tokens and vd is None and (ctx.ex.get("voids") or []):
            rows.append(row("D4.info", INFO, "void acts not authenticated", "checkpoint"))
        return rows
    return [row("D4.checkpoint", FAIL, "mismatch: " + jlist(tokens), "checkpoint")]


def declared_heads(ctx, st, cutoff, decl, level, label):
    period = usable_period(decl)
    if period is None:
        return []
    d = derive_for(ctx, cutoff, period, decl, level)
    e2 = ext_of(decl, "ledger-evidence-2")
    bad = []
    for o in d["ops"]:
        x = next((y for y in (e2.get("operators") or []) if isinstance(y, dict) and y.get("operator") == o["operator"]), None)
        if x is None:
            continue
        if x.get("energy-head") != o["energyHead"]:
            bad.append("%s:energy-head" % o["operator"])
        if x.get("carbon-head") != o["carbonHead"]:
            bad.append("%s:carbon-head" % o["operator"])
        if x.get("energy-events") != o["energyEvents"]:
            bad.append("%s:energy-events" % o["operator"])
        if x.get("carbon-events") != o["carbonEvents"]:
            bad.append("%s:carbon-events" % o["operator"])
    return [row("D4.declared", FAIL if bad else PASS, jlist(bad), label)]


# ---- D5 -------------------------------------------------------------------------------------------------

def l9_gaps(ctx):
    """A chain the checkpoint lists and the read omits, and a chain whose takeover no pinned methodology document vouches for: L9 is unchecked for every chain."""
    out = []
    if ctx.missing_chains:
        out.append("chain of %s not in read" % ", ".join(ctx.missing_chains))
    unverified = getattr(ctx, "unverified_takeovers", None) or []
    if unverified:
        out.append("takeover not verified: %s" % ", ".join(unverified))
    return out


def d5(ctx, st, cutoff, hits):
    rows = []
    for k, evs in chains_of(ctx, cutoff).items():
        op, type_ = k.split("|")
        result = PASS
        ev_rows = []
        for ev in evs:
            v = st["verdicts"][ev.i]
            tokens = [t for t in D5_TOKENS if t in v["reasons"]]
            nes = [x for x in v["ne"] if x != "L5:alg"]
            if tokens:
                ev_rows.append(row("D5.event", FAIL, "%s; skipped" % jlist(tokens), ev_scope(ev)))
                result = FAIL
            elif nes:
                ev_rows.append(row("D5.event", NE, jlist(nes), ev_scope(ev)))
                if result != FAIL:
                    result = NE
            elif v["reasons"]:
                ev_rows.append(row("D5.event", INFO, "skipped (see D3)", ev_scope(ev)))
        detail = "%d events" % len(evs)
        if hits and result == PASS:
            result = NE
            detail = "limit: " + jlist([h["limit"] for h in hits])
        elif l9_gaps(ctx) and result == PASS:
            result = NE
            detail = "L9 not evaluable: " + "; ".join(l9_gaps(ctx))
        rows.append(row("D5", result, detail, "%s %s" % (op, type_short(type_))))
        rows.extend(ev_rows)
        for ev in evs:
            if ev.kind == "1x":
                rows.extend(notes_1x(ctx, st, ev, evs))
    rows.extend(late_filed(st))
    return rows


def late_filed(st):
    late = sorted(((k, v) for k, v in st["E"].items() if before(due_of(v["month"]), v["ev"].commit)), key=lambda kv: kv[0].encode("utf-16-be"))
    return [row("D5.late", INFO, "late-filed, retirement dates asserted only", ev_scope(v["ev"])) for _, v in late]


def notes_1x(ctx, st, ev, chain_events):
    v = st["verdicts"][ev.i]
    p = ev.event.get("payload") if isinstance(ev.event.get("payload"), dict) else {}
    out = []

    def note(t):
        out.append(row("D5.1x", INFO, t, ev_scope(ev)))

    if v["month"] is None:
        note("profile 1.x event, period not a month")
    if ev.event.get("type") == "EnergyAttested" and p.get("measurementMethod") not in METHODS:
        mm = p.get("measurementMethod")
        note("measurementMethod %s counts as third-party-modeled" % ("absent" if mm is None else mm))
    if ev.event.get("type") == "CarbonAttested":
        basis = scope2_basis(ctx, ev)
        if basis is None:
            note("scope 2 basis undeterminable")
        elif basis == "location-based":
            note("scope 2 on the location basis")
        for k in ("scope2KgCO2e", "scope3KgCO2e"):
            if is_num_type(p.get(k)) and p[k] < 0:
                note("negative %s read as is" % k)
        note("retirement rules L8b to L10 not applied")
    if v["month"] is not None:
        same = [o for o in chain_events if o.kind == "1x" and st["verdicts"][o.i]["month"] == v["month"]]
        if len(same) > 20 and same[0] is ev:
            note("more than 20 1.x events in month %s" % v["month"][:7])
    return out


# ---- D7 -------------------------------------------------------------------------------------------------

def c2_at(ctx, ti, f, cut):
    st = replay(ctx, cut)
    total = ZERO
    silent = False
    for en, m in f["opMonths"]:
        e = st["E"].get(e_key(en.operator, "EnergyAttested", m))
        if e:
            total += dec_of(e["ev"].event["payload"]["kWhConsumed"])
        else:
            silent = True
    if not f["opMonths"]:
        return NE
    if total >= CAP_KWH:
        return FAIL
    return NE if (silent or f["uncovered"]) else PASS


def d7(ctx, ti, decl, period, w, label):
    rows = []
    if not period:
        return rows
    months = months_between(period["start"], period["end"])
    later = replay(ctx, ctx.read_at)
    for ev in ctx.events:
        if not is_instant(ev.commit) or not before(decl["updated"], ev.commit) or not at_or_before(ev.commit, ctx.read_at):
            continue
        v = later["verdicts"].get(ev.i)
        if not v or v["skipped"] or v["month"] is None or v["month"] not in months:
            continue
        rows.append(row("D7", INFO, "superseded since publication", ev_scope(ev)))
    infos = void_infos(ctx)
    for v, i in zip(ctx.voids, infos):
        if not i["ok"] or not before(decl["updated"], v["commit"]) or not at_or_before(v["commit"], ctx.read_at):
            continue
        t = i["target"]
        m = month_of_event(t)
        if m is not None and m in months and before(t.commit, decl["updated"]):
            rows.append(row("D7", INFO, "superseded since publication", "void @%s" % v["commit"]))
    c4u = csfc4(ctx, months, decl["updated"], "period", None)[0]["result"]
    c4r = csfc4(ctx, months, ctx.read_at, "period", None)[0]["result"]
    rows.append(row("D7.C-SFC-4", INFO, "as of updated: %s; as of read-at: %s" % (c4u, c4r), label))
    f1 = window_facts(ctx, ti)
    rows.append(row("D7.C-SFC-2", INFO, "as of updated: %s; as of read-at: %s" % (c2_at(ctx, ti, f1, decl["updated"]), c2_at(ctx, ti, f1, ctx.read_at)), label))
    return rows


# ---- C-SFC-7 --------------------------------------------------------------------------------------------

def c7(ctx, ti, decl, level, e2, period, siblings, rows, hits, profile_not_read, label):
    if e2 is None:
        return row("C-SFC-7", NE, "no ledger-evidence-2", label)
    ne = []
    if profile_not_read:
        ne.append("profile-version not read")
    if not period:
        ne.append("period not one month or one calendar year")
    if level == "operator" and not isinstance((ext_of(decl, "network-topology") or {}).get("member-of-network"), str):
        ne.append("member-of-network missing")
    if hits:
        ne.append("limit: " + jlist([h["limit"] for h in hits]))
    l9ne = any(r["id"] == "D5.event" and r["result"] == NE and "L8b" in str(r.get("detail")) for r in rows) or bool(l9_gaps(ctx))
    if l9ne:
        ne.append("L9 not evaluable")
    if getattr(ctx, "unverified_takeovers", None):
        ne.append("takeover not verified: " + ", ".join(ctx.unverified_takeovers))
    failed = [r for r in rows if any(r["id"] == p or r["id"].startswith(p + ".") for p in ("D2", "D3", "D4", "D5")) and r["result"] == FAIL]
    tokens = []
    if period and not profile_not_read:
        d = derive_for(ctx, decl["updated"], period, decl, level)
        tokens = compare_declared(ctx, decl, e2, d, level, siblings)
        if d["has1x"]:
            ne.append("1.x-form event in counted months: " + jlist(d["events1x"]))
    fails = [("%s %s" % (r["id"], r.get("scope", ""))).strip() for r in failed] + tokens
    if fails:
        return row("C-SFC-7", FAIL, jlist(fails), label)
    if ne:
        return row("C-SFC-7", NE, jlist(ne), label)
    unauth = any(r["id"] == "D2.entry" and r["result"] == NE for r in rows) or any(r["id"] == "D4.checkpoint" and r["result"] == NE for r in rows)
    if unauth:
        return row("C-SFC-7", NE, "consistent but not authenticated", label)
    return row("C-SFC-7", PASS, None, label)


def _eq_pub(declared, exact):
    return is_num_type(declared) and declared == declared and declared not in (float("inf"), float("-inf")) and from_number(declared) == r6(exact)


def _conv2(x, sh):
    return shift(x, sh) if sh >= 0 else x * (10 ** -sh)


def compare_declared(ctx, obj, e2, d, level, siblings):
    bad = []
    entries = e2.get("operators") if isinstance(e2.get("operators"), list) else []
    for o in d["ops"]:
        x = next((y for y in entries if isinstance(y, dict) and y.get("operator") == o["operator"]), None)
        if x is None:
            continue

        def m(name, ok, op=o["operator"]):
            if not ok:
                bad.append("%s:%s" % (op, name))

        m("energy-head", x.get("energy-head") == o["energyHead"])
        m("carbon-head", x.get("carbon-head") == o["carbonHead"])
        m("energy-events", x.get("energy-events") == o["energyEvents"])
        m("carbon-events", x.get("carbon-events") == o["carbonEvents"])
        m("kwh", _eq_pub(x.get("kwh"), o["kwh"]))
        m("scope1-kgco2e", _eq_pub(x.get("scope1-kgco2e"), o["s1"]))
        m("scope2-kgco2e", _eq_pub(x.get("scope2-kgco2e"), o["s2"]))
        m("scope3-kgco2e", _eq_pub(x.get("scope3-kgco2e"), o["s3"]))
        m("offsets-kgco2e", _eq_pub(x.get("offsets-kgco2e"), o["off"]))
        if not d["has1x"]:
            m("offset-coverage-every-period", x.get("offset-coverage-every-period") == o["coverage"])
    if level == "network":
        if not d["has1x"] and e2.get("network-offset-coverage") != d["networkCoverage"]:
            bad.append("network-offset-coverage")
    elif "network-offset-coverage" in e2:
        bad.append("network-offset-coverage present")
    es, cs = ENERGY_SHIFT.get(obj.get("energy-unit")), CARBON_SHIFT.get(obj.get("carbon-unit"))
    tn = ext_of(obj, "carbon-neutrality") or {}
    topo = ext_of(obj, "network-topology") or {}
    if obj.get("energy-consumption") is not None:
        if es is None or d["incompleteEnergy"] or not _eq_pub(obj["energy-consumption"], _conv2(d["E"], es)):
            bad.append("top:energy-consumption")
    for name, exact in (("scope-1", d["S1"]), ("scope-2", d["S2"]), ("scope-3", d["S3"]), ("carbon-footprint", d["footprint"])):
        if obj.get(name) is not None and (cs is None or d["incompleteCarbon"] or not _eq_pub(obj[name], _conv2(exact, cs))):
            bad.append("top:" + name)
    if tn.get("offsets-retired-tCO2e") is not None and (d["incompleteCarbon"] or not _eq_pub(tn["offsets-retired-tCO2e"], shift(d["Off"], 3))):
        bad.append("top:offsets-retired-tCO2e")
    ci = obj.get("carbon-intensity-gCO2e-per-kWh")
    if ci is not None:
        inc = d["incompleteEnergy"] or d["incompleteCarbon"] or d["E"] == 0
        if inc or from_number(ci) != r6(d["S2"] * 1000 / d["E"]):
            bad.append("top:carbon-intensity-gCO2e-per-kWh")
    if tn.get("net-zero-status") is not None and not d["has1x"] and tn["net-zero-status"] != d["status"]:
        bad.append("top:net-zero-status")
    if level == "network" and topo.get("validated-node-count") is not None and (d["incompleteEnergy"] or topo["validated-node-count"] != d["nodes"]):
        bad.append("top:validated-node-count")
    carbon_omitted = all(obj.get(k) is None for k in ("scope-2", "scope-3", "carbon-footprint"))
    paired = None
    if not carbon_omitted:
        paired = next((o for o in (siblings or []) if o is not obj and same_period_target(o, obj) and o.get("carbon-accounting") == "location-based"), None)
    if paired is not None:
        loc = location_figures(d, paired.get("carbon-unit"))
        if not loc:
            bad.append("paired:not publishable")
        else:
            for name in ("scope-2", "carbon-footprint", "carbon-intensity-gCO2e-per-kWh"):
                if paired.get(name) is not None and (name not in loc or from_number(paired[name]) != from_number(loc[name])):
                    bad.append("paired:" + name)
        pes = ENERGY_SHIFT.get(paired.get("energy-unit"))
        if paired.get("energy-consumption") is not None and (pes is None or d["incompleteEnergy"] or not _eq_pub(paired["energy-consumption"], _conv2(d["E"], pes))):
            bad.append("paired:energy-consumption")
    return bad
