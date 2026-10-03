"""Shared by the Python recipes: the document bytes and the four headers."""
import hashlib
import os
from email.utils import formatdate
from pathlib import Path

PATH = "/.well-known/sustainability-data"
# The document: data/sustainability-data.json beside the recipe, or the file SD_FILE names.
FILE = Path(os.environ.get("SD_FILE") or Path(__file__).resolve().parent / "data" / "sustainability-data.json")
try:
    BODY = FILE.read_bytes()
except OSError as err:
    raise SystemExit(f"cannot read the declaration at {FILE} ({err.strerror}); put it there or set SD_FILE") from err
ETAG = '"%s"' % hashlib.sha256(BODY).hexdigest()[:32]
LAST_MODIFIED = formatdate(FILE.stat().st_mtime, usegmt=True)
HEADERS = {
    "Content-Type": "application/sustainability-data+json",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=86400",
    "ETag": ETAG,
    "Last-Modified": LAST_MODIFIED,
}


def fresh(if_none_match: str | None) -> bool:
    """True when the request's If-None-Match names the current entity."""
    if not if_none_match:
        return False
    tags = [t.strip() for t in if_none_match.split(",")]
    return "*" in tags or ETAG in tags or ("W/" + ETAG) in tags
