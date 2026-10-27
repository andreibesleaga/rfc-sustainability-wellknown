/**
 * Exception text can carry hostile input (an attacker-chosen value or an internal property name), so reports
 * and the command line print a fixed message. The text goes to standard error only when SFC_DEBUG is set.
 */
export const debugEnabled = () => Boolean(process.env.SFC_DEBUG);

/** Write `sfc-check debug: <stage>: <message>` to standard error when SFC_DEBUG is set; otherwise do nothing. */
export function debugNote(stage, error) {
  if (debugEnabled()) process.stderr.write(`sfc-check debug: ${stage}: ${error?.message ?? error}\n`);
}
