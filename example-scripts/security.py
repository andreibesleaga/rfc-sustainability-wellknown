"""
The three safeguards of the draft's Security and Privacy Considerations, as a
zero-dependency kit (the same behavior as the publisher's `secureReports`):

 1. DoS protection      - refuse a held set above 366 objects; an answer is never truncated.
 2. Traffic analysis    - keep to periods of a calendar day or longer: by default an
                          object whose bounds are not the first instant of a calendar
                          day in their own offset is dropped with a warning.
 3. Anti-fingerprinting - OFF BY DEFAULT. With `apply_noise` and `noise_disclosed`, one
                          factor within 0.99 to 1.01 multiplies the perturbed members.

A publisher that applies noise MUST state so, and bound its size, in its
methodology document; `noise_disclosed=True` is the operator's confirmation that
it did. Nothing here can check it.

A date-time is an RFC 3339 `date-time` with upper-case `T` and `Z`. A period is
the half-open range from `period.start` to `period.end`; arrays are ordered by
the instant of `start`, then of `end`, then by `target`.
"""
import re
from collections import namedtuple
from datetime import datetime, timezone
from urllib.parse import unquote_plus

# The members the one factor applies to: the additive quantities and those derived
# from them, so that no unperturbed member discloses a perturbed one. Ratios and
# percentages stay as they are.
NOISE_MEMBERS = (
    "energy-consumption",
    "carbon-footprint",
    "scope-1",
    "scope-2",
    "scope-3",
    "estimated-annual-emissions-kgCO2e",
    "sci-score",
)

_DATE_TIME = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-])(\d{2}):(\d{2}))$"
)


# The instant as whole seconds and nine digits of fraction, whether it is midnight
# in the offset it is written in, and its calendar date in that offset.
DateTime = namedtuple("DateTime", "seconds fraction midnight date")


def parse_date_time(value):
    """Read an RFC 3339 date-time into a DateTime. Second 60 is read as 59.
    Raises ValueError for anything else."""
    m = _DATE_TIME.match(value) if isinstance(value, str) else None
    if not m:
        raise ValueError(f"not an RFC 3339 date-time with upper-case T and Z: {value!r}")
    year, month, day, hour, minute, second = (int(g) for g in m.group(1, 2, 3, 4, 5, 6))
    offset_hour, offset_minute = int(m.group(9) or 0), int(m.group(10) or 0)
    if second > 60 or offset_hour > 23 or offset_minute > 59:
        raise ValueError(f"not a real date and time: {value!r}")
    try:
        moment = datetime(year, month, day, hour, minute, min(second, 59), tzinfo=timezone.utc)
    except ValueError:
        raise ValueError(f"not a real date and time: {value!r}") from None
    sign = -1 if m.group(8) == "-" else 1
    seconds = int(moment.timestamp()) - sign * (offset_hour * 60 + offset_minute) * 60
    fraction = (m.group(7) or "").ljust(9, "0")[:9]
    midnight = (hour, minute, second) == (0, 0, 0) and not fraction.strip("0")
    return DateTime(seconds, fraction, midnight, moment.date())


def _utc_form(seconds, fraction):
    """The instant in UTC with `Z`, a fraction only when it is not zero."""
    whole = datetime.fromtimestamp(seconds, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    digits = fraction.rstrip("0")
    return f"{whole}.{digits}Z" if digits else f"{whole}Z"


def canonical_key(period):
    """A key for the period that is the same however its bounds are spelled: `Z`,
    `+00:00` and `.000Z` agree."""
    start, end = (parse_date_time(period[name]) for name in ("start", "end"))
    return f"{_utc_form(*start[:2])}/{_utc_form(*end[:2])}"


def is_on_day_boundaries(period):
    """Whether both bounds are the first instant of a calendar day in their own
    offset. The 23-hour and 25-hour days of a daylight-saving change qualify."""
    return parse_date_time(period["start"]).midnight and parse_date_time(period["end"]).midnight


def sort_key(obj):
    """The order of an array: the instant of `period.start`, then of `period.end`,
    then `target` in code point order (Python compares str by code point)."""
    start, end = (parse_date_time(obj["period"][name]) for name in ("start", "end"))
    return (start[:2], end[:2], obj["target"])


def fuzz_factor_for(key):
    """Deterministic factor from 0.99 to 1.01 (djb2 hash) of a period's canonical
    key. Noise is applied once, when the object is generated, so the same period
    always gives the same published values."""
    h = 5381
    for ch in key:
        h = ((h << 5) + h + ord(ch)) & 0xFFFFFFFF
    return 0.99 + (h % 1000) / 1000 * 0.02


def is_whole_calendar_period(period, unit):
    """Whether the period is a whole calendar day, month or year ("daily",
    "monthly", "yearly"): each bound is midnight in its own offset, the end is the
    next day, month or year of the start. Several whole months are not a whole month."""
    start, end = (parse_date_time(period[name]) for name in ("start", "end"))
    if not (start.midnight and end.midnight):
        return False
    first, nxt = start.date, end.date
    if unit == "yearly":
        return (first.month, first.day, nxt.month, nxt.day) == (1, 1, 1, 1) and nxt.year == first.year + 1
    if unit == "monthly":
        months = (nxt.year - first.year) * 12 + nxt.month - first.month
        return first.day == 1 and nxt.day == 1 and months == 1
    return (nxt - first).days == 1


_UTC_DATE_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$")


def _is_utc_date_time(value):
    """A utc-date-time that names a real moment. Second 60 would be read as 59, so it does not count."""
    if not _UTC_DATE_TIME.match(value) or value[17:19] == "60":
        return False
    try:
        parse_date_time(value)
    except ValueError:
        return False
    return True


_VALID_VALUE = {
    "target": lambda value: value != "",
    "start": _is_utc_date_time,
    "end": _is_utc_date_time,
    "granularity": lambda value: value in ("yearly", "monthly", "daily"),
}


def honored_query(raw_query):
    """The parameters of a query string that a server honors, as a dict. Names and
    values are percent-decoded ("+" as a space) and compared case-sensitively. A
    value that does not match the draft's rule, and a name that appears more than
    once, are ignored: never an error, never read as another value."""
    seen = {}
    for part in raw_query.split("&"):
        name, _, value = part.partition("=")
        name = unquote_plus(name)
        if name in _VALID_VALUE:
            seen.setdefault(name, []).append(unquote_plus(value))
    return {name: values[0] for name, values in seen.items() if len(values) == 1 and _VALID_VALUE[name](values[0])}


_HOST_NAME = re.compile(r"^[^\s/]+\.[^\s/]+$")
_ORIGIN_HOST = re.compile(r"^[^\s/]+$")


def _lower_ascii(text):
    return "".join(chr(ord(c) + 32) if "A" <= c <= "Z" else c for c in text)


def target_equals(obj, value):
    """The target member equals the value; a host name compares without regard to
    ASCII case (RFC 3986, Section 3.2.2), nothing else is folded."""
    if obj["target"] == value:
        return True
    host = _ORIGIN_HOST if obj.get("target-type") == "origin" else _HOST_NAME
    return bool(host.match(obj["target"]) and host.match(value)) and _lower_ascii(obj["target"]) == _lower_ascii(value)


def select_objects(held, query):
    """The objects that satisfy every honored parameter, in ascending order; an empty
    list when none does. Nothing is summed or merged: objects come back as held.
      start and end: the period overlaps the range, which includes start and excludes end.
      target: equals the value.
      granularity: the period is a whole calendar year, month or day."""
    start = parse_date_time(query["start"])[:2] if "start" in query else None
    end = parse_date_time(query["end"])[:2] if "end" in query else None

    def satisfies(obj):
        period_start, period_end = (parse_date_time(obj["period"][name])[:2] for name in ("start", "end"))
        return (
            (end is None or period_start < end)
            and (start is None or period_end > start)
            and ("target" not in query or target_equals(obj, query["target"]))
            and ("granularity" not in query or is_whole_calendar_period(obj["period"], query["granularity"]))
        )

    return sorted((obj for obj in held if satisfies(obj)), key=sort_key)


def supports_parameters(held):
    """A server whose objects are all `basic` supports no query parameter."""
    return any(obj.get("capabilities") == "extended" for obj in held)


def answer_query(held, raw_query):
    """The objects to serve for a request. A server that supports no parameter
    ignores them all and answers with what it holds, as it holds it (a static
    file). Otherwise it honors the parameters that match the draft; with none,
    the answer is every object held."""
    if supports_parameters(held):
        return select_objects(held, honored_query(raw_query))
    return list(held)


def _with_noise(obj):
    fuzz = fuzz_factor_for(canonical_key(obj["period"]))
    secured = dict(obj)
    for member in NOISE_MEMBERS:
        value = secured.get(member)
        # Multiplication keeps the sign (scopes MAY be negative under net accounting).
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            secured[member] = float(f"{value * fuzz:.5e}")  # six significant digits
    return secured


def secure_sustainability_report(
    reports, max_objects=366, day_floor="drop", apply_noise=False, noise_disclosed=False, on_warning=None
):
    """Apply the safeguards to a list of objects; returns a new list in ascending
    order of period, of at most `max_objects` objects (a larger held set is refused). `day_floor` is "drop",
    "warn" or "off"."""
    warn = on_warning or (lambda message: None)
    if apply_noise and not noise_disclosed:
        raise ValueError(
            "apply_noise needs noise_disclosed=True, your confirmation that the "
            "methodology document states the noise and bounds it"
        )

    # Filter before capping, so dropped objects do not use up slots of the cap.
    secured = list(reports)
    if day_floor != "off":
        kept = []
        for obj in secured:
            if is_on_day_boundaries(obj["period"]):
                kept.append(obj)
                continue
            warn(f"period {obj['period']['start']} to {obj['period']['end']} of {obj['target']!r} is not on day boundaries")
            if day_floor == "warn":
                kept.append(obj)
        secured = kept

    secured.sort(key=sort_key)
    if len(secured) > max_objects:
        raise ValueError(
            f"{len(secured)} objects held, more than max_objects ({max_objects}); "
            "raise max_objects or hold fewer objects (an answer is never truncated)"
        )
    return [_with_noise(obj) for obj in secured] if apply_noise else secured
