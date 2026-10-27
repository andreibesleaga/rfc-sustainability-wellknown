"""Building blocks: JSON reading, RFC 8785, base64url, Ed25519, exact decimals, instants, value forms, rows."""
import base64
import hashlib
import re
import calendar
import datetime
from fractions import Fraction

A = re.ASCII

# ---- JSON reading --------------------------------------------------------------------------------

class Issues:
    def __init__(self):
        self.duplicates = []
        self.lone_surrogate = False
        self.lone_count = 0
        # the duplicates and lone surrogates of each top-level array element (of the whole value when it is not an array)
        self.elements = []
        self.depth = 0
        self.max_literal = 0
        self.max_string_bytes = 0


class NumberOutOfRange(ValueError):
    """A number literal that no binary64 value holds (I-JSON, RFC 7493 section 2.2); `literal_length` lets the caller apply the literal limit first."""

    def __init__(self, message, literal_length):
        super().__init__(message)
        self.literal_length = literal_length


MAX_JSON_DEPTH = 64
NESTING_LIMIT = "JSON nesting depth"


class DepthLimit(ValueError):
    """A document nested deeper than MAX_JSON_DEPTH: a limit of section 10, not a syntax error."""

    limit = NESTING_LIMIT


_NUMBER = re.compile(r"-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?")


def _num(lit):
    """A number as the IEEE double JavaScript would hold, kept as int when exactly safe."""
    if re.fullmatch(r"-?(0|[1-9][0-9]*)", lit):
        n = int(lit)
        if abs(n) < 2 ** 53:
            return n
        return float(lit)
    return float(lit)


def read_ijson(text):
    """Strict JSON read. Returns (value, Issues); raises ValueError on a syntax error."""
    issues = Issues()
    pos = [0]
    n = len(text)

    def ws():
        while pos[0] < n and text[pos[0]] in " \t\n\r":
            pos[0] += 1

    def fail(msg):
        raise ValueError("JSON syntax: %s at %d" % (msg, pos[0]))

    def string():
        pos[0] += 1
        out = []
        while True:
            if pos[0] >= n:
                fail("unterminated string")
            c = text[pos[0]]
            pos[0] += 1
            if c == '"':
                break
            if c == "\\":
                e = text[pos[0]]
                pos[0] += 1
                if e == "u":
                    h = text[pos[0]:pos[0] + 4]
                    if not re.fullmatch(r"[0-9a-fA-F]{4}", h):
                        fail("bad escape")
                    out.append(chr(int(h, 16)))
                    pos[0] += 4
                elif e in '"\\/':
                    out.append(e)
                elif e in "bfnrt":
                    out.append({"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t"}[e])
                else:
                    fail("bad escape")
            else:
                if c < " ":
                    fail("control character")
                out.append(c)
        s = "".join(out)
        k = 0
        while k < len(s):
            u = ord(s[k])
            if 0xD800 <= u <= 0xDBFF:
                if k + 1 < len(s) and 0xDC00 <= ord(s[k + 1]) <= 0xDFFF:
                    k += 1
                else:
                    issues.lone_surrogate = True
                    issues.lone_count += 1
            elif 0xDC00 <= u <= 0xDFFF:
                issues.lone_surrogate = True
                issues.lone_count += 1
            k += 1
        # a pair written as two \\u escapes is one character in UTF-16 terms: normalise to the astral character
        s = _join_pairs(s)
        issues.max_string_bytes = max(issues.max_string_bytes, len(re.sub("[\ud800-\udfff]", "�", s).encode("utf-8")))
        return s

    def value(depth):
        ws()
        c = text[pos[0]] if pos[0] < n else ""
        if c in "{[":
            if depth > MAX_JSON_DEPTH:
                raise DepthLimit("JSON limit: " + NESTING_LIMIT)
            issues.depth = max(issues.depth, depth)
        if c == "{":
            pos[0] += 1
            o = {}
            seen = set()
            ws()
            if text[pos[0]] == "}":
                pos[0] += 1
                return o
            while True:
                ws()
                if text[pos[0]] != '"':
                    fail("member name")
                k = string()
                if k in seen:
                    issues.duplicates.append(k)
                seen.add(k)
                ws()
                if text[pos[0]] != ":":
                    fail("colon")
                pos[0] += 1
                o[k] = value(depth + 1)
                ws()
                if text[pos[0]] == ",":
                    pos[0] += 1
                    continue
                if text[pos[0]] == "}":
                    pos[0] += 1
                    return o
                fail("object")
        if c == "[":
            pos[0] += 1
            a = []
            ws()
            if text[pos[0]] == "]":
                pos[0] += 1
                return a
            while True:
                d0, l0 = len(issues.duplicates), issues.lone_count
                a.append(value(depth + 1))
                if depth == 1:
                    issues.elements.append(_findings_since(issues, d0, l0))
                ws()
                if text[pos[0]] == ",":
                    pos[0] += 1
                    continue
                if text[pos[0]] == "]":
                    pos[0] += 1
                    return a
                fail("array")
        if c == '"':
            return string()
        if text.startswith("true", pos[0]):
            pos[0] += 4
            return True
        if text.startswith("false", pos[0]):
            pos[0] += 5
            return False
        if text.startswith("null", pos[0]):
            pos[0] += 4
            return None
        m = _NUMBER.match(text, pos[0])
        if not m:
            fail("value")
        pos[0] = m.end()
        issues.max_literal = max(issues.max_literal, len(m.group(0)))
        number = _num(m.group(0))
        if isinstance(number, float) and number in (float("inf"), float("-inf")):
            raise NumberOutOfRange("JSON syntax: number out of I-JSON range at %d" % pos[0], len(m.group(0)))
        return number

    v = value(1)
    ws()
    if pos[0] != n:
        fail("trailing data")
    if not isinstance(v, list):
        issues.elements = [_findings_since(issues, 0, 0)]
    return v, issues


class ElementIssues:
    """The duplicates and lone surrogates of one served object (the S3 payload comparison reads these)."""
    def __init__(self, duplicates, lone_surrogate):
        self.duplicates = duplicates
        self.lone_surrogate = lone_surrogate


def _findings_since(issues, d0, l0):
    return ElementIssues(issues.duplicates[d0:], issues.lone_count > l0)


def _join_pairs(s):
    out = []
    k = 0
    while k < len(s):
        u = ord(s[k])
        if 0xD800 <= u <= 0xDBFF and k + 1 < len(s) and 0xDC00 <= ord(s[k + 1]) <= 0xDFFF:
            out.append(chr(0x10000 + ((u - 0xD800) << 10) + (ord(s[k + 1]) - 0xDC00)))
            k += 2
        else:
            out.append(s[k])
            k += 1
    return "".join(out)


def load_json(path):
    with open(path, encoding="utf-8") as fh:
        return read_ijson(fh.read())[0]


# ---- RFC 8785 ------------------------------------------------------------------------------------

def number_text(x):
    """ECMAScript Number::toString, which RFC 8785 requires."""
    if isinstance(x, bool):
        raise TypeError("boolean is not a number")
    if isinstance(x, int):
        return str(x)
    if x != x or x in (float("inf"), float("-inf")):
        raise ValueError("non-finite number")
    if x == 0:
        return "0"
    sign = "-" if x < 0 else ""
    s = repr(abs(x))
    mant, exp = (s.split("e") + ["0"])[:2] if "e" in s else (s, "0")
    exp = int(exp)
    ip, fp = (mant.split(".") + [""])[:2] if "." in mant else (mant, "")
    allds = ip + fp
    stripped = allds.lstrip("0")
    lead = len(allds) - len(stripped)
    n = len(ip) + exp - lead
    digits = stripped.rstrip("0") or "0"
    k = len(digits)
    if k <= n <= 21:
        return sign + digits + "0" * (n - k)
    if 0 < n <= 21:
        return sign + digits[:n] + "." + digits[n:]
    if -6 < n <= 0:
        return sign + "0." + "0" * (-n) + digits
    e = n - 1
    es = ("+" if e >= 0 else "-") + str(abs(e))
    if k == 1:
        return sign + digits + "e" + es
    return sign + digits[0] + "." + digits[1:] + "e" + es


def _quote(s):
    out = ['"']
    for ch in s:
        o = ord(ch)
        if ch == '"':
            out.append('\\"')
        elif ch == "\\":
            out.append("\\\\")
        elif ch == "\b":
            out.append("\\b")
        elif ch == "\f":
            out.append("\\f")
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\r":
            out.append("\\r")
        elif ch == "\t":
            out.append("\\t")
        elif o < 0x20 or 0xD800 <= o <= 0xDFFF:
            out.append("\\u%04x" % o)
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def _key(k):
    return k.encode("utf-16-be", "surrogatepass")


def canonicalize(v):
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, (int, float)):
        return number_text(v)
    if isinstance(v, str):
        return _quote(v)
    if isinstance(v, list):
        return "[" + ",".join(canonicalize(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ",".join(_quote(k) + ":" + canonicalize(v[k]) for k in sorted(v, key=_key)) + "}"
    raise TypeError("cannot canonicalise %r" % type(v))


def text_hash(text):
    return hashlib.sha256(text.encode("utf-8", "surrogatepass")).hexdigest()


def hash_of(value):
    return text_hash(canonicalize(value))


def without_sig(o):
    return {k: v for k, v in o.items() if k != "sig"}


def safe_hash(e):
    try:
        return hash_of(e)
    except (TypeError, ValueError):
        return None


# ---- base64url -----------------------------------------------------------------------------------

def b64u(buf):
    return base64.urlsafe_b64encode(bytes(buf)).rstrip(b"=").decode("ascii")


def unb64u(s):
    """The decoded bytes when `s` is the canonical base64url encoding of them, else None."""
    if not isinstance(s, str) or not re.fullmatch(r"[A-Za-z0-9_-]*", s):
        return None
    if len(s) % 4 == 1:
        return None
    b = base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))
    return b if b64u(b) == s else None


def unb64u_lenient(s):
    s2 = s.replace("-", "+").replace("_", "/")
    s2 = re.sub(r"[^A-Za-z0-9+/]", "", s2)
    if len(s2) % 4 == 1:
        s2 = s2[:-1]
    return base64.b64decode(s2 + "=" * (-len(s2) % 4))


# ---- Ed25519 (RFC 8032 section 6 reference arithmetic, section 5.1.7 checks) ----------------------

_P = 2 ** 255 - 19
_L = 2 ** 252 + 27742317777372353535851937790883648493


def _inv(x):
    return pow(x, _P - 2, _P)


_D = -121665 * _inv(121666) % _P
_I = pow(2, (_P - 1) // 4, _P)
_IDENT = (0, 1, 1, 0)


def _add(P, Q):
    A_ = (P[1] - P[0]) * (Q[1] - Q[0]) % _P
    B = (P[1] + P[0]) * (Q[1] + Q[0]) % _P
    C = 2 * P[3] * Q[3] * _D % _P
    D_ = 2 * P[2] * Q[2] % _P
    E, F, G, H = B - A_, D_ - C, D_ + C, B + A_
    return (E * F % _P, G * H % _P, F * G % _P, E * H % _P)


def _mul(P, s):
    Q = _IDENT
    while s > 0:
        if s & 1:
            Q = _add(Q, P)
        P = _add(P, P)
        s >>= 1
    return Q


def _eq(P, Q):
    return (P[0] * Q[2] - Q[0] * P[2]) % _P == 0 and (P[1] * Q[2] - Q[1] * P[2]) % _P == 0


def _recover_x(y, sign):
    if y >= _P:
        return None
    x2 = (y * y - 1) * _inv(_D * y * y + 1) % _P
    if x2 == 0:
        return None if sign else 0
    x = pow(x2, (_P + 3) // 8, _P)
    if (x * x - x2) % _P != 0:
        x = x * _I % _P
    if (x * x - x2) % _P != 0:
        return None
    if (x & 1) != sign:
        x = _P - x
    return x


_GY = 4 * _inv(5) % _P
_GX = _recover_x(_GY, 0)
_B = (_GX, _GY, 1, _GX * _GY % _P)


def decode_point(b):
    if len(b) != 32:
        return None
    v = int.from_bytes(b, "little")
    sign = v >> 255
    y = v & ((1 << 255) - 1)
    x = _recover_x(y, sign)
    if x is None:
        return None
    return (x, y, 1, x * y % _P)


def is_small_order(P):
    return _eq(_mul(P, 8), _IDENT)


_ed_cache = {}


def ed_verify(pub, msg, sig):
    """(ok, reason) with reason in encoding-length, s-range, bad-R, bad-A, weak-A, weak-R, mismatch."""
    key = (bytes(pub), bytes(msg), bytes(sig))
    if key in _ed_cache:
        return _ed_cache[key]
    r = _ed_verify(pub, msg, sig)
    _ed_cache[key] = r
    return r


def _ed_verify(pub, msg, sig):
    if len(sig) != 64 or len(pub) != 32:
        return (False, "encoding-length")
    Apt = decode_point(pub)
    if Apt is None:
        return (False, "bad-A")
    Rpt = decode_point(sig[:32])
    if Rpt is None:
        return (False, "bad-R")
    S = int.from_bytes(sig[32:], "little")
    if S >= _L:
        return (False, "s-range")
    if is_small_order(Apt):
        return (False, "weak-A")
    if is_small_order(Rpt):
        return (False, "weak-R")
    k = int.from_bytes(hashlib.sha512(sig[:32] + pub + msg).digest(), "little") % _L
    lhs = _mul(_B, S)
    rhs = _add(Rpt, _mul(Apt, k))
    return (True, None) if _eq(lhs, rhs) else (False, "mismatch")


# ---- exact decimals ------------------------------------------------------------------------------

ZERO = Fraction(0)


def from_number(x):
    return Fraction(number_text(x))


def parse_dec(text):
    return Fraction(text)


def round_half_even(a, places):
    scaled = a * (10 ** places)
    fl = scaled.numerator // scaled.denominator
    rem = scaled - fl
    if rem > Fraction(1, 2) or (rem == Fraction(1, 2) and fl % 2 == 1):
        fl += 1
    return Fraction(fl, 10 ** places)


def shift(a, k):
    """a / 10^k (k may be negative)."""
    return a / (Fraction(10) ** k)


def to_text(a):
    """Shortest plain decimal for a value with a terminating expansion."""
    neg = a < 0
    a = abs(a)
    p = 0
    while (a * 10 ** p).denominator != 1:
        p += 1
        if p > 60:
            raise ValueError("non-terminating")
    n = int(a * 10 ** p)
    st = str(n).rjust(p + 1, "0")
    out = st if p == 0 else st[:len(st) - p] + "." + st[len(st) - p:]
    if p:
        out = out.rstrip("0").rstrip(".")
    return ("-" if neg and out != "0" else "") + out


def to_published(a):
    text = to_text(a)
    x = float(text)
    if x == int(x) and abs(x) < 2 ** 53 and "." not in text:
        x = int(text)
    if from_number(x) != a:
        raise ValueError("value %s is not representable as an RFC 8785 number text" % text)
    return x


# ---- instants ------------------------------------------------------------------------------------

_INSTANT = re.compile(r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})", A)


def parse_instant(text):
    """(epoch seconds, fraction digits without trailing zeros) or None; string order of the fraction is numeric order."""
    if not isinstance(text, str):
        return None
    m = _INSTANT.fullmatch(text)
    if not m:
        return None
    Y, Mo, D, h, mi, s = (int(x) for x in m.groups()[:6])
    if Mo < 1 or Mo > 12 or D < 1 or h > 23 or mi > 59 or s > 59:
        return None
    if D > calendar.monthrange(Y, Mo)[1]:
        return None
    off = 0
    if m.group(8) != "Z":
        oh, om = (int(x) for x in m.group(8)[1:].split(":"))
        if oh > 23 or om > 59:
            return None
        off = (-1 if m.group(8)[0] == "-" else 1) * (oh * 60 + om) * 60
    sec = calendar.timegm((Y, Mo, D, h, mi, s)) - off
    frac = (m.group(7) or "").rstrip("0")
    return (sec, frac)


def cmp_instant(a, b):
    x, y = parse_instant(a), parse_instant(b)
    return (x > y) - (x < y)


def before(a, b):
    return cmp_instant(a, b) < 0


def at_or_before(a, b):
    return cmp_instant(a, b) <= 0


def is_instant(t):
    return parse_instant(t) is not None


def is_month_bound(t):
    return isinstance(t, str) and re.fullmatch(r"\d{4}-\d{2}-01T00:00:00Z", t, A) is not None and is_instant(t)


def is_full_date(t):
    return isinstance(t, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", t, A) is not None and is_instant(t + "T00:00:00Z")


def fmt(sec):
    d = datetime.datetime.fromtimestamp(sec, datetime.timezone.utc)
    return "%04d-%02d-%02dT%02d:%02d:%02dZ" % (d.year, d.month, d.day, d.hour, d.minute, d.second)


def epoch(t):
    return parse_instant(t)[0]


def add_seconds(t, k):
    return fmt(epoch(t) + k)


def add_days(t, k):
    return add_seconds(t, k * 86400)


def month_bound(year, month):
    y = year + (month - 1) // 12
    m = (month - 1) % 12 + 1
    return "%04d-%02d-01T00:00:00Z" % (y, m)


def add_months(bound, k):
    y, m = int(bound[:4]), int(bound[5:7])
    return month_bound(y, m + k)


def month_of(t):
    d = datetime.datetime.fromtimestamp(epoch(t), datetime.timezone.utc)
    return month_bound(d.year, d.month)


GRACE_DAYS = 5


def due_of(start):
    return add_days(add_months(start, 1), GRACE_DAYS)


def months_between(start, end):
    out = []
    m = start
    while before(m, end):
        out.append(m)
        m = add_months(m, 1)
    return out


def add_calendar_months(t, k):
    """Calendar-month arithmetic with clamping to the last day, UTC, time and fraction kept (compare the result as a moment)."""
    d = datetime.datetime.fromtimestamp(epoch(t), datetime.timezone.utc)
    y, m0, day = d.year, d.month - 1 + k, d.day
    y += m0 // 12
    m0 = m0 % 12
    last = calendar.monthrange(y, m0 + 1)[1]
    r = datetime.datetime(y, m0 + 1, min(day, last), d.hour, d.minute, d.second, tzinfo=datetime.timezone.utc)
    text = fmt(int(r.timestamp()))
    frac = parse_instant(t)[1]
    return text[:-1] + "." + frac + "Z" if frac else text


def window_of(T):
    last = month_of(T)
    while before(T, due_of(last)):
        last = add_months(last, -1)
    return months_between(add_months(last, -11), add_months(last, 1))


# ---- value forms ---------------------------------------------------------------------------------

def is_object(v):
    return isinstance(v, dict)


def is_num_type(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def is_hex64(v):
    return isinstance(v, str) and re.fullmatch(r"[0-9a-f]{64}", v, A) is not None


def is_b64url(v, nbytes=None):
    b = unb64u(v)
    return b is not None and (nbytes is None or len(b) == nbytes)


_IDCHAR = r"(?:[A-Za-z0-9._-]|%[0-9A-Fa-f]{2})"
_DID = re.compile(r"did:[a-z0-9]+:(?:%s*:)*%s+" % (_IDCHAR, _IDCHAR), A)
_LABEL = r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
_HOST = re.compile(r"%s(?:\.%s)*" % (_LABEL, _LABEL), A)


def is_did(v):
    return isinstance(v, str) and _DID.fullmatch(v) is not None


def is_host(v):
    return isinstance(v, str) and len(v) <= 253 and _HOST.fullmatch(v) is not None


def is_https_uri(v):
    return isinstance(v, str) and re.fullmatch(r"https://\S+", v, A) is not None


def is_uri_abs(v):
    return isinstance(v, str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9+.-]*:\S+", v, A) is not None


def same_host(a, b):
    return isinstance(a, str) and isinstance(b, str) and a.lower() == b.lower()


def same_target(a, b):
    """The same `target` (7.3, S4): host names compare after ASCII lower-casing; any other target as an exact string."""
    return a == b or (is_host(a) and is_host(b) and same_host(a, b))


def is_int(v, minimum=0):
    if isinstance(v, bool):
        return False
    if isinstance(v, int):
        return v >= minimum
    if isinstance(v, float):
        return v.is_integer() and v >= minimum
    return False


def is_num(v, minimum=0):
    return is_num_type(v) and v == v and v not in (float("inf"), float("-inf")) and v >= minimum


def figure_ok(x):
    """3.3 rule 2 on the RFC 8785 text of a figure."""
    if not is_num_type(x) or x != x or x < 0 or x in (float("inf"),):
        return False
    text = number_text(x)
    m = re.fullmatch(r"(0|[1-9][0-9]*)(?:\.([0-9]+))?", text)
    if not m:
        return False
    frac = m.group(2) or ""
    if len(frac) > 6:
        return False
    digits = 0 if (m.group(1) == "0" and frac == "") else len(m.group(1)) + len(frac)
    return digits <= 15


def tonnes_ok(x):
    return isinstance(x, int) and not isinstance(x, bool) and x >= 1 and len(str(x)) <= 15


# ---- rows ----------------------------------------------------------------------------------------

PASS, FAIL, NE, DECLARED, NOT_DECLARED, INFO = "PASS", "FAIL", "NOT-EVALUABLE", "DECLARED", "NOT-DECLARED", "INFO"
_RANK = {FAIL: 3, NE: 2, PASS: 1}


def row(id_, result, detail=None, scope=None):
    r = {"id": id_, "result": result}
    if scope is not None:
        r["scope"] = scope
    if detail is not None and detail != "":
        r["detail"] = detail
    return r


def worst(*rs):
    best = rs[0]
    for r in rs[1:]:
        if _RANK.get(r, 0) > _RANK.get(best, 0):
            best = r
    return best


def jlist(xs):
    return "; ".join(sorted(set(xs), key=_key))
