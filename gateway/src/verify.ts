/**
 * Boot-time cross-validation: every document this gateway is about to serve is
 * validated with the published `sustainability-wellknown-consumer` library —
 * the same code a third party would run against us.
 *
 * The publisher pipeline already gates every subject (JTD schema + prose
 * rules); this second, independent gate proves the publisher/consumer pair
 * agree end to end INSIDE the deployment, not just in CI. A disagreement is a
 * release-stopping bug, so it fails the boot.
 */
import { createRequire } from "node:module";
import { validateDocument } from "sustainability-wellknown-consumer";
import type { WireExample } from "./examples";
import type { Subject } from "./registry";

/** The exact consumer version doing the validating (surfaced on the index). */
export function consumerVersion(): string {
  try {
    const req = createRequire(__filename);
    const pkg = req("sustainability-wellknown-consumer/package.json") as { version: string };
    return pkg.version;
  } catch {
    return "unknown";
  }
}

export interface CrossValidation {
  /** "sustainability-wellknown-consumer@<version>" */
  validator: string;
  /** Number of documents (objects and arrays) that passed. */
  documentsValidated: number;
}

/**
 * Validate every served document with the consumer library. Throws on the
 * first failure — a gateway that cannot pass its own ecosystem's consumer
 * validation must not start.
 */
export async function crossValidate(
  subjects: Iterable<Subject>,
  examples: Iterable<WireExample>,
): Promise<CrossValidation> {
  let count = 0;

  const check = (what: string, doc: unknown): void => {
    const r = validateDocument(doc);
    if (!r.valid) {
      throw new Error(
        `consumer cross-validation failed for ${what}:\n  ${r.errors.join("\n  ")}`,
      );
    }
    count++;
  };

  for (const s of subjects) check(s.domain, s.document);

  for (const ex of examples) {
    // The Basic (collapsed) document was covered above via its subject; also
    // validate the full array response for the Extended cases.
    if (ex.granularity) {
      const { body } = await ex.subject.publisher.getSerialized({
        granularity: ex.granularity,
      });
      check(`${ex.domain} (?granularity=${ex.granularity})`, JSON.parse(body));
    }
  }

  return {
    validator: `sustainability-wellknown-consumer@${consumerVersion()}`,
    documentsValidated: count,
  };
}
