"""Reading a declaration object and the limits scan."""
from .base import FAIL, add_months, is_int, is_month_bound, is_num, row, same_target

EXT = "https://andreibesleaga.com/sfc/extensions/"
OLD_EVIDENCE = EXT + "ledger-evidence"


def ext_of(obj, name):
    if isinstance(obj, dict) and isinstance(obj.get("extensions"), dict):
        v = obj["extensions"].get(EXT + name)
        if isinstance(v, dict):
            return v
    return None


def level_of(obj):
    tp = ext_of(obj, "network-topology")
    if tp is not None and isinstance(tp.get("member-of-network"), str):
        return "operator"
    return "operator" if isinstance(obj, dict) and obj.get("target-type") == "origin" else "network"


def claims_sfc(obj):
    if not (isinstance(obj, dict) and isinstance(obj.get("extensions"), dict)):
        return False
    for k in obj["extensions"]:
        if k.startswith(EXT) and k != OLD_EVIDENCE and k[len(EXT):] in ("hardware-lifecycle", "carbon-neutrality", "network-topology", "ledger-evidence-2"):
            return True
    return False


def objects_of(doc):
    return [o for o in (doc if isinstance(doc, list) else [doc]) if isinstance(o, dict)]


def body_shape_rows(doc):
    """S2 FAIL rows for a served body that is neither a declaration object nor an array of them (9.1)."""
    if isinstance(doc, dict):
        return []
    if not isinstance(doc, list):
        return [row("S2", FAIL, "body is not a declaration object or an array of them")]
    return [row("S2", FAIL, "item %d is not an object" % i) for i, x in enumerate(doc) if not isinstance(x, dict)]


def same_period_target(a, b):
    pa, pb = a.get("period") or {}, b.get("period") or {}
    return same_target(a.get("target"), b.get("target")) and pa.get("start") == pb.get("start") and pa.get("end") == pb.get("end")


_TYPE_TESTS = {
    "number": lambda v: is_num(v, float("-inf")),
    "integer": lambda v: is_int(v, float("-inf")),
    "boolean": lambda v: isinstance(v, bool),
    "string": lambda v: isinstance(v, str),
}
# the optional members of the extension tables (8.2 to 8.4) with their JSON types: a wrong-typed one is read as absent (8.1), INFO under S6 a
OPTIONAL_EXT_MEMBERS = {
    "hardware-lifecycle": {"expected-service-life-years": "number", "embodied-carbon-in-scope-3": "boolean", "reuse-and-recycling-policy-uri": "string"},
    "carbon-neutrality": {"renewable-procurement": "string", "residual-emissions-tCO2e": "number", "offsets-retired-tCO2e": "number", "offset-registry-uri": "string", "offsets-attested-by": "string"},
    "network-topology": {"nakamoto-coefficient": "integer", "per-transaction-energy-Wh": "number", "geographic-regions": "integer", "network-declaration": "string"},
}


NUMERIC_MEMBERS = ["energy-consumption", "carbon-footprint", "scope-1", "scope-2", "scope-3", "carbon-intensity-gCO2e-per-kWh", "renewable-energy"]
UNIT_MEMBERS = ["energy-unit", "carbon-unit", "carbon-accounting"]


def read_as_absent(obj):
    """The object as the figure checks read it: a member of the wrong JSON type is read as absent (8.1); the served object is not changed."""
    out = dict(obj)
    for k in NUMERIC_MEMBERS:
        if k in out and not is_num(out[k], float("-inf")):
            del out[k]
    for k in UNIT_MEMBERS:
        if k in out and not isinstance(out[k], str):
            del out[k]
    if isinstance(out.get("extensions"), dict):
        ext = dict(out["extensions"])
        for token in mistyped_members(obj):
            name, member = token.split(".")
            value = dict(ext[EXT + name])
            del value[member]
            ext[EXT + name] = value
        out["extensions"] = ext
    return out


def mistyped_members(obj):
    """`<extension>.<member>` for each optional extension member whose JSON type is wrong, in table order."""
    out = []
    for name, table in OPTIONAL_EXT_MEMBERS.items():
        ext = ext_of(obj, name)
        if ext is None:
            continue
        for member, type_ in table.items():
            if member in ext and not _TYPE_TESTS[type_](ext[member]):
                out.append("%s.%s" % (name, member))
    return out


def usable_period(decl):
    """The period the deep check may walk: both bounds month-bound, the end one month or twelve months after the start. Else None."""
    p = (decl or {}).get("period")
    if not isinstance(p, dict) or not is_month_bound(p.get("start")) or not is_month_bound(p.get("end")):
        return None
    return p if p["end"] in (add_months(p["start"], 1), add_months(p["start"], 12)) else None


def label_of(o):
    p = o.get("period") or {}
    start = p.get("start") if p.get("start") is not None else "-"
    end = p.get("end") if p.get("end") is not None else "-"
    return "%s %s..%s %s" % (o.get("target"), str(start)[:10], str(end)[:10], o.get("carbon-accounting") if o.get("carbon-accounting") is not None else "-")


# ---- limits -----------------------------------------------------------------------------------------------

def _depth(v):
    if not isinstance(v, (dict, list)):
        return 0
    kids = v if isinstance(v, list) else list(v.values())
    return 1 + max([0] + [_depth(k) for k in kids])


def _strings(v, out):
    if isinstance(v, str):
        out.append(v)
    elif isinstance(v, (dict, list)):
        for k in (v if isinstance(v, list) else v.values()):
            _strings(k, out)
    return out


def _longest_array(v, skip_keys):
    best = [0]

    def walk(x, key):
        if isinstance(x, list):
            if key not in skip_keys:
                best[0] = max(best[0], len(x))
            for y in x:
                walk(y, None)
        elif isinstance(x, dict):
            for k, y in x.items():
                walk(y, k)

    walk(v, None)
    return best[0]


_OWN = ["ledger", "registry", "operators", "chains", "voids"]


def _jsize(v):
    return len(canonical_json(v).encode("utf-8", "surrogatepass"))


def canonical_json(v):
    """Compact JSON as JSON.stringify writes it (insertion order), for byte limits only."""
    import json
    return json.dumps(v, ensure_ascii=False, separators=(",", ":"))


def scan_limits(ex, limits, raw_issues, params):
    hits = []

    def add(name, event=None):
        hits.append({"limit": name, "event": event})

    if len(canonical_json(ex).encode("utf-8", "surrogatepass")) > limits["readBytes"]:
        add("bytes per read")
    if len(ex.get("registry") or []) > limits["registryEntries"]:
        add("entries in the Registry")
    if len(ex.get("voids") or []) > limits["voids"]:
        add("entries in voids")
    if len((ex.get("checkpoint") or {}).get("chains") or []) > limits["checkpointChains"]:
        add("entries in checkpoint.chains")
    subjects = set()
    for l in ex.get("ledger") or []:
        e = l.get("event")
        subjects.add(e.get("subject") if isinstance(e, dict) else None)
    if len(subjects) > limits["operators"]:
        add("operators in a read")
    per_chain = {}
    for i, l in enumerate(ex.get("ledger") or []):
        e = l.get("event")
        k = "%s|%s" % (e.get("subject") if isinstance(e, dict) else None, e.get("type") if isinstance(e, dict) else None)
        per_chain[k] = per_chain.get(k, 0) + 1
        if per_chain[k] == limits["eventsPerChain"] + 1:
            add("events per chain")
        if len(canonical_json(e).encode("utf-8", "surrogatepass")) > limits["eventBytes"]:
            add("bytes per event", i)
        r = ((e or {}).get("payload") or {}).get("retirements") if isinstance(e, dict) and isinstance(e.get("payload"), dict) else None
        if isinstance(r, list) and len(r) > limits["retirements"]:
            add("retirements per event", i)
        if any(len(s.encode("utf-8", "surrogatepass")) > limits["stringBytes"] for s in _strings(e, [])):
            add("bytes in a string value", i)
        if _depth(e) > limits["nesting"]:
            add("JSON nesting depth", i)
        if _longest_array(e, ["retirements"]) > limits["arrayItems"]:
            add("items in one array", i)
    if _depth(ex) > limits["nesting"] and not any(h["limit"] == "JSON nesting depth" for h in hits):
        add("JSON nesting depth")
    rest = dict(ex)
    rest.update({"ledger": [], "registry": [], "voids": []})
    rest.pop("checkpoint", None)
    if _longest_array(rest, _OWN) > limits["arrayItems"]:
        add("items in one array")
    if any(_longest_array(en, []) > limits["arrayItems"] for en in (ex.get("registry") or [])):
        add("items in one array")
    if raw_issues is not None and raw_issues.max_literal > limits["literalChars"]:
        add("characters in a number literal")
    if any(isinstance(v, list) and len(v) > limits["parameterArray"] for v in (params or {}).values()):
        add("entries in each parameters array")
    return hits
