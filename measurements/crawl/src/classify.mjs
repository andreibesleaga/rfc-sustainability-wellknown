/**
 * Turns one HTTP answer into a classification. Pure: the consumer library is
 * passed in, nothing here touches the network or the disk.
 *
 * Classifications:
 *   valid             declaration the consumer library accepts
 *   invalid           JSON that parses but is not a valid declaration
 *   parseable         carbon.txt-like text, or a JSON object at dist.json
 *   unparseable       200, not a web page, not the expected format
 *   wrong-media-type  200 at the declaration path with a media type the draft rules out
 *   html-soft-404     200 with a web page
 *   other-200         200 at the random probe path, not a web page
 *   not-found         404 or 410
 *   denied            401, 403 or 451
 *   blocked-by-robots not requested: robots.txt forbids it
 *   robots-unreachable not requested: robots.txt could not be read (5xx, network, redirect off site)
 *   error             anything else: 5xx, network, timeout, redirect refused
 */
const HTML_SNIFF = /^\s*(<!doctype\s+html|<html|<head|<body)/i;
const CARBON_TXT_SNIFF = /^\s*\[(org|upstream)\]/m;

export function isHtml(contentType, bytes) {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (type === "text/html" || type === "application/xhtml+xml") return true;
  return HTML_SNIFF.test(new TextDecoder().decode(bytes.subarray(0, 512)));
}

function byStatus(status) {
  if (status === 404 || status === 410) return "not-found";
  if ([401, 403, 451].includes(status)) return "denied";
  return "error";
}

function parseJson(consumer, text) {
  try {
    return { value: consumer.parseStrict(text) };
  } catch {
    return null;
  }
}

function judgeDeclaration(consumer, contentType, text) {
  if (consumer.classifyMediaType(contentType) === "other") return { classification: "wrong-media-type" };
  const parsed = parseJson(consumer, text);
  if (!parsed) return { classification: "unparseable" };
  const result = consumer.validateDocument(parsed.value);
  return { classification: result.valid ? "valid" : "invalid", store: true, errors: result.errors.slice(0, 5) };
}

function judgeJsonObject(consumer, text) {
  const parsed = parseJson(consumer, text);
  const isObject = parsed && typeof parsed.value === "object" && parsed.value !== null && !Array.isArray(parsed.value);
  return isObject ? { classification: "parseable", store: true } : { classification: "unparseable" };
}

function judgeCarbonTxt(text) {
  return CARBON_TXT_SNIFF.test(text) ? { classification: "parseable", store: true } : { classification: "unparseable" };
}

/**
 * @param {object} consumer the consumer library
 * @param {"declaration"|"carbon-txt"|"json-object"|"random"|"robots"} kind
 * @param {{status:number, contentType:string|null, body:Uint8Array, truncated:boolean}} response
 * @returns {{classification:string, store?:boolean, errors?:string[]}}
 */
export function classify(consumer, kind, response) {
  if (response.status !== 200) return { classification: byStatus(response.status) };
  if (isHtml(response.contentType, response.body)) return { classification: "html-soft-404" };
  if (kind === "random") return { classification: "other-200" };
  if (kind === "robots") return { classification: "parseable" };
  if (response.truncated) return { classification: "unparseable", errors: ["body larger than the size cap"] };
  const text = new TextDecoder().decode(response.body);
  if (kind === "declaration") return judgeDeclaration(consumer, response.contentType, text);
  if (kind === "json-object") return judgeJsonObject(consumer, text);
  return judgeCarbonTxt(text);
}
