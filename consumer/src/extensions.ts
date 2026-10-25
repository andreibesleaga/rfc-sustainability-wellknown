/**
 * Extension handlers (draft -10, Section 3.4): a consumer that implements an
 * extension name's definition processes its value; any other name is ignored.
 * No handler is built in. A name is compared as a string and never dereferenced.
 */
import { SustainabilityDocument, SustainabilityMetrics } from "./types";

/** Receives the value of the one name it is registered for, and the object that carries it. */
export type ExtensionHandler = (value: Record<string, unknown>, object: SustainabilityMetrics) => void | Promise<void>;

export interface ExtensionOutcome {
  name: string;
  /** False when the handler threw; the declaration stays valid either way. */
  ok: boolean;
  error?: string;
}

/**
 * Run each registered handler on the value of its name, in every object that
 * carries it. A handler never sees another name's value, and its failure is
 * reported here rather than thrown: it does not change the declaration's validity.
 */
export async function processExtensions(
  document: SustainabilityDocument,
  handlers: ReadonlyMap<string, ExtensionHandler>,
): Promise<ExtensionOutcome[]> {
  const outcomes: ExtensionOutcome[] = [];
  for (const object of Array.isArray(document) ? document : [document]) {
    for (const [name, value] of Object.entries(object.extensions ?? {})) {
      const handler = handlers.get(name);
      if (!handler) continue;
      try {
        await handler(value, object);
        outcomes.push({ name, ok: true });
      } catch (err) {
        outcomes.push({ name, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return outcomes;
}
