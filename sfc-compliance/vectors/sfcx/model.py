"""Member tables, Registry entries, the acceptance rules L1 to L12, the replay of 5.6 and the sums of 7.4."""
import re
from fractions import Fraction
from .base import A, ZERO, add_days, add_months, at_or_before, before, canonicalize, cmp_instant, due_of, ed_verify, figure_ok, from_number, is_b64url, is_did, is_full_date, is_hex64, is_host, is_https_uri, is_instant, is_int, is_month_bound, is_num, is_num_type, is_uri_abs, months_between, parse_instant, round_half_even, safe_hash, same_host, shift, to_published, tonnes_ok, unb64u, unb64u_lenient, without_sig

# ---- member tables (shape) ---------------------------------------------------------------------------

METHODS = ["hardware-metered", "hardware-estimated", "cloud-billing", "third-party-modeled"]
HARDWARE = ["general-purpose-x86", "arm64-server", "rpi-cluster", "cloud-instance", "accelerator-server"]
REUSE = ["donate-to-education", "resell-refurbished", "recycle-WEEE-certified"]
MAX_FIGURE = 999999999999999


def _str_ok(v):
    return isinstance(v, str) and len(v.encode("utf-8", "surrogatepass")) <= 4096


def _figure(v):
    return is_num(v, 0) and v <= MAX_FIGURE


class _Collect:
    def __init__(self):
        self.bad = set()

    def need(self, ok, path):
        if not ok:
            self.bad.add("shape:" + path)

    def done(self):
        return sorted(self.bad)


def is_sig(s):
    return isinstance(s, dict) and isinstance(s.get("alg"), str) and isinstance(s.get("value"), str)


def is_jwk(j):
    return isinstance(j, dict) and j.get("kty") == "OKP" and j.get("crv") == "Ed25519" and is_b64url(j.get("x"), 32) and len(j["x"]) == 43


def _period2(p):
    return isinstance(p, dict) and is_month_bound(p.get("start")) and is_month_bound(p.get("end"))


def is_1x_event(e):
    return isinstance(e, dict) and isinstance(e.get("payload"), dict) and isinstance(e["payload"].get("period"), dict) and ("from" in e["payload"]["period"] or "to" in e["payload"]["period"])


def event_shape(e):
    c = _Collect()
    if not isinstance(e, dict):
        c.need(False, "event")
        return c.done()
    c.need(e.get("type") in ("EnergyAttested", "CarbonAttested"), "type")
    c.need(is_host(e.get("network")), "network")
    c.need(is_did(e.get("subject")), "subject")
    c.need(is_did(e.get("actor")), "actor")
    c.need(e.get("prev", False) is None or is_hex64(e.get("prev")), "prev")
    c.need(is_instant(e.get("ts")), "ts")
    c.need(isinstance(e.get("payload"), dict), "payload")
    c.need(is_sig(e.get("sig")), "sig")
    if not isinstance(e.get("payload"), dict):
        return c.done()
    p = e["payload"]
    c.need(_period2(p.get("period")), "payload.period")
    c.need(is_uri_abs(p.get("evidence")) and _str_ok(p.get("evidence")), "payload.evidence")
    c.need("supersedes" not in p or is_hex64(p["supersedes"]), "payload.supersedes")
    if e.get("type") == "EnergyAttested":
        c.need(is_int(p.get("nodeCount"), 0), "payload.nodeCount")
        c.need(_figure(p.get("kWhConsumed")), "payload.kWhConsumed")
        c.need(p.get("measurementMethod") in METHODS, "payload.measurementMethod")
    elif e.get("type") == "CarbonAttested":
        c.need("scope1KgCO2e" not in p or _figure(p["scope1KgCO2e"]), "payload.scope1KgCO2e")
        c.need(_figure(p.get("scope2KgCO2e")), "payload.scope2KgCO2e")
        c.need("scope2LocationKgCO2e" not in p or _figure(p["scope2LocationKgCO2e"]), "payload.scope2LocationKgCO2e")
        c.need(_figure(p.get("scope3KgCO2e")), "payload.scope3KgCO2e")
        c.need(_str_ok(p.get("gridIntensityRef")), "payload.gridIntensityRef")
        c.need(_figure(p.get("offsetsKgCO2e")), "payload.offsetsKgCO2e")
        c.need(isinstance(p.get("netZero"), bool), "payload.netZero")
        r = p.get("retirements")
        c.need(isinstance(r, list) and len(r) <= 100, "payload.retirements")
        if isinstance(r, list):
            for i, x in enumerate(r):
                ok = (isinstance(x, dict) and is_https_uri(x.get("registry")) and _str_ok(x.get("registry"))
                      and isinstance(x.get("reference"), str) and len(x["reference"]) > 0 and _str_ok(x["reference"])
                      and isinstance(x.get("tonnesRetired"), int) and not isinstance(x["tonnesRetired"], bool) and 1 <= x["tonnesRetired"] <= MAX_FIGURE
                      and is_instant(x.get("retiredAt")) and _figure(x.get("kg")) and ("beneficiary" not in x or _str_ok(x["beneficiary"])))
                c.need(ok, "payload.retirements[%d]" % i)
    return c.done()


def event_1x_shape(e):
    c = _Collect()
    if not isinstance(e, dict):
        c.need(False, "event")
        return c.done()
    c.need(e.get("type") in ("EnergyAttested", "CarbonAttested"), "type")
    c.need(is_did(e.get("subject")), "subject")
    c.need(is_did(e.get("actor")), "actor")
    c.need(e.get("prev", False) is None or is_hex64(e.get("prev")), "prev")
    c.need(is_instant(e.get("ts")), "ts")
    c.need(isinstance(e.get("payload"), dict), "payload")
    c.need(is_sig(e.get("sig")), "sig")
    if isinstance(e.get("payload"), dict):
        p = e["payload"]
        c.need(isinstance(p.get("period"), dict) and isinstance(p["period"].get("from"), str) and isinstance(p["period"].get("to"), str), "payload.period")
        c.need("supersedes" not in p or is_hex64(p["supersedes"]), "payload.supersedes")
    return c.done()


def node_profile_shape(n, c, path="nodeProfile"):
    ok = (isinstance(n, dict) and n.get("hardwareClass") in HARDWARE and n.get("asicForbidden") is True
          and is_full_date(n.get("purchasedAt")) and is_full_date(n.get("expectedRetireAt"))
          and n.get("reusePolicy") in REUSE and ("serviceLifeMonths" not in n or is_int(n["serviceLifeMonths"], 1)))
    c.need(ok, path)


def _key_shape(k):
    return isinstance(k, dict) and is_jwk(k.get("jwk")) and is_instant(k.get("validFromCommit")) and (k.get("validToCommit", False) is None or is_instant(k.get("validToCommit")))


def _interval_shape(a):
    return isinstance(a, dict) and is_month_bound(a.get("from")) and (a.get("to", False) is None or is_month_bound(a.get("to")))


def entry_shape(en):
    c = _Collect()
    if not isinstance(en, dict):
        c.need(False, "entry")
        return c.done()
    c.need(is_did(en.get("operator")), "operator")
    c.need(is_host(en.get("origin")), "origin")
    c.need(is_host(en.get("network")), "network")
    a = en.get("active")
    c.need(isinstance(a, list) and 1 <= len(a) <= 100 and all(_interval_shape(x) for x in a), "active")
    k = en.get("keys")
    c.need(isinstance(k, list) and 1 <= len(k) <= 100 and all(_key_shape(x) for x in k), "keys")
    node_profile_shape(en.get("nodeProfile"), c)
    c.need("version" not in en or is_int(en["version"], 1), "version")
    c.need("profile2From" not in en or is_month_bound(en["profile2From"]), "profile2From")
    c.need(is_sig(en.get("sig")), "sig")
    for f in ("commit", "target", "read-at", "chains"):
        c.need(f not in en, "forbidden:" + f)
    return c.done()


def is_1x_entry(en):
    return isinstance(en, dict) and "sig" not in en and isinstance(en.get("keys"), list) and any(isinstance(k, dict) and "public-jwk" in k for k in en["keys"])


# ---- Registry entries -------------------------------------------------------------------------------------

class Entry:
    pass


def norm_entry(raw):
    en = Entry()
    one = is_1x_entry(raw)
    active = raw.get("active") if isinstance(raw.get("active"), list) else []
    keys = raw.get("keys") if isinstance(raw.get("keys"), list) else []
    en.raw = raw
    en.form = "1x" if one else "2x"
    en.operator = raw.get("operator")
    en.origin = raw.get("origin")
    en.network = raw.get("network")
    en.version = raw.get("version")
    en.profile2_from = raw.get("profile2From")
    en.node_profile = raw.get("nodeProfile")
    if one:
        en.intervals = [{"from": a["from"] + "T00:00:00Z", "to": None if a["to"] is None else add_days(a["to"] + "T00:00:00Z", 1)} for a in active]
        en.keys = [{"x": (k.get("public-jwk") or {}).get("x"), "from": k.get("valid-from-commit"), "to": k.get("valid-to-commit")} for k in keys]
    else:
        en.intervals = [{"from": a.get("from"), "to": a.get("to")} for a in active]
        en.keys = [{"x": (k.get("jwk") or {}).get("x"), "from": k.get("validFromCommit"), "to": k.get("validToCommit")} for k in keys]
    return en


def active_in(entry, start):
    end = add_months(start, 1)
    return any(before(iv["from"], end) and (iv["to"] is None or before(start, iv["to"])) for iv in entry.intervals)


def first_active_month(entry):
    froms = sorted((iv["from"] for iv in entry.intervals), key=lambda t: parse_instant(t))
    if not froms:
        return None
    return froms[0][:7] + "-01T00:00:00Z"


def keys_valid_at(entry, commit):
    return [k for k in entry.keys if cmp_instant(k["from"], commit) <= 0 and (k["to"] is None or cmp_instant(commit, k["to"]) < 0)]


def pub_of(k):
    return unb64u(k["x"]) if isinstance(k.get("x"), str) else None


def intervals_ordered(entry):
    prev_to = "unset"
    for iv in entry.intervals:
        if iv["to"] is not None and not before(iv["from"], iv["to"]):
            return False
        if prev_to != "unset":
            if prev_to is None:
                return False
            if before(iv["from"], prev_to):
                return False
        prev_to = iv["to"]
    return True


# ---- the context -------------------------------------------------------------------------------------------

DEFAULT_LIMITS = {
    "declarationBytes": 1048576, "readBytes": 67108864, "nesting": 32, "operators": 1000, "registryEntries": 1000,
    "eventsPerChain": 10000, "retirements": 100, "literalChars": 32, "stringBytes": 4096, "eventBytes": 65536,
    "arrayItems": 100, "checkpointChains": 2000, "voids": 10000, "parameterArray": 1000, "declarationObjects": 16,
    "maxReadAgeSeconds": 86400, "skewSeconds": 300,
}


def with_limits(override):
    out = dict(DEFAULT_LIMITS)
    out.update(override or {})
    return out


class Ctx:
    pass


def build_context(sc):
    ex = sc["excerpt"]
    ctx = Ctx()
    ctx.sc = sc
    ctx.ex = ex
    ctx.network = ex.get("network")
    ctx.read_at = ex.get("read-at")
    ctx.registry = [norm_entry(x) for x in (ex.get("registry") or [])]
    ctx.by_operator = {}
    for en in ctx.registry:
        if en.operator not in ctx.by_operator:
            ctx.by_operator[en.operator] = en
    ctx.events = []
    for i, l in enumerate(ex.get("ledger") or []):
        e = l.get("event")
        ev = Ctx()
        ev.i, ev.commit, ev.hash, ev.event = i, l.get("commit"), l.get("hash"), e
        ev.computed = safe_hash(e)
        ev.kind = "1x" if is_1x_event(e) else "2x"
        ctx.events.append(ev)
    ctx.voids = ex.get("voids") or []
    ctx.checkpoint = ex.get("checkpoint")
    ctx.params = sc.get("parameters") or {}
    ctx.pins = sc.get("pins") or {}
    ctx.limits = None
    ctx.cache = {}
    ctx.limit_hits = []
    ctx.missing_chains = None
    return ctx


def event_shape_tokens(ev):
    return event_1x_shape(ev.event) if ev.kind == "1x" else event_shape(ev.event)


def _get(d, *path):
    for k in path:
        if not isinstance(d, dict):
            return None
        d = d.get(k)
    return d


def month_of_event(ev):
    p = _get(ev.event, "payload", "period")
    if not isinstance(p, dict):
        return None
    if ev.kind == "2x":
        return p["start"] if (is_month_bound(p.get("start")) and is_month_bound(p.get("end")) and p["end"] == add_months(p["start"], 1)) else None
    if not is_full_date(p.get("from")) or not is_full_date(p.get("to")):
        return None
    start = p["from"][:7] + "-01T00:00:00Z"
    last = add_days(add_months(start, 1), -1)[:10]
    return start if (p["from"] == start[:10] and p["to"] == last) else None


def span_of_event(ev):
    p = _get(ev.event, "payload", "period")
    if not isinstance(p, dict):
        return None
    if ev.kind == "2x":
        return [p["start"], p["end"]] if (is_instant(p.get("start")) and is_instant(p.get("end")) and before(p["start"], p["end"])) else None
    if not is_full_date(p.get("from")) or not is_full_date(p.get("to")) or p["to"] < p["from"]:
        return None
    return [p["from"] + "T00:00:00Z", add_days(p["to"] + "T00:00:00Z", 1)]


# ---- signatures --------------------------------------------------------------------------------------------

def sig_info(ctx, ev):
    key = "sig%d" % ev.i
    if key in ctx.cache:
        return ctx.cache[key]
    e = ev.event
    sig = e.get("sig") if isinstance(e, dict) else None
    out = {"alg": True, "encoding": True, "weak": False, "verified": False, "noKey": False, "algName": sig.get("alg") if isinstance(sig, dict) else None}
    if isinstance(sig, dict) and isinstance(sig.get("value"), str):
        if sig.get("alg") != "Ed25519":
            out["alg"] = False
        strict = unb64u(sig["value"])
        if strict is not None:
            raw = strict
        elif ev.kind == "1x":
            raw = unb64u_lenient(sig["value"])
        else:
            raw = None
        if strict is None and ev.kind == "2x":
            out["encoding"] = False
        if out["alg"] and raw is not None and len(raw) == 64:
            entry = ctx.by_operator.get(e.get("subject"))
            keys = keys_valid_at(entry, ev.commit) if entry else []
            if not keys:
                out["noKey"] = True
            msg = canonicalize(without_sig(e)).encode("utf-8")
            reasons = []
            for k in keys:
                pub = pub_of(k)
                if not pub:
                    reasons.append("bad-A")
                    continue
                ok, reason = ed_verify(pub, msg, raw)
                if ok:
                    out["verified"] = True
                    break
                reasons.append(reason)
            if not out["verified"] and out["encoding"]:
                if any(r in ("s-range", "bad-R", "bad-A") for r in reasons):
                    out["encoding"] = ev.kind == "1x"
                if any(r in ("weak-A", "weak-R") for r in reasons):
                    out["weak"] = True
        elif out["alg"] and ev.kind == "2x":
            out["encoding"] = False
    else:
        out["encoding"] = False
    ctx.cache[key] = out
    return out


# ---- figures -----------------------------------------------------------------------------------------------

def dec_of(x):
    return from_number(x)


def _sum_kg(retirements):
    t = ZERO
    for r in retirements:
        t += dec_of(r["kg"])
    return t


def _num(p, k):
    return ZERO if k not in p else dec_of(p[k])


def coverage_holds(p):
    lhs = _num(p, "scope1KgCO2e") + _num(p, "scope2KgCO2e") + _num(p, "scope3KgCO2e")
    return lhs <= _num(p, "offsetsKgCO2e")


# ---- parameters --------------------------------------------------------------------------------------------

def methodology_pinned(ctx):
    return ctx.pins.get("methodology") is True


def registry_forms(ctx):
    return ctx.params.get("retirement-registries")


def form_rules(ctx, registry):
    for f in ctx.params.get("reference-forms") or []:
        if f.get("registry") == registry:
            return f.get("rules") or []
    return []


def takeover_tip(ctx, operator, type_):
    for t in ctx.params.get("takeovers") or []:
        if t.get("operator") == operator and t.get("type") == type_:
            return t.get("tip")
    return None


_RANGE = re.compile(r"(0|[1-9][0-9]*)-(0|[1-9][0-9]*)", A)
_SINGLE = re.compile(r"(0|[1-9][0-9]*)", A)


def serial_range(ref):
    m = _RANGE.fullmatch(ref)
    if m:
        return (int(m.group(1)), int(m.group(2)))
    m = _SINGLE.fullmatch(ref)
    return (int(m.group(1)), int(m.group(1))) if m else None


def reference_canonical(reference, rules):
    if "upper-case" in rules and reference != reference.upper():
        return False
    if "lower-case" in rules and reference != reference.lower():
        return False
    if "no-leading-zeros" in rules and re.search(r"(^|[^0-9])0[0-9]", reference, A):
        return False
    if "no-surrounding-space" in rules and reference != reference.strip():
        return False
    if "range-first-last" in rules:
        m = _RANGE.fullmatch(reference)
        if m:
            if int(m.group(1)) >= int(m.group(2)):
                return False
        elif not _SINGLE.fullmatch(reference):
            return False
    return True


# ---- the acceptance rules ----------------------------------------------------------------------------------

def citations(ev):
    r = _get(ev.event, "payload", "retirements")
    if ev.kind == "2x" and ev.event.get("type") == "CarbonAttested" and isinstance(r, list):
        return [x for x in r if isinstance(x, dict)]
    return []


def _figures_ok(e):
    p = e["payload"]
    names = ["kWhConsumed"] if e["type"] == "EnergyAttested" else ["scope1KgCO2e", "scope2KgCO2e", "scope2LocationKgCO2e", "scope3KgCO2e", "offsetsKgCO2e"]
    if not all(k not in p or figure_ok(p[k]) for k in names):
        return False
    if e["type"] == "CarbonAttested" and isinstance(p.get("retirements"), list):
        for r in p["retirements"]:
            if not figure_ok(r.get("kg")) or not tonnes_ok(r.get("tonnesRetired")):
                return False
            if dec_of(r["kg"]) > Fraction(r["tonnesRetired"] * 1000):
                return False
    return True


def _offsets_match(e):
    p = e["payload"]
    if e["type"] != "CarbonAttested" or not isinstance(p.get("retirements"), list) or not is_num_type(p.get("offsetsKgCO2e")):
        return True
    items = [r for r in p["retirements"] if isinstance(r, dict) and is_num_type(r.get("kg"))]
    return _sum_kg(items) == dec_of(p["offsetsKgCO2e"])


def _figures_1x_ok(e):
    """L8 for a 1.x event: the 1.2 figure members are present with their types; kWhConsumed, nodeCount and offsetsKgCO2e not negative."""
    p = e["payload"]
    if e["type"] == "EnergyAttested":
        return is_int(p.get("nodeCount"), 0) and is_num(p.get("kWhConsumed"), 0)
    return is_num(p.get("scope2KgCO2e"), float("-inf")) and is_num(p.get("scope3KgCO2e"), float("-inf")) and is_num(p.get("offsetsKgCO2e"), 0) and isinstance(p.get("netZero"), bool)


def _figures_readable(e):
    p = e["payload"]
    return all(k not in p or is_num_type(p[k]) for k in ("scope1KgCO2e", "scope2KgCO2e", "scope3KgCO2e", "offsetsKgCO2e"))


def static_rules(ctx, ev):
    e = ev.event
    reasons, ne = [], []
    shape = event_shape_tokens(ev)
    month = month_of_event(ev)
    entry = ctx.by_operator.get(e.get("subject")) if isinstance(e, dict) else None
    type_ok = isinstance(e, dict) and e.get("type") in ("EnergyAttested", "CarbonAttested")
    network_ok = ev.kind == "1x" or same_host(_get(e, "network"), ctx.network)
    active_ok = entry is not None and (month is None or active_in(entry, month))
    if not type_ok or not network_ok or e.get("subject") != e.get("actor") or entry is None or not active_ok:
        reasons.append("L1")
    if ev.kind == "2x" and month is None:
        reasons.append("L2")
    span = span_of_event(ev)
    if ev.kind == "2x" or month is not None:
        end = _get(e, "payload", "period", "end") if ev.kind == "2x" else add_months(month, 1)
        if not (is_instant(end) and is_instant(e.get("ts")) and at_or_before(end, e["ts"]) and at_or_before(end, ev.commit)):
            reasons.append("L3")
    sig = sig_info(ctx, ev)
    if ev.kind == "1x" and not sig["alg"]:
        ne.append("L5:alg")
    elif not sig["alg"]:
        reasons.append("L5")
    elif not sig["encoding"]:
        reasons.append("encoding")
    elif sig["weak"]:
        reasons.append("weak")
    elif sig["noKey"] or not sig["verified"]:
        reasons.append("L5")
    if ev.kind == "2x":
        if shape or not _figures_ok(e) or not _offsets_match(e):
            reasons.append("L8")
    elif shape or not _figures_1x_ok(e):
        reasons.append("L8")
    if e.get("type") == "CarbonAttested" and not shape and _figures_readable(e) and e["payload"].get("netZero") != coverage_holds(e["payload"]):
        reasons.append("L7")
    return {"reasons": reasons, "ne": ne, "shape": shape, "month": month, "span": span}


def _ckey(subject, type_):
    return "%s|%s" % (subject, type_)


def e_key(subject, type_, month):
    return "%s|%s|%s" % (subject, type_, month)


def state_rules(ctx, st, ev, month):
    e = ev.event
    reasons, ne = [], []
    chain = st["chains"].get(_ckey(e["subject"], e["type"]), [])
    tip = chain[-1]["hash"] if chain else None
    if e.get("prev") != tip:
        ok = False
        if tip is None and is_hex64(e.get("prev")):
            listed = takeover_tip(ctx, e["subject"], e["type"])
            ok = (listed == e["prev"]) if methodology_pinned(ctx) else (True if listed is None else listed == e["prev"])
        if not ok:
            reasons.append("L4")
    if month is not None:
        cur = st["E"].get(e_key(e["subject"], e["type"], month))
        sup = _get(e, "payload", "supersedes")
        if ev.kind == "2x":
            if (sup != cur["hash"]) if cur else (sup is not None):
                reasons.append("L6")
        elif cur:
            earlier = any(c["hash"] == sup and c["month"] == month for c in chain)
            if not earlier:
                reasons.append("L6")
    if ev.kind == "2x":
        if e["type"] == "CarbonAttested" and isinstance(_get(e, "payload", "retirements"), list):
            r = citations(ev)
            regs = registry_forms(ctx)
            if r and regs is None:
                ne.append("L8b:retirement-registries")
            else:
                for x in r:
                    if x.get("registry") not in regs or (isinstance(x.get("reference"), str) and not reference_canonical(x["reference"], form_rules(ctx, x.get("registry")))):
                        reasons.append("L8b")
                        break
            if month is not None and not _l9_holds(ctx, st, ev, month):
                reasons.append("L9")
            if month is not None:
                due = due_of(month)
                if any(not (is_instant(x.get("retiredAt")) and at_or_before(x["retiredAt"], due) and at_or_before(x["retiredAt"], ev.commit)) for x in r):
                    reasons.append("L10")
        if month is not None:
            n = sum(1 for c in chain if c["kind"] == "2x" and c["month"] == month)
            if n >= 20 or len(chain) >= ctx.limits["eventsPerChain"]:
                reasons.append("L12")
    else:
        if e["subject"] in st["twoXBySubject"]:
            reasons.append("L11")
        entry = ctx.by_operator.get(e["subject"])
        if month is not None and entry is not None and entry.form == "2x":
            sw = entry.profile2_from or first_active_month(entry)
            if sw and cmp_instant(month, sw) >= 0:
                reasons.append("L11b")
    return reasons, ne


def _l9_holds(ctx, st, ev, month):
    mine = citations(ev)
    if not mine:
        return True
    own = e_key(ev.event["subject"], ev.event["type"], month)
    others = []
    for k, v in st["E"].items():
        if k != own and v["ev"].kind == "2x" and v["ev"].event.get("type") == "CarbonAttested":
            others.extend(citations(v["ev"]))
    allc = others + mine
    for x in mine:
        same = [y for y in allc if y.get("registry") == x.get("registry") and y.get("reference") == x.get("reference")]
        for y in same:
            if y.get("tonnesRetired") != x.get("tonnesRetired") or cmp_instant(y["retiredAt"], x["retiredAt"]) != 0:
                return False
        total = ZERO
        for y in same:
            total += dec_of(y["kg"])
        if total > Fraction(x["tonnesRetired"] * 1000):
            return False
        if "range-first-last" in form_rules(ctx, x.get("registry")):
            rx = serial_range(x["reference"])
            if rx:
                for y in allc:
                    if y.get("registry") != x.get("registry") or y.get("reference") == x.get("reference"):
                        continue
                    ry = serial_range(y["reference"])
                    if ry and rx[0] <= ry[1] and ry[0] <= rx[1]:
                        return False
    return True


# ---- void acts and the registrar key ----------------------------------------------------------------------

def registrar_keys(ctx):
    named = ctx.pins.get("networkHost")
    # with a named network the read must be of that network: a read that claims another one gets no pinned key
    host = ctx.network if named is None else (named if same_host(named, ctx.network) else None)
    table = ctx.pins.get("registrar") or {}
    pinned = [{"x": x, "status": "current"} for x in (table[host] if host is not None and host in table else [])]
    listed = []
    if methodology_pinned(ctx):
        listed = [{"x": (k.get("jwk") or {}).get("x"), "status": k.get("status")} for k in ctx.params.get("registrar-keys") or []]
    return pinned + listed


def verify_under(keys, obj):
    sig = obj.get("sig") if isinstance(obj, dict) else None
    raw = unb64u(sig.get("value")) if isinstance(sig, dict) and sig.get("alg") == "Ed25519" else None
    if raw is None or len(raw) != 64:
        return {"ok": False, "reason": "encoding"}
    msg = canonicalize(without_sig(obj)).encode("utf-8")
    last = {"ok": False, "reason": "mismatch"}
    for k in keys:
        pub = unb64u(k["x"]) if isinstance(k.get("x"), str) else None
        if not pub:
            continue
        ok, reason = ed_verify(pub, msg, raw)
        if ok:
            return {"ok": True, "status": k.get("status")}
        last = {"ok": False, "reason": reason}
    return last


def _ckey_instant(t):
    p = parse_instant(t)
    return "%s.%s" % p if p else "bad:%s" % t


def void_infos(ctx):
    if "voidInfos" in ctx.cache:
        return ctx.cache["voidInfos"]
    usable = registrar_keys(ctx)   # never the read's own registrar copy: a void without a pinned key is not authenticated
    commits = {}
    for e in ctx.events:
        k = _ckey_instant(e.commit)
        commits[k] = commits.get(k, 0) + 1
    for v in ctx.voids:
        k = _ckey_instant(v.get("commit") if isinstance(v, dict) else None)
        commits[k] = commits.get(k, 0) + 1
    out = []
    for v in ctx.voids:
        extra = not isinstance(v, dict) or len(v) != 3 or "commit" not in v or "target" not in v or "sig" not in v
        if extra:
            out.append({"ok": False, "fail": True, "reason": "extra member"})
            continue
        if not is_instant(v["commit"]):
            out.append({"ok": False, "reason": "commit"})
            continue
        if not usable:
            out.append({"ok": False, "unpinned": True, "reason": "registrar key not pinned"})
            continue
        verified = verify_under(usable, v)
        if not verified["ok"]:
            out.append({"ok": False, "reason": "signature"})
            continue
        target = next((e for e in ctx.events if e.computed == v["target"]), None)
        if target is None or _get(target.event, "type") != "CarbonAttested":
            out.append({"ok": False, "reason": "target"})
            continue
        if not before(target.commit, v["commit"]):
            out.append({"ok": False, "reason": "target"})
            continue
        if commits.get(_ckey_instant(v["commit"])) != 1:
            out.append({"ok": False, "reason": "commit"})
            continue
        out.append({"ok": True, "target": target, "status": verified.get("status")})
    ctx.cache["voidInfos"] = out
    return out


# ---- replay ------------------------------------------------------------------------------------------------

def replay(ctx, cutoff):
    cid = "replay" + cutoff
    if cid in ctx.cache:
        return ctx.cache[cid]
    infos = void_infos(ctx)
    voids = [{"v": v, "info": i} for v, i in zip(ctx.voids, infos) if i["ok"] and at_or_before(v["commit"], cutoff)]
    voids.sort(key=lambda x: parse_instant(x["v"]["commit"]))
    st = {"E": {}, "chains": {}, "twoXBySubject": set(), "verdicts": {}, "voidApplied": []}
    vi = [0]

    def apply_void(x):
        t = x["info"]["target"]
        m = month_of_event(t)
        k = None if m is None else e_key(t.event["subject"], t.event["type"], m)
        hit = k is not None and k in st["E"] and st["E"][k]["hash"] == t.computed
        if hit:
            del st["E"][k]
        st["voidApplied"].append({"target": t.computed, "deleted": hit})

    for ev in ctx.events:
        if not is_instant(ev.commit) or not at_or_before(ev.commit, cutoff):
            continue
        while vi[0] < len(voids) and before(voids[vi[0]]["v"]["commit"], ev.commit):
            apply_void(voids[vi[0]])
            vi[0] += 1
        s = static_rules(ctx, ev)
        e = ev.event
        judged = isinstance(e, dict) and e.get("type") in ("EnergyAttested", "CarbonAttested") and isinstance(e.get("subject"), str)
        dyn_reasons, dyn_ne = state_rules(ctx, st, ev, s["month"]) if judged else ([], [])
        reasons = s["reasons"] + dyn_reasons
        skipped = len(reasons) > 0 or not judged
        st["verdicts"][ev.i] = {"reasons": reasons, "ne": s["ne"] + dyn_ne, "skipped": skipped, "month": s["month"], "shape": s["shape"], "span": s["span"]}
        if judged:
            ck = _ckey(e["subject"], e["type"])
            st["chains"].setdefault(ck, []).append({"hash": ev.computed, "kind": ev.kind, "month": s["month"], "i": ev.i})
            if ev.kind == "2x":
                st["twoXBySubject"].add(e["subject"])
            if not skipped and s["month"] is not None:
                st["E"][e_key(e["subject"], e["type"], s["month"])] = {"hash": ev.computed, "ev": ev, "month": s["month"]}
    while vi[0] < len(voids):
        apply_void(voids[vi[0]])
        vi[0] += 1
    ctx.cache[cid] = st
    return st


# ---- sums (7.4, 7.5, 8.5) ----------------------------------------------------------------------------------

ENERGY_SHIFT = {"Wh": -3, "kWh": 0, "MWh": 3, "GWh": 6}
CARBON_SHIFT = {"gCO2e": -3, "kgCO2e": 0, "tCO2e": 3}


def _p(ev):
    return ev.event["payload"]


def scope2_basis(ctx, ev):
    if ev.kind == "2x":
        return "market-based"
    p = _p(ev)
    if p.get("scope2Method") is not None:
        return p["scope2Method"]
    return ctx.params.get("scope2-basis-1x")


def method_of(ev):
    m = _p(ev).get("measurementMethod")
    return m if m in METHODS else "third-party-modeled"


def derive(ctx, cutoff, period, operators=None):
    """Exact figures for `period` at `cutoff`. `operators` restricts the Registry (operator declarations)."""
    st = replay(ctx, cutoff)
    months = months_between(period["start"], period["end"])
    registry = ctx.registry if operators is None else [en for en in ctx.registry if en.operator in operators]
    counted = sorted((en for en in registry if any(active_in(en, m) for m in months)), key=lambda en: en.operator)
    ops, silent_energy, silent_carbon, no_operator = [], [], [], []
    for m in months:
        if not any(active_in(en, m) for en in counted):
            no_operator.append(m)
    nodes_by_month = {m: 0 for m in months}
    methods = []
    has_s1 = False
    s2_loc = ZERO
    location_available = True
    for en in counted:
        o = {"operator": en.operator, "origin": en.origin, "kwh": ZERO, "s1": ZERO, "s2": ZERO, "s3": ZERO, "off": ZERO, "coverage": True, "has1x": False, "events1x": []}
        for m in months:
            if not active_in(en, m):
                continue
            eE = st["E"].get(e_key(en.operator, "EnergyAttested", m))
            eC = st["E"].get(e_key(en.operator, "CarbonAttested", m))
            if not eE:
                silent_energy.append({"operator": en.operator, "month": m})
            else:
                o["kwh"] += dec_of(_p(eE["ev"])["kWhConsumed"])
                nodes_by_month[m] += _p(eE["ev"])["nodeCount"]
                methods.append(method_of(eE["ev"]))
            if not eC:
                silent_carbon.append({"operator": en.operator, "month": m})
                o["coverage"] = False
                location_available = False
                continue
            basis = scope2_basis(ctx, eC["ev"])
            if eC["ev"].kind == "1x":
                o["has1x"] = True
                o["events1x"].append(eC["ev"].computed)
            q = _p(eC["ev"])
            if basis == "location-based" or basis is None:
                silent_carbon.append({"operator": en.operator, "month": m})
                o["coverage"] = False
                if basis == "location-based":
                    s2_loc += dec_of(q["scope2KgCO2e"])
                else:
                    location_available = False
                continue
            if "scope1KgCO2e" in q:
                has_s1 = True
            o["s1"] += _num(q, "scope1KgCO2e")
            o["s2"] += dec_of(q["scope2KgCO2e"])
            o["s3"] += dec_of(q["scope3KgCO2e"])
            o["off"] += dec_of(q["offsetsKgCO2e"])
            if q.get("netZero") is not True:
                o["coverage"] = False
            if eC["ev"].kind == "2x" and "scope2LocationKgCO2e" in q:
                s2_loc += dec_of(q["scope2LocationKgCO2e"])
            else:
                location_available = False

        def span_end_ok(it):
            v = st["verdicts"][it["i"]]
            return v["span"] is not None and at_or_before(v["span"][1], period["end"])

        def in_period(it):
            v = st["verdicts"][it["i"]]
            return v["span"] is not None and at_or_before(period["start"], v["span"][0]) and at_or_before(v["span"][1], period["end"])

        for type_, hk, ck in (("EnergyAttested", "energyHead", "energyEvents"), ("CarbonAttested", "carbonHead", "carbonEvents")):
            chain = st["chains"].get(_ckey(en.operator, type_), [])
            head = next((it for it in reversed(chain) if span_end_ok(it)), None)
            o[hk] = head["hash"] if head else None
            o[ck] = sum(1 for it in chain if in_period(it))
        ops.append(o)

    def total(k):
        t = ZERO
        for o in ops:
            t += o[k]
        return t

    incomplete_energy = len(silent_energy) > 0 or len(no_operator) > 0
    incomplete_carbon = len(silent_carbon) > 0 or len(no_operator) > 0
    E, S1, S2, S3, Off = total("kwh"), total("s1"), total("s2"), total("s3"), total("off")
    network_coverage = len(ops) > 0 and all(o["coverage"] for o in ops) and len(no_operator) == 0
    status = "achieved" if network_coverage else ("not-achieved" if Off == 0 else "partial")
    least = max(methods, key=METHODS.index) if methods else None
    return {
        "period": period, "months": months, "ops": ops, "silentEnergy": silent_energy, "silentCarbon": silent_carbon, "noOperator": no_operator,
        "incompleteEnergy": incomplete_energy, "incompleteCarbon": incomplete_carbon, "E": E, "S1": S1, "S2": S2, "S3": S3, "Off": Off,
        "hasS1": has_s1, "nodes": max([0] + list(nodes_by_month.values())), "networkCoverage": network_coverage, "status": status, "leastDirect": least,
        "footprint": S1 + S2 + S3, "S2loc": s2_loc, "locationAvailable": location_available and not incomplete_carbon,
        "has1x": any(o["has1x"] for o in ops), "events1x": ["%s: %s" % (o["operator"], h) for o in ops for h in o["events1x"]],
    }


def r6(x):
    return round_half_even(x, 6)


def pub(x):
    return to_published(r6(x))


def _conv(x, sh):
    return shift(x, sh) if sh >= 0 else x * (10 ** -sh)


def evidence_value(d, level="network", access="https://ledger.example/sfc/read"):
    value = {
        "profile-version": "2.0", "ledger-access-uri": access,
        "operators": [{
            "operator": o["operator"], "origin": o["origin"], "energy-head": o["energyHead"], "carbon-head": o["carbonHead"],
            "energy-events": o["energyEvents"], "carbon-events": o["carbonEvents"], "kwh": pub(o["kwh"]), "scope1-kgco2e": pub(o["s1"]),
            "scope2-kgco2e": pub(o["s2"]), "scope3-kgco2e": pub(o["s3"]), "offsets-kgco2e": pub(o["off"]), "offset-coverage-every-period": o["coverage"],
        } for o in d["ops"]],
    }
    if level == "network":
        value["network-offset-coverage"] = d["networkCoverage"]
    return value


def top_level(d, energy_unit="MWh", carbon_unit="tCO2e", consensus="proof-of-authority", level="network"):
    ce = lambda x: pub(_conv(x, ENERGY_SHIFT[energy_unit]))
    cc = lambda x: pub(_conv(x, CARBON_SHIFT[carbon_unit]))
    out = {}
    if d["leastDirect"]:
        out["measurement-method"] = d["leastDirect"]
    if not d["incompleteEnergy"]:
        out["energy-consumption"] = ce(d["E"])
        out["energy-unit"] = energy_unit
    if not d["incompleteCarbon"]:
        if d["hasS1"]:
            out["scope-1"] = cc(d["S1"])
        out["scope-2"] = cc(d["S2"])
        out["scope-3"] = cc(d["S3"])
        out["carbon-footprint"] = cc(d["footprint"])
        out["carbon-unit"] = carbon_unit
        out["carbon-accounting"] = "market-based"
    if not d["incompleteEnergy"] and not d["incompleteCarbon"] and d["E"] != 0:
        out["carbon-intensity-gCO2e-per-kWh"] = pub(r6(d["S2"] * 1000 / d["E"]))
    nt = {"net-zero-status": d["status"]}
    if not d["incompleteCarbon"]:
        nt["offsets-retired-tCO2e"] = pub(shift(d["Off"], 3))
    topo = {"consensus-mechanism": consensus} if level == "network" else {}
    if level == "network" and not d["incompleteEnergy"]:
        topo["validated-node-count"] = d["nodes"]
        topo["node-count-validation-method"] = "maximum over the months of the period of the sum of the operators' monthly peak node counts"
    return {"top": out, "carbonNeutrality": nt, "networkTopology": topo}


def location_figures(d, carbon_unit="tCO2e"):
    if not d["locationAvailable"]:
        return None
    cc = lambda x: pub(_conv(x, CARBON_SHIFT[carbon_unit]))
    out = {"scope-2": cc(d["S2loc"]), "carbon-footprint": cc(d["S1"] + d["S2loc"] + d["S3"])}
    if not d["incompleteEnergy"] and d["E"] != 0:
        out["carbon-intensity-gCO2e-per-kWh"] = pub(r6(d["S2loc"] * 1000 / d["E"]))
    return out
