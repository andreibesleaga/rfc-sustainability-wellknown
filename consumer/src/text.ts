/**
 * Display helpers for document-derived text.
 *
 * Draft -06 §Internationalization Considerations: human-readable members may
 * carry any script and direction, and a client that displays one SHOULD
 * render it under the Unicode Bidirectional Algorithm and SHOULD isolate it
 * from the surrounding text. `isolate` wraps a string in FIRST STRONG ISOLATE
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
