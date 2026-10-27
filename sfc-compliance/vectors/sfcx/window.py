"""Window checks: C-SFC-1, C-SFC-2 (ledger form), C-SFC-3, C-SFC-4, C-SFC-6."""
import re
from fractions import Fraction
from .base import DECLARED, FAIL, INFO, NE, NOT_DECLARED, PASS, ZERO, add_calendar_months, before, cmp_instant, due_of, epoch, from_number, is_full_date, is_instant, is_num_type, jlist, row, shift, window_of, worst
from .model import HARDWARE, REUSE, active_in, coverage_holds, dec_of, e_key, replay

CAP_KWH = Fraction(1000000)


def window_label(w):
    return "%s..%s" % (w[0][:7], w[-1][:7])


def time_info(ctx):
    explicit = ctx.sc.get("T")
    clock = ctx.sc.get("now")
    T = explicit or clock or ctx.read_at
    anchor = explicit or ctx.read_at
    stale = False
    if not explicit and clock:
        stale = (epoch(clock) - epoch(ctx.read_at) > ctx.limits["maxReadAgeSeconds"]) or (epoch(ctx.read_at) > epoch(clock) + ctx.limits["skewSeconds"])
    read_older = explicit is not None and before(ctx.read_at, explicit)
    return {"explicit": explicit, "clock": clock, "T": T, "anchor": anchor, "stale": stale, "readOlderThanT": read_older}


def window_facts(ctx, ti):
    w = window_of(ti["anchor"])
    st = replay(ctx, ti["anchor"])
    op_months, uncovered = [], []
    for m in w:
        act = [en for en in ctx.registry if active_in(en, m)]
        if not act:
            uncovered.append(m)
        for en in act:
            op_months.append((en, m))
    return {"w": w, "st": st, "opMonths": op_months, "uncovered": uncovered}


def blocked(ctx, ti, f):
    if ti["stale"]:
        return "stale read"
    if ti["readOlderThanT"]:
        return "read older than T"
    if not f["opMonths"]:
        return "no operator active in the window"
    return None


def _eff(f, en, type_, m):
    return f["st"]["E"].get(e_key(en.operator, type_, m))


def csfc1(ctx, ti, f):
    scope = window_label(f["w"])
    b = blocked(ctx, ti, f)
    if b:
        return row("C-SFC-1", NE, b, scope)
    silent = ["%s %s" % (en.operator, m[:7]) for en, m in f["opMonths"] if not _eff(f, en, "EnergyAttested", m)]
    if silent:
        return row("C-SFC-1", FAIL, "silent: " + jlist(silent), scope)
    return row("C-SFC-1", PASS, "INFO window not fully covered" if f["uncovered"] else None, scope)


def _alg_ne(f, op_months):
    for en, m in op_months:
        for t in ("EnergyAttested", "CarbonAttested"):
            e = f["st"]["E"].get(e_key(en.operator, t, m))
            if e and "L5:alg" in f["st"]["verdicts"][e["ev"].i]["ne"]:
                return True
    return False


def csfc2_ledger(ctx, ti, f):
    scope = "ledger " + window_label(f["w"])
    b = blocked(ctx, ti, f)
    if b:
        return row("C-SFC-2", NE, b, scope)
    total = ZERO
    silent = []
    for en, m in f["opMonths"]:
        e = _eff(f, en, "EnergyAttested", m)
        if e:
            total += dec_of(e["ev"].event["payload"]["kWhConsumed"])
        else:
            silent.append("%s %s" % (en.operator, m[:7]))
    unread = _alg_ne(f, f["opMonths"])
    if total >= CAP_KWH:
        return row("C-SFC-2", FAIL, "sum at or above CAP", scope)
    if silent or f["uncovered"]:
        return row("C-SFC-2", NE, ("silent: " + jlist(silent)) if silent else "window not fully covered", scope)
    if unread:
        return row("C-SFC-2", NE, "L5 not evaluable for a counted event", scope)
    return row("C-SFC-2", PASS, None, scope)


def csfc4(ctx, months, cutoff, scope, block_reason):
    st = replay(ctx, cutoff)
    op_months, uncovered = [], []
    for m in months:
        act = [en for en in ctx.registry if active_in(en, m)]
        if not act:
            uncovered.append(m)
        for en in act:
            op_months.append((en, m))
    if block_reason:
        return [row("C-SFC-4", NE, block_reason, scope)]
    if not op_months:
        return [row("C-SFC-4", NE, "no operator active in the window", scope)]
    bad, infos = [], []
    ne = False
    for en, m in op_months:
        e = st["E"].get(e_key(en.operator, "CarbonAttested", m))
        label = "%s %s" % (en.operator, m[:7])
        if not e:
            bad.append("silent " + label)
            continue
        p = e["ev"].event["payload"]
        if p.get("netZero") is not True or not coverage_holds(p) or p.get("netZero") != coverage_holds(p):
            bad.append("not covered " + label)
        if e["ev"].kind == "1x":
            infos.append("retirement rules L8b to L10 not applied: " + e["hash"])
        elif before(due_of(m), e["ev"].commit):
            infos.append("late-filed: %s committed %s" % (e["hash"], e["ev"].commit))
        if "L5:alg" in st["verdicts"][e["ev"].i]["ne"]:
            ne = True
    out = []
    if bad:
        out.append(row("C-SFC-4", FAIL, jlist(bad), scope))
    elif ne:
        out.append(row("C-SFC-4", NE, "L5 not evaluable for a counted event", scope))
    else:
        out.append(row("C-SFC-4", PASS, "INFO window not fully covered" if uncovered else None, scope))
    for t in sorted(set(infos), key=lambda s: s.encode("utf-16-be")):
        out.append(row("C-SFC-4.info", INFO, t, scope))
    return out


def node_profile_complete(n):
    return (isinstance(n, dict) and n.get("hardwareClass") in HARDWARE and n.get("asicForbidden") is True and is_full_date(n.get("purchasedAt"))
            and is_full_date(n.get("expectedRetireAt")) and n["purchasedAt"] <= n["expectedRetireAt"] and n.get("reusePolicy") in REUSE)


def csfc3(ctx, ti, f):
    scope = window_label(f["w"])
    if not ctx.registry:
        return row("C-SFC-3", NE, "no Registry", scope)
    ens = [en for en in ctx.registry if any(active_in(en, m) for m in f["w"])]
    if not ens:
        return row("C-SFC-3", NE, "no operator active in the window", scope)
    bad = [en.operator for en in ens if not node_profile_complete(en.node_profile)]
    return row("C-SFC-3", NOT_DECLARED, jlist(bad), scope) if bad else row("C-SFC-3", DECLARED, None, scope)


_MECHANISMS = ["proof-of-work", "proof-of-stake", "proof-of-authority", "dag", "hybrid", "bft", "crash-fault-tolerant"]
_UNIT_KWH = {"Wh": -3, "kWh": 0, "MWh": 3, "GWh": 6}


def normalise_mechanism(s):
    if not isinstance(s, str):
        return None
    t = s.lower().strip(" \t\n\r")
    t = re.sub(r"[ _-]+", "-", t)
    return "proof-of-work" if t == "pow" else t


def _node_bound(n, p, o):
    return from_number(n) * from_number(p) * from_number(o) * 8784 / 1000


def _public_case(ti, a):
    if not isinstance(a, dict):
        return {"result": NE, "detail": "assessment missing"}
    bad = []
    p = a.get("period")
    ok_p = isinstance(p, dict) and isinstance(p.get("start"), str) and isinstance(p.get("end"), str) and p["start"].endswith("Z") and p["end"].endswith("Z") and is_instant(p["start"]) and is_instant(p["end"])
    if not ok_p:
        bad.append("period")
    fig = a.get("figure")
    if not is_num_type(fig) or fig != fig or fig < 0:
        bad.append("figure")
    if a.get("unit") not in _UNIT_KWH:
        bad.append("unit")
    if bad:
        return {"result": NE, "detail": "missing or malformed: " + ", ".join(bad)}
    # instants compare as the moments they denote (3.2): a fraction or a trailing zero does not break the equality
    if cmp_instant(add_calendar_months(p["start"], 12), p["end"]) != 0:
        return {"result": FAIL, "detail": "period is not 12 calendar months"}
    if before(add_calendar_months(p["end"], 18), ti["T"]):
        return {"result": FAIL, "detail": "assessment ended more than 18 months before T"}
    sh = _UNIT_KWH[a["unit"]]
    kwh = from_number(fig) * (10 ** sh) if sh >= 0 else shift(from_number(fig), -sh)
    return {"result": PASS} if kwh < CAP_KWH else {"result": FAIL, "detail": "figure at or above CAP"}


def c6_follows_ledger(ctx, f):
    """C-SFC-6 test 2 takes the result of C-SFC-2: a permissioned platform with every window month covered by an operator."""
    platform = ctx.params.get("platform")
    return isinstance(platform, dict) and platform.get("access") == "permissioned" and len(f["uncovered"]) == 0 and len(f["opMonths"]) > 0


def _platform_case(ctx, ti, f, platform, c2):
    if not isinstance(platform, dict) or platform.get("access") not in ("public", "permissioned"):
        return {"result": NE, "detail": "no statement names the case"}
    if platform["access"] == "public":
        return _public_case(ti, platform.get("assessment"))
    if c6_follows_ledger(ctx, f):
        return {"result": c2["result"], "detail": "C-SFC-2 " + c2["result"]}
    n, o, p = platform.get("n"), platform.get("o"), platform.get("p-watts")
    missing = [k for k, v in (("n", n), ("p-watts", p), ("o", o)) if not is_num_type(v) or v != v or v <= 0]
    if o is not None and is_num_type(o) and o < 1:
        missing.append("o")
    if missing:
        return {"result": NE, "detail": "missing or malformed: " + jlist(missing)}
    return {"result": PASS} if _node_bound(n, p, o) < CAP_KWH else {"result": FAIL, "detail": "node bound at or above CAP"}


def csfc6(ctx, ti, f, consensus, c2):
    platform = ctx.params.get("platform")
    scope = "platform"
    mech = normalise_mechanism(platform.get("mechanism")) if isinstance(platform, dict) else None
    cons = normalise_mechanism(consensus)
    infos = []
    if mech == "proof-of-work" or cons == "proof-of-work":
        t1 = FAIL
    elif mech not in _MECHANISMS:
        t1 = NE
    else:
        t1 = PASS
        if cons is not None and cons != mech and cons not in _MECHANISMS:
            infos.append("consensus-mechanism text differs")
    t1_detail = "mechanism not named or outside the list" if t1 == NE else ("proof-of-work" if t1 == FAIL else None)
    t2 = _platform_case(ctx, ti, f, platform, c2)
    result = worst(t1, t2["result"])
    parts = []
    if t1 != PASS:
        parts.append("test 1: %s" % t1_detail)
    if t2["result"] != PASS:
        parts.append("test 2: %s" % t2.get("detail"))
    rows = [row("C-SFC-6", result, "; ".join(parts) or None, scope)]
    for i in infos:
        rows.append(row("C-SFC-6.info", INFO, i, scope))
    return rows


def window_rows(ctx, ti, consensus, with_c4):
    f = window_facts(ctx, ti)
    c1, c2 = csfc1(ctx, ti, f), csfc2_ledger(ctx, ti, f)
    b = blocked(ctx, ti, f)
    rows = [c1, c2, csfc3(ctx, ti, f)]
    if with_c4:
        rows.extend(csfc4(ctx, f["w"], ti["anchor"], window_label(f["w"]), b))
    rows.extend(csfc6(ctx, ti, f, consensus, c2))
    return {"rows": rows, "f": f}
