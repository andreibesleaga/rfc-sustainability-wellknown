/**
 * A methodology page to start from: the five things the draft says the document describes
 * (Mandatory Members, methodology-uri). The person fills in the sentences; the tool fills in what the
 * declaration already states.
 */
import { FUNCTIONAL_UNIT_MEANINGS } from "./descriptions.mjs";

export function methodologyStub(doc, { noise } = {}) {
  const unit = doc["functional-unit"];
  const extensions = Object.keys(doc.extensions ?? {});
  return `# Methodology for ${doc.target}

Figures for ${doc.period.start} to ${doc.period.end}, published by ${doc.provider}.
Measurement method: ${doc["measurement-method"]}.

## What is measured and what is estimated

TODO: say which figures come from meters, bills or reports, and which are estimated and how.

## Allocation to a part of the target

TODO: if a figure is for a service, path, device or product, say how shared resources were allocated to it. Those figures are your allocation, not a separate measurement.

## What counts as one unit

${unit ? `The score is per unit \`${unit}\`: ${FUNCTIONAL_UNIT_MEANINGS[unit]}.\n\nTODO: say exactly what counts as one unit for this target.` : "No score is published, so there is no unit. If a score is added later, say what counts as one unit."}

## Extension names used

${extensions.length ? extensions.map((n) => `- ${n}: TODO say what it holds`).join("\n") : "None."}

## Perturbation

${noise === undefined ? "No perturbation was applied to the published values." : `Perturbation was applied within ${noise} percent of the true values.`}
`;
}
