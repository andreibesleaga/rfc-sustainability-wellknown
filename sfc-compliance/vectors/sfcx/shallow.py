"""The shallow check (9.3): S3, S6, tolerance rule, S4, C-SFC-2 disclosure form, C-SFC-5, URIs."""
import re
from fractions import Fraction
from urllib.parse import urljoin
from .base import A, DepthLimit, DECLARED, FAIL, INFO, NE, PASS, add_calendar_months, at_or_before, before, canonicalize, ed_verify, epoch, figure_ok, from_number, is_hex64, is_host, is_https_uri, is_instant, is_int, is_month_bound, is_num, is_num_type, jlist, number_text, read_ijson, row, same_target, shift, to_text, unb64u
from .model import ENERGY_SHIFT, CARBON_SHIFT
from .decl import ext_of, label_of, same_period_target
from .window import CAP_KWH

METRICS = ["energy-consumption", "carbon-footprint", "scope-1", "scope-2", "scope-3", "carbon-intensity-gCO2e-per-kWh", "renewable-energy", "sci-score", "estimated-annual-emissions-kgCO2e"]
_MAC = re.compile(r"HS\d+", A)


def digits_after_point(x):
    t = number_text(x)
    i = t.find(".")
    return 0 if i < 0 else len(t) - i - 1


def _deep_equal(a, b):
    return canonicalize(a) == canonicalize(b)


# ---- S3 -------------------------------------------------------------------------------------------------

def s3(obj, level, claims, pins, body_issues):
    label = label_of(obj)
    if not isinstance(obj.get("signed"), str):
        return [row("S3", INFO, "not signed", label)]
    fail, info = [], []

    def bad(msg):
        (fail if claims else info).append(msg)

    parts = obj["signed"].split(".")
    if len(parts) != 3:
        return [row("S3", FAIL if claims else INFO, "malformed JWS", label)]
    hdr_b, pay_b, sig_b = unb64u(parts[0]), unb64u(parts[1]), unb64u(parts[2])
    if hdr_b is None or pay_b is None or sig_b is None:
        return [row("S3", FAIL if claims else INFO, "malformed JWS", label)]
    try:
        header, hdr_issues = read_ijson(hdr_b.decode("utf-8"))
    except DepthLimit as e:
        return [row("S3", NE, "limit: " + e.limit, label)]
    except ValueError:
        return [row("S3", FAIL if claims else INFO, "malformed header", label)]
    if hdr_issues.duplicates or hdr_issues.lone_surrogate:
        return [row("S3", FAIL if claims else INFO, "malformed header", label)]
    try:
        payload, pay_issues = read_ijson(pay_b.decode("utf-8"))
    except DepthLimit as e:
        return [row("S3", NE, "limit: " + e.limit, label)]
    except ValueError:
        return [row("S3", FAIL if claims else INFO, "malformed payload", label)]
    served = {k: v for k, v in obj.items() if k != "signed"}
    dupes = (body_issues is not None and (len(body_issues.duplicates) > 0 or body_issues.lone_surrogate)) or len(pay_issues.duplicates) > 0 or pay_issues.lone_surrogate
    if dupes:
        if claims:
            fail.append("duplicate member or lone surrogate")
        else:
            info.append("signed payload differs")
    elif not _deep_equal(payload, served):
        if claims:
            fail.append("signed payload differs")
        else:
            info.append("signed payload differs")
    rejected = (
        not isinstance(header, dict) or not isinstance(header.get("alg"), str) or header["alg"] == "none"
        or bool(_MAC.fullmatch(header["alg"])) or header.get("cty") != "sustainability-data+json" or "crit" in header
    )
    if rejected:
        bad("signature rejected")
    alg = header.get("alg") if isinstance(header, dict) else None
    if not rejected:
        if level == "operator" and claims and alg != "Ed25519":
            fail.append("operator declaration must use Ed25519")
        elif alg == "ES256":
            info.append("signed, not verified against a pinned key")
        elif alg != "Ed25519":
            info.append("algorithm not supported")
        else:
            keys = (pins.get("operatorKeys") if level == "operator" else pins.get("publisherKeys")) or []
            if not keys:
                if "signed payload differs" not in info:
                    info.append("signed, not verified against a pinned key")
            else:
                msg = ("%s.%s" % (parts[0], parts[1])).encode("ascii")
                ok = False
                for k in keys:
                    pub = unb64u(k["x"])
                    if pub and ed_verify(pub, msg, sig_b)[0]:
                        ok = True
                        break
                if ok:
                    if not fail and "signed payload differs" not in info:
                        return [row("S3", PASS, "verified under a pinned key", label)]
                else:
                    bad("signature rejected")
    if fail:
        return [row("S3", FAIL, jlist(fail), label)]
    return [row("S3", INFO, jlist(info), label)]


# ---- extension values ---------------------------------------------------------------------------------

_NZ = ["achieved", "partial", "not-achieved"]


def ext_tokens(obj, level, has_evidence, energy_omitted):
    """(tokens, notes): tokens FAIL S6 a; notes are INFO (mixed levels on an object without ledger evidence)."""
    t, notes = [], []
    hw = ext_of(obj, "hardware-lifecycle")
    if hw is not None:
        if not isinstance(hw.get("general-purpose-hardware"), bool):
            t.append("hardware-lifecycle.general-purpose-hardware")
        if not isinstance(hw.get("single-use-asic-required"), bool):
            t.append("hardware-lifecycle.single-use-asic-required")
    cn = ext_of(obj, "carbon-neutrality")
    if cn is not None and cn.get("net-zero-status") not in _NZ:
        t.append("carbon-neutrality.net-zero-status")
    tp = ext_of(obj, "network-topology")
    if tp is not None:
        net_members = any(k in tp for k in ("consensus-mechanism", "validated-node-count", "node-count-validation-method", "per-transaction-energy-Wh", "nakamoto-coefficient", "geographic-regions"))
        op_members = any(k in tp for k in ("member-of-network", "network-declaration"))
        if net_members and op_members:
            (t if has_evidence else notes).append("network-topology.mixed-levels")
        if level == "network":
            if not isinstance(tp.get("consensus-mechanism"), str):
                t.append("network-topology.consensus-mechanism")
            if not energy_omitted:
                if not is_int(tp.get("validated-node-count")):
                    t.append("network-topology.validated-node-count")
                if not isinstance(tp.get("node-count-validation-method"), str):
                    t.append("network-topology.node-count-validation-method")
        elif has_evidence and not is_host(tp.get("member-of-network")):
            t.append("network-topology.member-of-network")
    return t, notes


def evidence_tokens(ev, level):
    t = []
    if not re.fullmatch(r"2\.[0-9]+", str(ev.get("profile-version")), A):
        t.append("ledger-evidence-2.profile-version")
    if not is_https_uri(ev.get("ledger-access-uri")):
        t.append("ledger-evidence-2.ledger-access-uri")
    ops = ev.get("operators")
    if not isinstance(ops, list) or len(ops) < 1:
        t.append("ledger-evidence-2.operators")
    else:
        for i, o in enumerate(ops):
            ok = (isinstance(o, dict) and isinstance(o.get("operator"), str) and is_host(o.get("origin"))
                  and (o.get("energy-head", False) is None or is_hex64(o.get("energy-head"))) and (o.get("carbon-head", False) is None or is_hex64(o.get("carbon-head")))
                  and is_int(o.get("energy-events")) and is_int(o.get("carbon-events"))
                  and all(is_num(o.get(k), 0) for k in ("kwh", "scope1-kgco2e", "scope3-kgco2e", "offsets-kgco2e"))
                  and is_num_type(o.get("scope2-kgco2e")) and isinstance(o.get("offset-coverage-every-period"), bool))
            if not ok:
                t.append("ledger-evidence-2.operators[%d]" % i)
    if level == "network" and not isinstance(ev.get("network-offset-coverage"), bool):
        t.append("ledger-evidence-2.network-offset-coverage")
    return t


def _carbon_group_omitted(obj):
    return all(obj.get(k) is None for k in ("scope-2", "scope-3", "carbon-footprint"))


def missing_74(obj, ev):
    m = []
    energy_omitted = obj.get("energy-consumption") is None
    carbon_omitted = _carbon_group_omitted(obj)
    if ev is None:
        return m, energy_omitted, carbon_omitted
    tn = ext_of(obj, "carbon-neutrality") or {}
    if obj.get("measurement-method") is None:
        m.append("measurement-method")
    if not energy_omitted and obj.get("energy-unit") is None:
        m.append("energy-unit")
    ops = ev.get("operators") if isinstance(ev.get("operators"), list) else []
    if not carbon_omitted:
        for k in ("scope-2", "scope-3", "carbon-footprint", "carbon-unit", "carbon-accounting"):
            if obj.get(k) is None:
                m.append(k)
        if tn.get("offsets-retired-tCO2e") is None:
            m.append("offsets-retired-tCO2e")
        s1 = any(isinstance(o, dict) and is_num_type(o.get("scope1-kgco2e")) and o["scope1-kgco2e"] > 0 for o in ops)
        if s1 and obj.get("scope-1") is None:
            m.append("scope-1")
    if not energy_omitted and not carbon_omitted and obj.get("carbon-intensity-gCO2e-per-kWh") is None and not all(isinstance(o, dict) and o.get("kwh") == 0 for o in ops):
        m.append("carbon-intensity-gCO2e-per-kWh")
    if ext_of(obj, "carbon-neutrality") is None:
        m.append("carbon-neutrality")
    if ext_of(obj, "network-topology") is None:
        m.append("network-topology")
    if ext_of(obj, "ledger-evidence-2") is None:
        m.append("ledger-evidence-2")
    return m, energy_omitted, carbon_omitted


# ---- tolerance rule ---------------------------------------------------------------------------------------

def _half(k):
    return Fraction(1, 2 * 10 ** k)


def _val(x):
    return from_number(x)


def _conv(x, frm, to):
    return _val(x) * Fraction(10) ** (frm - to)


def _term(x, k, sh, tol=True):
    return {"x": x, "k": k, "shift": sh, "tol": tol}


def tolerance_pass(P, kP, sp, terms):
    total = Fraction(0)
    tol = _half(kP)
    for t in terms:
        total += _conv(t["x"], t["shift"], sp)
        if t["tol"]:
            tol += _half(t["k"]) * Fraction(10) ** (t["shift"] - sp)
    diff = abs(_val(P) - total)
    return {"ok": diff <= tol, "diff": diff, "tol": tol}


def q_text(a):
    d = a.denominator
    twos = fives = 0
    while d % 2 == 0:
        d //= 2
        twos += 1
    while d % 5 == 0:
        d //= 5
        fives += 1
    if d != 1:
        return "%d/%d" % (a.numerator, a.denominator)
    return to_text(a)


# ---- S6 -------------------------------------------------------------------------------------------------

def s6(obj, level, siblings, label, mistyped=None):
    rows = []
    ev = ext_of(obj, "ledger-evidence-2")
    has_ev = ev is not None
    if level == "network":
        m, energy_omitted, _ = missing_74(obj, ev)
    else:
        m, energy_omitted = [], obj.get("energy-consumption") is None
    if has_ev and not re.fullmatch(r"2\.[0-9]+", str(ev.get("profile-version")), A):
        return [row("S6", INFO, "profile %s not read" % ev.get("profile-version"), label)]
    ext, notes = ext_tokens(obj, level, has_ev, energy_omitted)
    tokens = ext + (evidence_tokens(ev, level) if has_ev else []) + (["missing:" + x for x in m] if level == "network" else [])
    rows.append(row("S6.a", FAIL if tokens else PASS, jlist(tokens), label))
    for text in notes + ["member %s has the wrong type" % name for name in (mistyped or [])]:
        rows.append(row("S6.a.info", INFO, text, label))
    entries = [o for o in ev["operators"] if isinstance(o, dict)] if has_ev and isinstance(ev.get("operators"), list) else []
    es, cs = ENERGY_SHIFT.get(obj.get("energy-unit")), CARBON_SHIFT.get(obj.get("carbon-unit"))

    def k_of(x):
        return 6 if has_ev else digits_after_point(x)

    if has_ev:
        bad = []
        energy_group_omitted = obj.get("energy-consumption") is None
        carbon_group_omitted = _carbon_group_omitted(obj)

        def mk(member, P, name, base, sp):
            sum_positive = any(is_num_type(o.get(name)) and o[name] > 0 for o in entries)
            group_omitted = energy_group_omitted if member == "energy-consumption" else carbon_group_omitted
            if P is None:
                if sum_positive and not group_omitted:
                    bad.append("%s absent" % member)
                return
            if sp is None:
                bad.append("%s unit" % member)
                return
            r = tolerance_pass(P, k_of(P), sp, [_term(o.get(name), 6, base) for o in entries])
            if not r["ok"]:
                bad.append(member)

        mk("energy-consumption", obj.get("energy-consumption"), "kwh", 0, es)
        mk("scope-1", obj.get("scope-1"), "scope1-kgco2e", 0, cs)
        mk("scope-2", obj.get("scope-2"), "scope2-kgco2e", 0, cs)
        mk("scope-3", obj.get("scope-3"), "scope3-kgco2e", 0, cs)
        off = (ext_of(obj, "carbon-neutrality") or {}).get("offsets-retired-tCO2e")
        if off is not None:
            if not tolerance_pass(off, k_of(off), 3, [_term(o.get("offsets-kgco2e"), 6, 0) for o in entries])["ok"]:
                bad.append("offsets-retired-tCO2e")
        rows.append(row("S6.b", FAIL if bad else PASS, jlist(bad), label))
    else:
        rows.append(row("S6.b", INFO, "not derivable: no ledger-evidence-2", label))
    if obj.get("carbon-footprint") is not None:
        if obj.get("scope-2") is None or obj.get("scope-3") is None:
            rows.append(row("S6.c", NE, "%s absent" % ("scope-2" if obj.get("scope-2") is None else "scope-3"), label))
        elif cs is None:
            rows.append(row("S6.c", NE, "carbon-unit absent", label))
        else:
            ts = [_term(obj[k], k_of(obj[k]), cs) for k in ("scope-1", "scope-2", "scope-3") if obj.get(k) is not None]
            r = tolerance_pass(obj["carbon-footprint"], k_of(obj["carbon-footprint"]), cs, ts)
            if r["ok"]:
                rows.append(row("S6.c", PASS, None, label))
            else:
                rows.append(row("S6.c", FAIL if has_ev else INFO, "%sdifference %s > tolerance %s" % ("" if has_ev else "not derivable: ", q_text(r["diff"]), q_text(r["tol"])), label))
    P = obj.get("carbon-intensity-gCO2e-per-kWh")
    if P is not None and obj.get("scope-2") is not None and obj.get("energy-consumption") is not None and es is not None and cs is not None:
        rows.append(s6d(obj, entries, has_ev, label))
    if level == "network":
        if has_ev and entries:
            conj = all(o.get("offset-coverage-every-period") is True for o in entries)
            noc = ev.get("network-offset-coverage")
            rows.append(row("S6.e", PASS if noc is conj else FAIL, None if noc is conj else "network-offset-coverage differs from the conjunction", label))
    elif has_ev:
        present = "network-offset-coverage" in ev
        rows.append(row("S6.e", FAIL if present else PASS, "present at operator level" if present else None, label))
    nz = (ext_of(obj, "carbon-neutrality") or {}).get("net-zero-status")
    if nz is not None:
        rows.append(s6f(level, ev, entries, nz, label) if has_ev else s6f_no_ledger(obj, nz, cs, label))
    for name, present in (("hardware-lifecycle", ext_of(obj, "hardware-lifecycle") is not None), ("net-zero-status", nz is not None),
                          ("validated-node-count", is_int((ext_of(obj, "network-topology") or {}).get("validated-node-count"))), ("renewable-energy", obj.get("renewable-energy") is not None)):
        if present:
            rows.append(row("S6.g", DECLARED, name, label))
    if ext_of(obj, "ledger-evidence") is not None:
        rows.append(row("S6.h", INFO, "superseded name present", label))
    paired = next((o for o in (siblings or []) if o is not obj and same_period_target(o, obj) and o.get("carbon-accounting") == "location-based"), None)
    if paired is not None and obj.get("carbon-accounting") == "market-based":
        rows.append(s6i(obj, paired, has_ev, label))
    return rows


def s6d(obj, entries, has_ev, label):
    es, cs = ENERGY_SHIFT.get(obj.get("energy-unit")), CARBON_SHIFT.get(obj.get("carbon-unit"))
    P = obj.get("carbon-intensity-gCO2e-per-kWh")

    def k_of(x):
        return 6 if has_ev else digits_after_point(x)

    S = _conv(obj["scope-2"], cs, 0)
    E = _conv(obj["energy-consumption"], es, 0)
    dS = _half(k_of(obj["scope-2"])) * Fraction(10) ** cs
    dE = _half(k_of(obj["energy-consumption"])) * Fraction(10) ** es
    if E == 0:
        entries_zero = all(o.get("kwh") == 0 for o in entries)
        if has_ev and entries_zero:
            return row("S6.d", PASS if P is None else FAIL, None if P is None else "present with zero energy", label)
        return row("S6.d", NE, "published energy is 0", label)
    denom = E - dE
    if denom <= 0:
        return row("S6.d", NE, "energy below its half unit", label)
    Qv = S * 1000 / E
    slack = (S + dS) * 1000 / denom - Qv
    tol = _half(k_of(P)) + slack
    diff = abs(Qv - _val(P))
    ok = diff <= tol
    return row("S6.d", PASS if ok else (FAIL if has_ev else INFO), None if ok else "%sdifference exceeds tolerance" % ("" if has_ev else "not derivable: "), label)


def s6f_no_ledger(obj, nz, cs, label):
    off = (ext_of(obj, "carbon-neutrality") or {}).get("offsets-retired-tCO2e")
    fp = obj.get("carbon-footprint")
    if fp is None or cs is None:
        return row("S6.f", INFO, "not derivable: no carbon-footprint", label)
    off_kg = Fraction(0) if off is None else _val(off) * 1000
    fp_kg = _conv(fp, cs, 0)
    expect = "achieved" if off_kg >= fp_kg else ("not-achieved" if off_kg == 0 else "partial")
    zero = fp_kg == 0 and off_kg == 0
    detail = ("consistent" if expect == nz else "expected %s" % expect) + ("; no emissions to cover" if zero and expect == "achieved" else "")
    return row("S6.f", INFO, detail, label)


def s6f(level, ev, entries, nz, label):
    if not entries:
        return row("S6.f", INFO, "not derivable", label)
    F = ev.get("network-offset-coverage") if level == "network" else entries[0].get("offset-coverage-every-period")
    off = Fraction(0)
    for o in entries:
        off += from_number(o.get("offsets-kgco2e") if o.get("offsets-kgco2e") is not None else 0)
    expect = "achieved" if F is True else ("not-achieved" if off == 0 else "partial")
    return row("S6.f", PASS if expect == nz else FAIL, None if expect == nz else "expected %s" % expect, label)


def s6i(primary, paired, has_ev, label):
    bad = []
    es, pes = ENERGY_SHIFT.get(primary.get("energy-unit")), ENERGY_SHIFT.get(paired.get("energy-unit"))
    c1, pc = CARBON_SHIFT.get(primary.get("carbon-unit")), CARBON_SHIFT.get(paired.get("carbon-unit"))

    def k_of(x):
        return 6 if has_ev else digits_after_point(x)

    if paired.get("energy-consumption") is not None and primary.get("energy-consumption") is not None:
        if _conv(paired["energy-consumption"], pes, 0) != _conv(primary["energy-consumption"], es, 0):
            bad.append("energy-consumption")
    if paired.get("carbon-footprint") is not None and paired.get("scope-2") is not None and primary.get("scope-3") is not None:
        ts = [_term(paired["scope-2"], k_of(paired["scope-2"]), pc), _term(primary["scope-3"], k_of(primary["scope-3"]), c1)]
        if primary.get("scope-1") is not None:
            ts.append(_term(primary["scope-1"], k_of(primary["scope-1"]), c1))
        if not tolerance_pass(paired["carbon-footprint"], k_of(paired["carbon-footprint"]), pc, ts)["ok"]:
            bad.append("carbon-footprint")
    if paired.get("carbon-intensity-gCO2e-per-kWh") is not None and paired.get("scope-2") is not None and paired.get("energy-consumption") is not None and pes is not None and pc is not None:
        if s6d(paired, [], has_ev, label)["result"] == FAIL:
            bad.append("carbon-intensity-gCO2e-per-kWh")
    return row("S6.i", FAIL if bad else PASS, jlist(bad), label)


# ---- S4, C-SFC-2 disclosure, C-SFC-5 -----------------------------------------------------------------------

_YEAR = re.compile(r"(\d{4})-01-01T00:00:00(Z|[+-]\d{2}:\d{2})", A)


def calendar_year(period, ledger_backed=False):
    if not isinstance(period, dict):
        return None
    a, b = _YEAR.fullmatch(str(period.get("start"))), _YEAR.fullmatch(str(period.get("end")))
    if not a or not b or (ledger_backed and a.group(2) != "Z") or a.group(2) != b.group(2) or int(b.group(1)) != int(a.group(1)) + 1 or not is_instant(period.get("start")) or not is_instant(period.get("end")):
        return None
    return {"year": int(a.group(1)), "offset": a.group(2)}


def select_annual(objs, target, T):
    rows = []
    cand = [o for o in objs if same_target(o.get("target"), target) and o.get("target-type") == "service" and not isinstance((ext_of(o, "network-topology") or {}).get("member-of-network"), str)]
    if not cand:
        return {"rows": [row("S4", NE, "no network declaration for %s" % target)], "primary": None, "selected": None}
    groups = {}
    for o in cand:
        p = o.get("period") or {}
        k = "%s|%s" % (p.get("start"), p.get("end"))
        groups.setdefault(k, []).append(o)
    years = []
    for k, os_ in groups.items():
        start, end = k.split("|")
        if calendar_year({"start": start, "end": end}, any(ext_of(o, "ledger-evidence-2") is not None for o in os_)) is None:
            rows.append(row("S4.info", INFO, "period %s to %s excluded: not a whole calendar year" % (start, end)))
        else:
            years.append({"start": start, "end": end, "os": os_})
    import functools
    ended = sorted([y for y in years if at_or_before(y["end"], T)], key=functools.cmp_to_key(lambda a, b: -1 if before(a["end"], b["end"]) else 1))
    for y in [y for y in years if not at_or_before(y["end"], T)]:
        rows.append(row("S4.info", INFO, "period not yet ended at T: %s to %s" % (y["start"], y["end"])))
    if not ended:
        rows.append(row("S4", NE, "no annual network object ended at or before T"))
        return {"rows": rows, "primary": None, "selected": None}
    sel = ended[-1]
    for y in ended[:-1]:
        rows.append(row("S4.info", INFO, "other year: %s to %s" % (y["start"], y["end"])))
    rows.append(row("S4.info", INFO, "latest year selected: %s to %s%s" % (sel["start"], sel["end"], "; ended more than 18 months before T" if before(add_calendar_months(sel["end"], 18), T) else "")))
    primary = next((o for o in sel["os"] if o.get("carbon-accounting") == "market-based"), None) or next((o for o in sel["os"] if ext_of(o, "ledger-evidence-2") is not None), None)
    rows.append(row("S4", PASS, "%s to %s" % (sel["start"], sel["end"])) if primary else row("S4", NE, "no market-based object and none with ledger-evidence-2"))
    return {"rows": rows, "primary": primary, "selected": sel}


def _to_kwh(o):
    sh = ENERGY_SHIFT[o["energy-unit"]]
    x = from_number(o["energy-consumption"])
    return x * 10 ** sh if sh >= 0 else shift(x, -sh)


def csfc2_disclosure(sel, primary, incomplete):
    label = "disclosure"
    if primary is None:
        return row("C-SFC-2", NE, "no primary object", label)
    if incomplete:
        return row("C-SFC-2", NE, "incomplete object", label)
    if primary.get("energy-consumption") is None or ENERGY_SHIFT.get(primary.get("energy-unit")) is None:
        return row("C-SFC-2", NE, "figure or unit missing", label)
    for o in sel["os"]:
        if o.get("energy-consumption") is not None and ENERGY_SHIFT.get(o.get("energy-unit")) is not None and _to_kwh(o) != _to_kwh(primary):
            return row("C-SFC-2", NE, "annual objects of one target and period disagree", label)
    kwh = _to_kwh(primary)
    near = abs(float(to_text(kwh)) - 1e6) <= 1e4
    return row("C-SFC-2", PASS if kwh < CAP_KWH else FAIL, "INFO within 1% of CAP: the methodology document must say no perturbation was applied" if near else None, label)


def _figure_publishable(x):
    """3.3 rule 2 on a published value: at most 15 digits in all, at most 6 after the point; a sign is allowed."""
    return figure_ok(abs(x))


def csfc5(obj, level, siblings, T, skew, s2valid, s3rows):
    t = []
    ev = ext_of(obj, "ledger-evidence-2")
    if not s2valid:
        t.append("S2")
    if level == "network":
        m, _, _ = missing_74(obj, ev)
        t.extend("missing:" + x for x in m)
        if obj.get("target-type") != "service":
            t.append("target-type")
        if obj.get("disclosure-uri") is None:
            t.append("disclosure-uri")
    else:
        numeric = any(obj.get(k) is not None for k in METRICS)
        if not numeric and obj.get("disclosure-uri") is None and obj.get("verifiable-attestation-uri") is None:
            t.append("no evidence member")
        if obj.get("target-type") == "origin" and ev is not None and not isinstance((ext_of(obj, "network-topology") or {}).get("member-of-network"), str):
            t.append("member-of-network")
    if obj.get("energy-consumption") is not None and obj.get("energy-unit") is None:
        t.append("energy-unit")
    if any(obj.get(k) is not None for k in ("carbon-footprint", "scope-1", "scope-2", "scope-3")) and obj.get("carbon-unit") is None:
        t.append("carbon-unit")
    if ev is not None:
        if not isinstance(obj.get("signed"), str):
            t.append("signed absent")
        elif any(r["id"] == "S3" and r["result"] == FAIL for r in s3rows):
            t.append("signed")
        p = obj.get("period") or {}
        if not (is_month_bound(p.get("start")) and is_month_bound(p.get("end"))):
            t.append("period not month-bound")
        if not re.fullmatch(r"2\.[0-9]+", str(ev.get("profile-version")), A):
            t.append("profile-version")
    if ev is not None:
        for k in ("energy-consumption", "scope-1", "scope-2", "scope-3", "carbon-footprint", "carbon-intensity-gCO2e-per-kWh"):
            if is_num_type(obj.get(k)) and not _figure_publishable(obj[k]):
                t.append("figure:" + k)
    if is_instant(obj.get("updated")) and epoch(obj["updated"]) > epoch(T) + skew:
        t.append("updated after T")
    paired = None
    if obj.get("carbon-accounting") == "market-based":
        paired = next((o for o in (siblings or []) if o is not obj and same_period_target(o, obj) and o.get("carbon-accounting") == "location-based"), None)
    if paired is not None:
        need = ["target-type", "carbon-unit", "scope-2", "carbon-footprint", "signed", "updated", "capabilities", "provider", "measurement-method", "methodology-uri", "period", "target"]
        if obj.get("energy-consumption") is not None:
            need += ["energy-consumption", "energy-unit"]
        if obj.get("disclosure-uri") is not None:
            need.append("disclosure-uri")
        for k in need:
            if paired.get(k) is None:
                t.append("paired:" + k)
    return row("C-SFC-5", FAIL if t else PASS, jlist(t), label_of(obj))


# ---- URIs ---------------------------------------------------------------------------------------------------

def _has_scheme(u):
    return re.match(r"[A-Za-z][A-Za-z0-9+.-]*:", u, A) is not None


def _userinfo(u):
    return re.match(r"[A-Za-z][A-Za-z0-9+.-]*://[^/?#]*@", u, A) is not None


def _check_uri(member, value, scope, base, rows, reference=True):
    if not isinstance(value, str):
        return
    if not _has_scheme(value):
        if not reference:
            rows.append(row("URI", NE, "not an absolute URI: " + member, scope))
            return
        if not base:
            rows.append(row("URI", NE, "relative reference, no base: " + member, scope))
            return
        rows.append(row("URI", INFO, "%s resolved to %s" % (member, urljoin(base, value)), scope))
        return
    if _userinfo(value):
        rows.append(row("URI", NE, "userinfo in URI: " + member, scope))


def declaration_uri_rows(objs, base):
    rows = []
    for o in objs:
        scope = label_of(o)
        for m in ("methodology-uri", "disclosure-uri", "verifiable-attestation-uri"):
            _check_uri(m, o.get(m), scope, base, rows)
        _check_uri("ledger-access-uri", (ext_of(o, "ledger-evidence-2") or {}).get("ledger-access-uri"), scope, base, rows, False)
        _check_uri("offset-registry-uri", (ext_of(o, "carbon-neutrality") or {}).get("offset-registry-uri"), scope, base, rows, False)
        _check_uri("network-declaration", (ext_of(o, "network-topology") or {}).get("network-declaration"), scope, base, rows, False)
        _check_uri("reuse-and-recycling-policy-uri", (ext_of(o, "hardware-lifecycle") or {}).get("reuse-and-recycling-policy-uri"), scope, base, rows, False)
    return rows


def event_uri_rows(ctx):
    rows = []
    for ev in ctx.events:
        if ev.kind != "2x" or not isinstance((ev.event or {}).get("payload") if isinstance(ev.event, dict) else None, dict):
            continue
        scope = "%s %s %s" % (ev.event.get("subject"), "Energy" if ev.event.get("type") == "EnergyAttested" else "Carbon", ev.commit)
        p = ev.event["payload"]
        if isinstance(p.get("evidence"), str) and not _has_scheme(p["evidence"]):
            rows.append(row("URI", NE, "not an absolute URI: evidence", scope))
        else:
            _check_uri("evidence", p.get("evidence"), scope, None, rows, False)
        for r in p.get("retirements") if isinstance(p.get("retirements"), list) else []:
            _check_uri("registry", r.get("registry") if isinstance(r, dict) else None, scope, None, rows, False)
    return rows
