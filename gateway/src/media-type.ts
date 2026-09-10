/**
 * Per-subject media-type override: `data/_media-type.json` optionally pins one
 * reporting subject's `/.well-known/sustainability-data` document to a
 * specific media type, overriding the service-wide `SUSTAINABILITY_MEDIA_TYPE`
 * default (see `config.ts`) for that one domain only.
 *
 * The motivating case: a demonstration subject deliberately kept on the
 * legacy `application/json` type (draft -05 and earlier) for a
 * v05-compatible-deployment demonstration, living alongside subjects that
 * serve -06's dedicated `application/sustainability-data+json` type by
 * default. Example:
 *
 * ```json
 * { "legacy-demo.example": "json" }
 * ```
 *
 * Discovery, parsing and error handling follow `_no-data.json`
 * (`no-data.ts`): the file is optional — absent means no overrides — and
 * anything malformed throws at boot, before a single request is served; a
 * domain named here that is not actually a served subject is an operator
 * error caught the same way (see the cross-check in `app.ts`, alongside the
 * analogous `_no-data.json` one).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MEDIA_TYPE_VALUES, type MediaTypeSetting } from "./config";
import { DOMAIN_RE } from "./registry";

export const MEDIA_TYPE_FILE = "_media-type.json";

/** Load and validate `data/_media-type.json`. Absent file means no overrides. */
export function loadMediaTypeOverrides(dataDir: string): Map<string, MediaTypeSetting> {
  const file = join(dataDir, MEDIA_TYPE_FILE);
  const out = new Map<string, MediaTypeSetting>();
  if (!existsSync(file)) return out;

  const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `media-type: ${MEDIA_TYPE_FILE} must carry a JSON object mapping domain -> media type`,
    );
  }

  for (const [domain, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!DOMAIN_RE.test(domain)) {
      throw new Error(
        `media-type: ${MEDIA_TYPE_FILE} has an invalid domain key (${JSON.stringify(domain)})`,
      );
    }
    if (!MEDIA_TYPE_VALUES.includes(value as MediaTypeSetting)) {
      throw new Error(
        `media-type: ${domain} has value ${JSON.stringify(value)}; expected one of ` +
          `${MEDIA_TYPE_VALUES.join(", ")}`,
      );
    }
    out.set(domain, value as MediaTypeSetting);
  }
  return out;
}
