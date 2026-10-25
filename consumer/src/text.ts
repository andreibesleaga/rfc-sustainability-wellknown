/**
 * Display helpers for document-derived text.
 *
 * Draft -10 §Security Considerations: human-readable members may
 * carry any script and direction, and a consumer that displays one can
 * isolate it from the surrounding text (UAX #9). `isolate` wraps a string in FIRST STRONG ISOLATE
 * … POP DIRECTIONAL ISOLATE (Unicode §23.2) so a right-to-left `provider` or
 * `target` value cannot reorder the message it is embedded in. Applied to
 * human-readable output only; machine outputs (JSON, CSV, NDJSON) carry the
 * data unchanged.
 */
export const FSI = "⁨";
export const PDI = "⁩";

export function isolate(text: string): string {
  return `${FSI}${text}${PDI}`;
}
