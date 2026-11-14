/**
 * Reads the list of origins: one host per line, or the Tranco format
 * (`rank,domain`). Blank lines and `#` comments are ignored, the order is kept
 * and a host listed twice is kept once.
 */
const HEADER_WORDS = new Set(["rank", "domain", "host", "hostname", "origin"]);
const HOST_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[1-9]\d{0,4})?$/;

/** Shape is not enough: the port must be in range and the URL parser must accept the host. */
function isCrawlable(host) {
  if (!HOST_RE.test(host)) return false;
  try {
    new URL(`https://${host}/`);
    return true;
  } catch {
    return false;
  }
}

function hostOfField(field) {
  const noScheme = field.trim().toLowerCase().replace(/^https?:\/\//, "");
  return noScheme.split("/")[0];
}

function fieldsOf(line) {
  const fields = line.split(",").map((f) => f.trim());
  return fields.length > 1 && /^\d+$/.test(fields[0]) ? [fields[1]] : [fields[0]];
}

function isHeader(line) {
  return line.split(",").every((f) => HEADER_WORDS.has(f.trim().toLowerCase()));
}

/** @returns {{hosts: string[], rejected: string[]}} */
export function parseOriginList(text) {
  const hosts = [];
  const rejected = [];
  const seen = new Set();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  lines.forEach((line, index) => {
    if (index === 0 && isHeader(line)) return;
    const host = hostOfField(fieldsOf(line)[0]);
    if (!isCrawlable(host)) return void rejected.push(line);
    if (seen.has(host)) return;
    seen.add(host);
    hosts.push(host);
  });
  return { hosts, rejected };
}
