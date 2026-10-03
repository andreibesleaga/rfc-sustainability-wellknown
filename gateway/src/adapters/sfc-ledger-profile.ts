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
 * Sources: SFC ledger profile 1.2 (Supplement A of the SFC ledger-bridge paper,
 * published as SFC_COMPLIANCE.md v1.2), §A.1 hashing and signatures, §A.3 event
 * schema, §A.4 the offset-coverage rule, §A.5 hardware classes, §A.8 mapping,
 * §A.9 the `ledger-evidence` extension; the SFC disclosure profile
 * (`sfc-compliance/PROFILE.md`, version 1.1) for the four extension names.
 *
 * What is deliberately NOT here: any rule of draft -07 itself (the publisher
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
  /** The event `type` tokens (§A.3). */
  readonly eventTypes: { readonly energy: string; readonly carbon: string };
  /** The `type` token of a signed retirement allocation (§A.1, §A.4). */
  readonly allocationType: string;
  /** Payload member names (§A.3), so a renamed field is a one-line change here. */
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
  /** Members of the `ledger-evidence` extension value (§A.9.2), in emission order. */
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
  /** Members of one `operators[]` entry (§A.9.2), in emission order. */
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
    /** Registry `nodeProfile` classes that count as general-purpose (§A.5). */
    readonly allowedClasses: readonly string[];
  };
  /** The one member of `network-topology` an operator declaration carries (disclosure profile §5.4). */
  readonly topology: { readonly memberOfNetwork: string };
  /** `scope2Method` tokens (§A.3.3; draft -07 `carbon-accounting`). */
  readonly scope2Methods: readonly string[];
  /** Decimal places of the figures the bridge derives (tonnes, intensity): the publisher library's rounding. */
  readonly derivedPlaces: number;
  /** Tolerances of the shallow coherence rows (§A.9.3 step 5). */
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
