# Verifiable Credential

To combat greenwashing and provide high-assurance data, the draft recommends linking to a W3C Verifiable Credential (VC). This structure allows a trusted third party (like an environmental auditor) to cryptographically sign the metrics you have published at the .well-known/sustainability URI.

Here is an example draft structure for the Verifiable Credential, following the W3C VC Data Model and aligned with the metrics in draft-besleaga-green-sustainability-wellknown-03.

## Draft Verifiable Credential (JSON-LD)

```json
{
  "@context": [
    "https://www.w3.org/2018/credentials/v1",
    "https://w3id.org/security/suites/ed25519-2020/v1",
    {
      "SustainabilityReport": "https://example.org/vocab#SustainabilityReport",
      "energyConsumption": "https://example.org/vocab#energy-consumption",
      "carbonFootprint": "https://example.org/vocab#carbon-footprint",
      "reportingPeriod": "https://example.org/vocab#reporting-period",
      "provider": "https://example.org/vocab#provider"
    }
  ],
  "id": "urn:uuid:5842197a-9761-464a-95f0-802528a4787a",
  "type": ["VerifiableCredential", "SustainabilityReportCredential"],
  "issuer": "did:web:auditor.example.com",
  "issuanceDate": "2026-03-21T10:00:00Z",
  "credentialSubject": {
    "id": "did:web:example.com",
    "version": "1.0",
    "capabilities": "extended",
    "provider": "Example Corp",
    "reporting-period": "2025",
    "measurement-method": "hardware-metered",
    "methodology-uri": "https://example.com/sustainability/methodology",
    "energy-consumption": 13540.0,
    "energy-unit": "kWh",
    "carbon-footprint": 3720.5,
    "carbon-unit": "kgCO2e"
  },
  "proof": {
    "type": "Ed25519Signature2020",
    "created": "2026-03-21T10:05:00Z",
    "verificationMethod": "did:web:auditor.example.com#key-1",
    "proofPurpose": "assertionMethod",
    "proofValue": "z58D63V...[cryptographic-signature-hash]..."
  }
}
```

## Key Components Explained
* **issuer**: This is the Decentralized Identifier (DID) of the authoritative entity (e.g., a certified carbon auditor) that verified the data.
* **credentialSubject**: This block mirrors the mandatory fields defined in the draft, such as energy-consumption, carbon-footprint, and reporting-period. It serves as the "claims" being made.
* **proof**: This is the cryptographic signature. It ensures that if even a single digit of the energy consumption is changed in the .well-known file, the VC signature will no longer match, alerting the client to a potential misrepresentation.

## Anti-Greenwashing
By hosting this VC at the URL specified in your verifiable-attestation-uri field, you provide a "discovery surface" for automated tools to verify your sustainability claims against external authoritative reports.

## Implementation Workflow
Generate Metrics: Run your internal sustainability reporting tools to generate the JSON for /.well-known/sustainability.

## Audit
Provide the raw data and methodology to an auditor.

## Issue VC
The auditor generates this VC and signs it with their private key.

## Publish
You host the signed VC at a public URL and update the verifiable-attestation-uri field in your well-known metadata to point to it.
