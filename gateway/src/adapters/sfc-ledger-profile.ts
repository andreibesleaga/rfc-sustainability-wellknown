/**
 * The SFC ledger profile as a DESCRIPTOR: every extension, member and token
 * name, the hash and encoding identifiers, the rounding and the bounds the
 * ledger bridge depends on, in one object, so that a later profile
 * version is a second descriptor beside this one and never an edit of the
 * bridge. Documents already published under 1.2 keep validating because the
 * extension names a profile mints are never redefined (disclosure profile §4:
 * a changed meaning mints a new path), and the bridge, the two checks and the
 * fixture all take the descriptor as a parameter.
 *
 * Two descriptors live here. `SFC_LEDGER_PROFILE_1_2` is the frozen 1.x reading
 * (SFC ledger profile 1.2, greentech commit edb7e71, and the SFC disclosure profile
 * 1.1 for the four extension names; the 2.0 text maps every 1.x item in its
 * Appendix C and reads 1.x events by its section 12.1), which the frozen demo
 * `sfc-ledger-demo.example` still uses. `SFC_LEDGER_PROFILE_2_0` describes SFC
 * profile 2.0, the one normative text:
 * https://github.com/andreibesleaga/awesome-blockchain-greentech/blob/main/Innovative%20Projects/SFC_COMPLIANCE.md
 * (sections 3.3 arithmetic, 5 ledger records, 7 publication, 8 extensions,
 * 10 limits).
 *
 * What is deliberately NOT here: any rule of the draft itself (the publisher
 * and consumer libraries own those), any figure, and the signature suite,
 * which the profile fixes at Ed25519 over RFC 8785 for every version
 * (`SIGNATURE_ALGORITHMS`).
 */

/** The hash functions a profile may name, keyed by the identifier the extension carries. */
export const HASH_ALGORITHMS = {
  "sha-256": "sha256",
} as const;
export type HashAlgorithm = keyof typeof HASH_ALGORITHMS;

/** The canonical encodings a profile may name. Only RFC 8785 (JCS) exists today. */
export const EVENT_ENCODINGS = ["rfc8785"] as const;
export type EventEncoding = (typeof EVENT_ENCODINGS)[number];

/** The signature algorithms an event or allocation `sig.alg` may name. */
export const SIGNATURE_ALGORITHMS = ["Ed25519"] as const;

export interface SfcLedgerProfile {
  /** The `profile-version` this descriptor implements, as the extension carries it. */
  readonly version: string;
  /**
   * Every `profile-version` the bridge reads with this descriptor. A later
   * minor version that changes nothing the bridge reads is listed here; a
   * version that changes a name or a rule is a new descriptor.
   */
  readonly supportedVersions: readonly string[];
  readonly hashAlgorithm: HashAlgorithm;
  readonly eventEncoding: EventEncoding;
  /** The namespace the extension names are minted under. */
  readonly namespace: string;
  /** The four extension names (absolute https URIs, compared octet for octet). */
  readonly extensions: {
    readonly hardwareLifecycle: string;
    readonly carbonNeutrality: string;
    readonly networkTopology: string;
    readonly ledgerEvidence: string;
  };
  /** The event `type` tokens (spec 5.2). */
  readonly eventTypes: { readonly energy: string; readonly carbon: string };
  /** The `type` token of a signed retirement allocation (1.x only: spec Appendix C). */
  readonly allocationType: string;
  /** Payload member names (spec 5.3, 5.4; 12.1 rule 1 for the 1.x names), so a renamed field is a one-line change here. */
  readonly payload: {
    readonly period: string;
    readonly nodeCount: string;
    readonly kwh: string;
    readonly measurementMethod: string;
    readonly evidenceCid: string;
    readonly supersedes: string;
    readonly scope2: string;
    readonly scope2Method: string;
    readonly scope3: string;
    readonly gridIntensityRef: string;
    readonly offsets: string;
    /** The offset-coverage flag; the v1.1 name `netZero` is kept by decision K3. */
    readonly coverageFlag: string;
  };
  /** Members of the `ledger-evidence` extension value (1.x; the 2.0 form is spec 8.5), in emission order. */
  readonly evidence: {
    readonly profileVersion: string;
    readonly ledgerAccessUri: string;
    readonly hashAlgorithm: string;
    readonly eventEncoding: string;
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly operators: string;
    readonly networkOffsetCoverage: string;
    readonly anchor: string;
  };
  /** Members of one `operators[]` entry (1.x; the 2.0 form is spec 8.5), in emission order. */
  readonly operatorEntry: {
    readonly operator: string;
    readonly energyHead: string;
    readonly carbonHead: string;
    readonly energyEvents: string;
    readonly carbonEvents: string;
    readonly kwh: string;
    readonly scope2: string;
    readonly scope3: string;
    readonly offsets: string;
    readonly offsetCoverageEveryPeriod: string;
  };
  /** Members of `carbon-neutrality` the bridge writes (disclosure profile §5.3). */
  readonly neutrality: {
    readonly status: string;
    readonly offsetsRetiredT: string;
    readonly registryUri: string;
    readonly tokens: { readonly achieved: string; readonly partial: string; readonly notAchieved: string };
  };
  /** Members of `hardware-lifecycle` the bridge writes (disclosure profile §5.2). */
  readonly hardware: {
    readonly generalPurpose: string;
    readonly singleUseAsicRequired: string;
    /** Registry `nodeProfile` classes that count as general-purpose (spec 5.1, 8.2). */
    readonly allowedClasses: readonly string[];
  };
  /** The one member of `network-topology` an operator declaration carries (disclosure profile §5.4). */
  readonly topology: { readonly memberOfNetwork: string };
  /** `scope2Method` tokens (spec 12.1 rule 1; the draft's `carbon-accounting`). */
  readonly scope2Methods: readonly string[];
  /** Decimal places of the figures the bridge derives (tonnes, intensity): the publisher library's rounding. */
  readonly derivedPlaces: number;
  /** Tolerances of the 1.x shallow coherence rows (the 2.0 rule is spec 3.3 rule 4). */
  readonly tolerances: {
    /** Absolute, in the profile's unit (kWh / kgCO2e), per the publisher's four-place rounding. */
    readonly figure: number;
    /** Absolute, in kilograms, for the tonnes-to-kilograms comparison of retired credits. */
    readonly offsetsKg: number;
  };
  /** Bounds a check applies to an excerpt it did not produce (DoS: a hostile ledger must end). */
  readonly bounds: { readonly maxLedgerEntries: number; readonly maxOperators: number; readonly maxKeysPerOperator: number; readonly maxAllocations: number };
}

const NS = "https://andreibesleaga.com/sfc/extensions/";

/** SFC ledger profile 1.2. */
export const SFC_LEDGER_PROFILE_1_2: SfcLedgerProfile = {
  version: "1.2",
  supportedVersions: ["1.2"],
  hashAlgorithm: "sha-256",
  eventEncoding: "rfc8785",
  namespace: NS,
  extensions: {
    hardwareLifecycle: NS + "hardware-lifecycle",
    carbonNeutrality: NS + "carbon-neutrality",
    networkTopology: NS + "network-topology",
    ledgerEvidence: NS + "ledger-evidence",
  },
  eventTypes: { energy: "EnergyAttested", carbon: "CarbonAttested" },
  allocationType: "RetirementAllocation",
  payload: {
    period: "period",
    nodeCount: "nodeCount",
    kwh: "kWhConsumed",
    measurementMethod: "measurementMethod",
    evidenceCid: "evidenceCid",
    supersedes: "supersedes",
    scope2: "scope2KgCO2e",
    scope2Method: "scope2Method",
    scope3: "scope3KgCO2e",
    gridIntensityRef: "gridIntensityRef",
    offsets: "offsetsKgCO2e",
    coverageFlag: "netZero",
  },
  evidence: {
    profileVersion: "profile-version",
    ledgerAccessUri: "ledger-access-uri",
    hashAlgorithm: "hash-algorithm",
    eventEncoding: "event-encoding",
    periodStart: "period-start",
    periodEnd: "period-end",
    operators: "operators",
    networkOffsetCoverage: "network-offset-coverage",
    anchor: "anchor",
  },
  operatorEntry: {
    operator: "operator",
    energyHead: "energy-head",
    carbonHead: "carbon-head",
    energyEvents: "energy-events",
    carbonEvents: "carbon-events",
    kwh: "kwh",
    scope2: "scope2-kgco2e",
    scope3: "scope3-kgco2e",
    offsets: "offsets-kgco2e",
    offsetCoverageEveryPeriod: "offset-coverage-every-period",
  },
  neutrality: {
    status: "net-zero-status",
    offsetsRetiredT: "offsets-retired-tCO2e",
    registryUri: "offset-registry-uri",
    tokens: { achieved: "achieved", partial: "partial", notAchieved: "not-achieved" },
  },
  hardware: {
    generalPurpose: "general-purpose-hardware",
    singleUseAsicRequired: "single-use-asic-required",
    allowedClasses: ["general-purpose-x86", "arm64-server", "rpi-cluster", "cloud-instance"],
  },
  topology: { memberOfNetwork: "member-of-network" },
  scope2Methods: ["location-based", "market-based"],
  derivedPlaces: 4,
  tolerances: { figure: 0.00005, offsetsKg: 0.05 },
  bounds: { maxLedgerEntries: 10_000, maxOperators: 1_000, maxKeysPerOperator: 16, maxAllocations: 1_000 },
};

/**
 * Every descriptor this gateway knows. A new profile version is appended here;
 * which `profile-version` strings a descriptor reads is its `supportedVersions`
 * and nothing else.
 */
export const SFC_LEDGER_DESCRIPTORS: readonly SfcLedgerProfile[] = [SFC_LEDGER_PROFILE_1_2];

/** Every `profile-version` some descriptor reads. */
export function supportedProfileVersions(): string[] {
  return SFC_LEDGER_DESCRIPTORS.flatMap((p) => p.supportedVersions);
}

/** The descriptor that reads a `profile-version`, or undefined when none does. */
export function profileFor(version: unknown): SfcLedgerProfile | undefined {
  return typeof version === "string" ? SFC_LEDGER_DESCRIPTORS.find((p) => p.supportedVersions.includes(version)) : undefined;
}

// ---------------------------------------------------------------------------
// SFC profile 2.0
// ---------------------------------------------------------------------------

/** The limits of section 10 (defaults of the profile, not of the draft). */
export interface SfcLimits {
  readonly declarationBytes: number;
  readonly readBytes: number;
  readonly nesting: number;
  readonly operators: number;
  readonly registryEntries: number;
  readonly eventsPerChain: number;
  readonly retirements: number;
  readonly literalChars: number;
  readonly stringBytes: number;
  readonly eventBytes: number;
  readonly arrayItems: number;
  readonly checkpointChains: number;
  readonly voids: number;
  readonly parameterArray: number;
  readonly declarationObjects: number;
  /** MAX_READ_AGE, in seconds (24 hours). */
  readonly maxReadAgeSeconds: number;
  /** Clock skew, in seconds (5 minutes). */
  readonly skewSeconds: number;
  /** The time limit of one check, in seconds. */
  readonly secondsPerCheck: number;
}

/** SFC profile 2.0: names, closed lists, the cap and the limits the 2.0 reader and checks depend on. */
export interface SfcLedger2Profile {
  readonly version: string;
  /** `profile-version` values read by this descriptor: `2.<digits>` (12.2 rule 3). */
  readonly versionPattern: RegExp;
  readonly excerptVersion: number;
  readonly namespace: string;
  readonly extensions: {
    readonly hardwareLifecycle: string;
    readonly carbonNeutrality: string;
    readonly networkTopology: string;
    readonly ledgerEvidence2: string;
    /** Superseded by `ledger-evidence-2`; read as "profile 1.1 evidence" (12.1 rule 3). */
    readonly ledgerEvidenceSuperseded: string;
  };
  readonly eventTypes: { readonly energy: string; readonly carbon: string };
  readonly signatureAlgorithm: string;
  /** `measurementMethod` values, most direct first (5.3). */
  readonly measurementMethods: readonly string[];
  /** Registry `hardwareClass` (5.1), closed for all 2.x. */
  readonly hardwareClasses: readonly string[];
  readonly reusePolicies: readonly string[];
  readonly netZeroStatuses: readonly string[];
  /** `platform.mechanism` values of 7.6 (C-SFC-6 test 1); `crash-fault-tolerant` covers Raft and notary clusters. */
  readonly mechanisms: readonly string[];
  /** CAP, in kWh (3.4). */
  readonly capKwh: number;
  readonly graceDays: number;
  /** Decimal places of every published figure (3.3 rule 3). */
  readonly publishedPlaces: number;
  readonly limits: SfcLimits;
}

/** SFC profile 2.0 (https://github.com/andreibesleaga/awesome-blockchain-greentech/blob/main/Innovative%20Projects/SFC_COMPLIANCE.md). */
export const SFC_LEDGER_PROFILE_2_0: SfcLedger2Profile = {
  version: "2.0",
  versionPattern: /^2\.[0-9]+$/,
  excerptVersion: 2,
  namespace: NS,
  extensions: {
    hardwareLifecycle: NS + "hardware-lifecycle",
    carbonNeutrality: NS + "carbon-neutrality",
    networkTopology: NS + "network-topology",
    ledgerEvidence2: NS + "ledger-evidence-2",
    ledgerEvidenceSuperseded: NS + "ledger-evidence",
  },
  eventTypes: { energy: "EnergyAttested", carbon: "CarbonAttested" },
  signatureAlgorithm: "Ed25519",
  measurementMethods: ["hardware-metered", "hardware-estimated", "cloud-billing", "third-party-modeled"],
  hardwareClasses: ["general-purpose-x86", "arm64-server", "rpi-cluster", "cloud-instance", "accelerator-server"],
  reusePolicies: ["donate-to-education", "resell-refurbished", "recycle-WEEE-certified"],
  netZeroStatuses: ["achieved", "partial", "not-achieved"],
  mechanisms: ["proof-of-work", "proof-of-stake", "proof-of-authority", "dag", "hybrid", "bft", "crash-fault-tolerant"],
  capKwh: 1_000_000,
  graceDays: 5,
  publishedPlaces: 6,
  limits: {
    declarationBytes: 1_048_576,
    readBytes: 67_108_864,
    nesting: 32,
    operators: 1000,
    registryEntries: 1000,
    eventsPerChain: 10_000,
    retirements: 100,
    literalChars: 32,
    stringBytes: 4096,
    eventBytes: 65_536,
    arrayItems: 100,
    checkpointChains: 2000,
    voids: 10_000,
    parameterArray: 1000,
    declarationObjects: 16,
    maxReadAgeSeconds: 86_400,
    skewSeconds: 300,
    secondsPerCheck: 600,
  },
};

/** The 2.0 descriptor that reads a `profile-version`, or undefined. */
export function profile2For(version: unknown): SfcLedger2Profile | undefined {
  return typeof version === "string" && SFC_LEDGER_PROFILE_2_0.versionPattern.test(version) ? SFC_LEDGER_PROFILE_2_0 : undefined;
}
