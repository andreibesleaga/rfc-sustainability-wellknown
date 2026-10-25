/**
 * The one-line meanings shown beside each choice. The keys are the tokens of the draft; the library
 * the tool imports owns the sets (publisher `tokens`), and the tests hold these lists to them.
 */

/** From the most to the least direct. */
export const METHOD_MEANINGS = {
  "hardware-metered": "read from meters or power instruments on your equipment or energy supply, utility bills included",
  "hardware-estimated": "allocated to the target from energy or power counters on your hardware, with a model where the counters do not reach",
  "cloud-billing": "taken from what a hosting, cloud, CDN or network provider reports to you",
  "third-party-modeled": "computed with a model from assumed values or activity (power draw, traffic, spend); also anything no other token describes",
};

export const TARGET_TYPE_MEANINGS = {
  origin: "the publishing origin as a whole",
  path: "a path prefix of the origin",
  organization: "a legal or reporting entity, such as a company",
  facility: "one site, such as a data center or a plant",
  service: "an operated service, such as an API or an inference endpoint",
  product: "a good or a released artifact, assessed per unit",
  device: "one physical unit of equipment, with its components",
  tenant: "a customer's share of a provider's figures",
  "data-source": "a dataset or data feed",
};

export const FUNCTIONAL_UNIT_MEANINGS = {
  "per-request": "one request the target serves",
  "per-transaction": "one transaction the target completes, such as a purchase",
  "per-page-view": "one web page loaded from the target",
  "per-session": "one user session with the target",
  "per-user": "one user of the target during the period",
  "per-job": "one run of a batch job, pipeline or workflow",
  "per-token": "one token a language model of the target processes in inference",
  "per-inference": "one inference by a model of the target",
  "per-gigabyte": "one gigabyte (10^9 octets) the target transfers",
  "per-gigabyte-hour": "one gigabyte held in the target's storage for one hour",
  "per-vcpu-hour": "one virtual processor allocated to the target for one hour",
  "per-device": "one device that is the target or runs its software, during the period",
};

export const ROLE_MEANINGS = {
  hosting: "web or application hosting",
  colocation: "space, power and cooling for your own equipment",
  cloud: "cloud infrastructure",
  cdn: "content delivery",
  network: "network transit",
  electricity: "the electricity supplier",
};

/** The four disclosures a declaration can make (draft, Privacy Considerations). */
export const PRIVACY_WARNINGS = [
  "capacity and load patterns: energy and utilization figures can reveal how large your system is and when it is busy",
  "precise metrics hardware: precise figures can identify the hardware that produced them",
  "which services and paths exist: an object for a part of the target tells readers that the part exists",
  "contact strings: an address in provider is personal data when it names a person; use a role such as sustainability@example.com",
];

export const AGGREGATE_ADVICE =
  "aggregate or omit any metric that could be linked to individual users or small groups";

/** Lines of a list, `token: meaning`, for a prompt or for --help. */
export const menu = (meanings) => Object.entries(meanings).map(([token, meaning]) => `  ${token}: ${meaning}`).join("\n");
