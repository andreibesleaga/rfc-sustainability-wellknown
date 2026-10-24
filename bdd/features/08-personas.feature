Feature: Personas and usage scenarios
  The people the draft is written for, each doing the one thing they come for, end to end, against the real
  libraries or the real gateway. Draft -10, the examples of "Examples" and Appendix B.

  Background:
    Given the clock is fixed at "2026-10-24T12:00:00Z"

  @persona-static-publisher @REQ-URI-01 @REQ-QRY-02 @REQ-SIG-03 @UC-1.3 @rk-qry-1 @rk-sig-1 @golden @req-0a3342fc @req-969238cd
  Scenario: A site owner on static hosting publishes one signed file and every query still works
    Given a valid declaration object
    And the object is signed by the publisher with its default key
    And the publisher is served on a local port as a static file
    When I send GET "/.well-known/sustainability-data?start=2025-01-01T00:00:00Z&end=2026-01-01T00:00:00Z&granularity=monthly"
    Then the status is 200
    And the body validates as a declaration
    When the consumer verifies the signature
    Then the signature status is "verified"
    And the signature header "alg" is "Ed25519"

  @persona-site-owner @REQ-URI-01 @REQ-URI-02 @REQ-QRY-02 @UC-5.6 @rk-qry-1 @golden @req-969238cd
  Scenario: A WordPress or shared-hosting site that serves a static file passes the battery
    Given a local server that answers the well-known path with "application/sustainability-data+json" and status 200
    When the conformance battery runs against the local origin
    Then the origin passes every MUST of the conformance battery

  @persona-organisation @REQ-PER-07 @REQ-CAR-01 @REQ-CAR-03 @UC-1.1 @rk-opt-3 @rk-opt-4 @golden @req-658f55db
  Scenario: An organization publishes its yearly report in tonnes, market-based
    Given the draft's example "An Organization's Yearly Figures"
    When the consumer retrieves and validates it
    Then it is valid
    And the period is classified as "yearly"
    And the carbon is 610000000 gCO2e
    And the energy is 2400000 kWh
    And the declared scopes account for the footprint
    And the extension "https://acme.example/esg/extensions/water-and-waste" is accepted
    And the extension name "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845" is accepted

  @persona-dynamic-publisher @REQ-QRY-09 @REQ-QRY-10 @REQ-QRY-15 @UC-2.2 @UC-2.1 @rk-qry-6 @rk-qry-7 @golden @req-6c3122f6 @req-e6268aef
  Scenario: A service with monthly meter readings serves a year of months on demand
    Given an extended publisher with monthly entries for "2025-10,2025-11,2025-12"
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data?start=2025-10-01T00:00:00Z&end=2026-01-01T00:00:00Z&granularity=monthly"
    Then the status is 200
    And the body is a JSON array of 3 objects
    And the body is in ascending period order without overlap
    And the body validates as a declaration
    And the origin passes every MUST of the conformance battery

  @persona-dynamic-publisher @REQ-QRY-14 @REQ-PER-06 @REQ-EXM-03 @UC-2.2 @rk-qry-5 @rk-mand-8 @golden @req-e6268aef
  Scenario: An origin and one of its services, in a local accounting month
    Given the draft's example "An Origin and One of Its Services"
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data?target=/api/v1"
    Then the body is a JSON array of 1 objects
    And the object's "target-type" is "path"
    And the period is classified as "monthly"
    And the object's period is "2026-03-01T00:00:00+08:00" to "2026-04-01T00:00:00+08:00"

  @persona-dynamic-publisher @REQ-QRY-14 @REQ-FUN-01 @UC-2.2 @rk-qry-5 @rk-opt-8 @golden @req-e6268aef
  Scenario: A storage service answers a one-day query with its score per gigabyte-hour
    Given the example file "example-response-extended.json"
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data?target=/app/storage&start=2026-03-20T00:00:00Z&end=2026-03-21T00:00:00Z"
    Then the status is 200
    And the body is a JSON array of 1 objects
    And the object's "functional-unit" is "per-gigabyte-hour"
    And the period is classified as "daily"

  @persona-hosting-provider @REQ-UPS-03 @REQ-UPS-04 @UC-3.1 @rk-opt-13 @rk-opt-14 @golden
  Scenario: A hosting provider's tenant declaration is named by the customer as upstream
    Given a subject declaration whose upstream chain is 1 declarations deep
    And the upstream declaration has target-type "tenant"
    When the consumer walks the upstream chain
    Then a comparison verdict is "consistent"
    And every comparison names the period it compared

  @persona-hosting-provider @REQ-UPS-02 @REQ-TTY-01 @UC-4.1 @UC-3.1 @rk-opt-1 @rk-opt-13 @golden @req-9299a528
  Scenario: A colocation facility is the upstream of a tenant and carries its own metered figures
    Given a valid declaration object with target-type "facility" and target "Frankfurt data center 3"
    And the member "measurement-method" is "hardware-metered"
    And the upstream member names "https://grid.example/frankfurt.json" with role "electricity"
    When the consumer reads it in strict mode
    Then it is valid
    And the consumer walks the upstream chain
    And at most 3 upstream declarations were retrieved

  @persona-device @REQ-ENG-01 @REQ-PER-08 @UC-4.1 @rk-opt-2 @rk-mand-10 @golden @req-305ad347
  Scenario: A device reports small energies in watt-hours for a calendar day
    Given a valid declaration object with target-type "device" and target "sensor-7f3a"
    And the member "energy-consumption" is the number 850
    And the member "energy-unit" is "Wh"
    And the declaration has period "2026-10-23T00:00:00Z" to "2026-10-24T00:00:00Z"
    When the consumer validates it
    Then it is valid
    And the energy is 0.85 kWh
    And there is no warning mentioning "calendar day"

  @persona-ai-provider @REQ-BDY-04 @REQ-FUN-01 @rk-body-5 @rk-opt-8 @golden
  Scenario: An inference endpoint publishes one object per functional unit for one target and period
    Given the declaration is an array of two objects:
      | target       | period                                    | functional-unit | sci-score | measurement-method |
      | inference-eu | 2026-09-01T00:00:00Z/2026-10-01T00:00:00Z | per-token       | 0.00012   | hardware-estimated |
      | inference-eu | 2026-09-01T00:00:00Z/2026-10-01T00:00:00Z | per-inference   | 0.31      | hardware-estimated |
    When the consumer validates it
    Then it is valid
    And the consumer lists the two scores separately by functional unit

  @persona-hpc-centre @REQ-FUN-01 @REQ-MTH-02 @UC-4.1 @rk-opt-8 @rk-mand-3 @golden
  Scenario: A cluster publishes its monthly figures per job and per vcpu-hour from scheduler accounting
    Given a publisher given the calendar month "2026-09" with the offset "Z"
    And the scheduler accounting figures of 1200 jobs and 480000 vcpu-hours
    When the publisher builds the declarations
    Then the published objects use the functional units "per-job" and "per-vcpu-hour"
    And the published member "measurement-method" is "hardware-estimated"
    And every published object validates as a declaration

  @persona-aggregator @REQ-TOT-03 @REQ-QRY-17a @REQ-ORG-03 @UC-5.4 @UC-5.2 @rk-agg-1 @rk-qry-8 @golden @req-8b68868e @req-d2b6ec62
  Scenario: An aggregator totals a year from twelve months and never adds the year to its months
    Given an extended publisher with monthly entries for "2025-01,2025-02,2025-03,2025-04,2025-05,2025-06,2025-07,2025-08,2025-09,2025-10,2025-11,2025-12"
    And the publisher is served on a local port
    When the consumer fetches the local origin asking for start "2025-01-01T00:00:00Z" and end "2026-01-01T00:00:00Z" at granularity "monthly"
    Then the fetch reports nothing as not requested
    And the recorded coverage is "2025-01-01T00:00:00Z" to "2026-01-01T00:00:00Z"
    When the consumer totals the array
    Then the total covers "2025-01-01T00:00:00Z" to "2026-01-01T00:00:00Z"

  @persona-aggregator @REQ-PRT-05 @REQ-TOT-03 @UC-5.4 @rk-agg-1 @rk-qry-8 @edge @req-23c17076 @req-8b68868e
  Scenario: An aggregator with eleven months does not claim the year
    Given an extended publisher with monthly entries for "2025-01,2025-02,2025-03,2025-04,2025-05,2025-06,2025-07,2025-08,2025-09,2025-10,2025-11"
    And the publisher is served on a local port
    When the consumer fetches the local origin asking for start "2025-01-01T00:00:00Z" and end "2026-01-01T00:00:00Z" at granularity "monthly"
    Then the fetch reports that the period was not fully covered
    And the recorded coverage is "2025-01-01T00:00:00Z" to "2025-12-01T00:00:00Z"

  @persona-auditor @REQ-VER-07 @REQ-VER-14 @UC-6.1 @rk-sig-7 @golden
  Scenario: An auditor pins the key at the first retrieval and notices a later swap
    Given the object is signed with Ed25519 by key "K1" carried in its header
    When the consumer verifies the signature and pins the key
    Then the signature status is "verified"
    And the key trust level is "declaration-only"
    Given the object is re-signed with Ed25519 by key "K2" carried in its header
    When the consumer verifies the signature
    Then the signature status is "unverified"
    And the signature reason mentions "pin-mismatch"

  @persona-auditor @REQ-SEC-06 @edge
  Scenario: An auditor who holds a later update sees the replay of an older signed object
    Given the object has "updated" "2026-03-01T12:00:00Z" and is signed with Ed25519
    And the consumer holds an object for the same target and period with "updated" "2026-06-01T12:00:00Z"
    When the consumer verifies the signature
    Then the object is reported as "replay-suspected"

  @persona-regulator-reader @REQ-CLM-02 @REQ-TOT-06 @REQ-VER-11 @UC-5.1 @rk-agg-3 @golden @req-3229f5af
  Scenario: A regulator's reader shows figures as claims of the origin that covers a period, never as verified or current
    Given a valid declaration object
    When the consumer retrieves and validates it
    Then the presentation says the figures are claims of the origin that served them
    And the presentation says the figures cover "2025-01-01T00:00:00Z" to "2026-01-01T00:00:00Z"
    And the data is not reported as true or verified-accurate

  @persona-relay @REQ-URF-03 @REQ-VER-06 @rk-opt-11 @rk-sig-5 @golden @req-6f3b1824
  Scenario: A relay stores a declaration and forwards it with the retrieval URI, so references and signature still hold
    Given the object is signed with Ed25519
    And the member "methodology-uri" is "/sustainability/methodology"
    When a relay stores the declaration retrieved from "https://example.com/.well-known/sustainability-data"
    And the relay forwards it
    Then the forwarded record carries the retrieval URI "https://example.com/.well-known/sustainability-data"
    And the resolved "methodology-uri" is "https://example.com/sustainability/methodology"
    When the consumer verifies the signature of the forwarded declaration
    Then the signature status is "verified"

  @persona-security-consumer @REQ-SEC-12 @REQ-SEC-11b @REQ-EXT-04 @UC-5.1 @rk-lim-1 @rk-opt-12 @error @req-0c34adda @req-8e5210f0
  Scenario: A consumer that fetches declarations on behalf of strangers is not turned into a proxy
    Given a valid declaration object
    And the upstream member names "https://127.0.0.1/admin" with role "cloud"
    And the extension "https://tracker.example/x" is '{"report": "https://tracker.example/pixel.gif"}'
    And the member "verifiable-attestation-uri" is "https://10.0.0.5/vc.json"
    When the consumer retrieves it and follows every link it is allowed to follow
    Then no connection is made to "127.0.0.1"
    And no connection is made to "10.0.0.5"
    And no connection is made to "tracker.example"

  @persona-migrating-publisher @REQ-CMP-04c @REQ-CMP-04f @UC-1.2 @rk-cmp-2 @golden
  Scenario: An owner with six origins upgrades one file, re-signs it and checks it before pushing
    Given a -09 document signed with EdDSA
    When the upgrade tool runs on the document with "--check"
    Then the upgrade exits with status 1
    When the upgrade tool runs on the document
    Then the upgrade output is valid under the -10 schema and the CDDL
    When the owner signs the output with an Ed25519 key
    And the output is served on a local port as a static file
    And the consumer fetches the local origin in strict mode allowing insecure transport
    Then the fetch status is "ok"
    And the signature status is "verified"
    When the upgrade tool runs on the output with "--check"
    Then the upgrade exits with status 0

  @persona-migrating-publisher @REQ-CMP-01 @UC-5.3 @rk-cmp-1 @edge
  Scenario: Between the new consumer and the old origin, the compatibility reading works and the strict reading says what is wrong
    Given a local server that serves a -09 document
    When the consumer fetches the local origin in compatibility mode allowing insecure transport
    Then the fetch status is "ok"
    And the fetch reports the converted members
    When the consumer fetches the local origin in strict mode allowing insecure transport
    Then the fetch status is "invalid"
    And the fetch outcome mentions "period"

  @persona-reference-gateway @REQ-MND-03 @REQ-APX-01 @UC-7.1 @golden
  Scenario: The reference gateway's own report is extended and valid -10
    Given the reference gateway is running
    # At the gateway clock (2026-10-17T12:00:00Z) August and September 2026 are the two complete months held.
    When I send GET "/.well-known/sustainability-data?start=2026-08-01T00:00:00Z&end=2026-10-01T00:00:00Z&granularity=monthly"
    Then the status is 200
    And the header "Content-Type" is "application/sustainability-data+json"
    And the body is a JSON array of 2 objects
    And the body validates as a declaration
    And the origin passes every MUST of the conformance battery

  # ---- added by the 24 Oct review: Appendix A, and the persona paths that had no error or edge scenario ----

  @REQ-APX-01 @golden @UC-7.1
  Scenario: The gateway's own object is the last completed month of a service and answers ?start= and ?end= with its months
    Given the reference gateway is running
    When I send GET "/.well-known/sustainability-data"
    Then the object's "target-type" is "service"
    And the object's "capabilities" is "extended"
    And the object has no "upstream"
    And the object has the member "disclosure-uri"
    And the object has the member "verifiable-attestation-uri"
    When I send GET "/.well-known/sustainability-data?start=2026-08-01T00:00:00Z&end=2026-10-01T00:00:00Z&granularity=monthly"
    Then the body is a JSON array of 2 objects

  @REQ-APX-01 @error @UC-7.1
  Scenario: A self report that carries an upstream member fails the Appendix A check
    Given the gateway's self report with an upstream member added
    When the Appendix A check runs
    Then the check fails
    And the check message mentions "upstream"

  @REQ-APX-01 @edge @UC-7.1
  Scenario: With the clock on the first day of a month the object is the month before
    Given the reference gateway is running
    And the clock moves to "2026-11-01T00:00:00Z"
    When I send GET "/.well-known/sustainability-data"
    Then the object has period "2026-10-01T00:00:00Z" to "2026-11-01T00:00:00Z"

  @REQ-APX-02 @golden @UC-7.1 @rk-sig-1
  Scenario: The served array is signed object by object and verifies with its embedded key
    Given the reference gateway is running
    When I send GET "/.well-known/sustainability-data?start=2026-08-01T00:00:00Z&end=2026-10-01T00:00:00Z&granularity=monthly"
    Then the header "Content-Type" is "application/sustainability-data+json"
    And the header "Cache-Control" contains "max-age=3600"
    And the header "ETag" is present
    When the consumer verifies every signature of the array
    Then every signature status is "verified"
    And the key trust level is "declaration-only"

  @REQ-APX-02 @error @UC-7.1 @rk-sig-1
  Scenario: A signed value made for an earlier period of the object is unverified
    Given a valid declaration object
    And the object is signed with Ed25519
    And after signing, the object's "period.end" is changed to "2026-03-01T00:00:00Z"
    When the consumer verifies the signature
    Then the signature status is "unverified"
    And the signature reason mentions "period.end"

  @REQ-APX-02 @edge @UC-7.1 @rk-sig-1
  Scenario: In a monthly array each object carries its own signature
    Given the reference gateway is running
    When I send GET "/.well-known/sustainability-data?start=2026-08-01T00:00:00Z&end=2026-10-01T00:00:00Z&granularity=monthly"
    And the consumer verifies every signature of the array
    Then the two signed members differ

  @REQ-APX-03 @golden @UC-7.1
  Scenario: The gateway's credential binds the target and the period and carries the derivation model
    Given the reference gateway is running
    When the consumer retrieves the gateway's credential
    Then the credential subject carries the derivation model, its constants and formulas, and the entered months
    And the credential binds the target and the period of the object

  @REQ-APX-03 @error @UC-7.1
  Scenario: A credential for another period is not accepted as binding
    Given the reference gateway is running
    And the credential of the gateway is for the period "2026-08-01T00:00:00Z" to "2026-09-01T00:00:00Z"
    When the consumer checks the gateway's attestation for the object of "2026-09-01T00:00:00Z" to "2026-10-01T00:00:00Z"
    Then the attestation is not valid
    And the attestation reason is "period not covered"

  @REQ-APX-03 @edge @UC-7.1 @req-7146a36d
  Scenario: The consumer records the gateway's attestation as no stronger than its issuer allows
    Given the reference gateway is running
    When the consumer checks the gateway's attestation for the object of "2026-09-01T00:00:00Z" to "2026-10-01T00:00:00Z"
    Then the attestation notes that the issuer is not independent of the publisher

  @REQ-APX-04 @golden @UC-1.1
  Scenario: One command writes one valid, signed file
    Given the create-sustainability-data tool is given the default answers
    And the tool is given an Ed25519 signing key
    When the create-sustainability-data tool runs
    Then the tool writes one file
    And the written file validates as a declaration
    And the written file is signed with Ed25519

  @REQ-APX-04 @REQ-SIG-03 @error @UC-1.1 @req-0a3342fc
  Scenario: A key whose algorithm is HS256 is refused
    Given the create-sustainability-data tool is given the default answers
    And the tool is given an HS256 secret as the signing key
    When the create-sustainability-data tool runs
    Then the tool refuses and names "HS256"
    And no output file was written

  @REQ-APX-04 @edge @UC-1.1
  Scenario: With no key given the file is unsigned and the tool says so
    Given the create-sustainability-data tool is given the default answers
    When the create-sustainability-data tool runs
    Then the tool writes one file
    And the written file has no member "signed"
    And the tool prints a line mentioning "unsigned"

  @REQ-PER-01 @REQ-PER-04 @REQ-MND-01 @REQ-MIN-01 @golden @UC-1.1
  Scenario: An organization writes its yearly file with create-sustainability-data, and strict fetch passes
    Given the create-sustainability-data tool is given the answers:
      | answer             | value                       |
      | provider           | Acme Retail plc (sustainability@acme.example) |
      | target             | Acme Retail plc             |
      | target-type        | organization                |
      | period             | 2025                        |
      | carbon-footprint   | 610                         |
      | carbon-unit        | tCO2e                       |
      | carbon-accounting  | market-based                |
      | scope-1            | 90                          |
      | scope-2            | 220                         |
      | scope-3            | 300                         |
      | disclosure-uri     | https://acme.example/esg/disclosures |
      | methodology-uri    | /esg/methodology            |
    When the create-sustainability-data tool runs
    Then the written file has period "2025-01-01T00:00:00Z" to "2026-01-01T00:00:00Z"
    And the written file validates as a declaration
    And the written file is served on a local port as a static file
    When the consumer fetches the local origin in strict mode allowing insecure transport
    Then the fetch status is "ok"

  @REQ-MND-01 @REQ-MIN-01 @error @UC-1.1 @req-7f33240f
  Scenario: A file with no figure and no evidence link is refused with the reason
    Given the create-sustainability-data tool is given the default answers
    And the answer "carbon-footprint" is removed
    And the answer "disclosure-uri" is removed
    And the answer "verifiable-attestation-uri" is removed
    When the create-sustainability-data tool runs
    Then the tool refuses and names "disclosure-uri"
    And no output file was written

  @REQ-NUM-01 @REQ-DRV-03 @REQ-TTY-01 @REQ-MTH-01 @REQ-PER-02 @error @UC-1.1 @req-27e5209f @req-24108bed
  Scenario Outline: A value the draft forbids is refused, and the refusal names what is wrong or the allowed set
    Given the create-sustainability-data tool is given the default answers
    And the answer "<answer>" is "<value>"
    When the create-sustainability-data tool runs
    Then the tool refuses and names "<named>"
    And no output file was written

    Examples:
      | answer             | value                                     | named               |
      | energy-consumption | -5                                        | energy-consumption  |
      | carbon-footprint   | -5                                        | carbon-footprint    |
      | renewable-energy   | 101                                       | renewable-energy    |
      | carbon-unit        | ktCO2e                                    | tCO2e               |
      | measurement-method | spend-based                               | hardware-metered    |
      | period             | 2025-06-01T00:00:00Z/2025-01-01T00:00:00Z | period              |

  @REQ-PER-02 @REQ-PER-05 @edge @UC-1.1 @rk-mand-9
  Scenario: A reporting year ending on 31 March is a period and not a calendar year
    Given the create-sustainability-data tool is given the default answers
    And the answer "period" is "2025-04-01T00:00:00Z/2026-04-01T00:00:00Z"
    When the create-sustainability-data tool runs
    Then the written file validates as a declaration
    And the written file has period "2025-04-01T00:00:00Z" to "2026-04-01T00:00:00Z"
    And the written period is classified as "none"

  @REQ-SCP-02 @REQ-SCP-01 @edge @UC-1.1 @req-48bd044c @rk-opt-6
  Scenario: Negative scope numbers for removals are allowed, and scopes need not sum when explained
    Given the create-sustainability-data tool is given the default answers
    And the answer "scope-3" is "-120"
    And the answer "carbon-footprint" is "300"
    When the create-sustainability-data tool runs
    Then the written file validates as a declaration

  @REQ-TGT-03 @edge @UC-1.1 @req-22b478b8 @rk-mand-11
  Scenario: A host in U-label form is refused by the publisher and warned about by the consumer
    Given a valid declaration object with target-type "origin" and target "grün.example"
    When the consumer validates it
    Then it is valid
    And the warnings mention "A-label"
    When the publisher builds it
    Then the publisher refuses and names "target"

  @REQ-QRY-19 @REQ-MND-03 @error @UC-2.1 @req-6c3122f6
  Scenario: A bad configured start for the one-click kit fails at start-up with a message
    Given the one-click kit is configured with "SD_START" "not-a-date"
    When the one-click kit starts
    Then the start fails with a message mentioning "SD_START"

  @REQ-QRY-19 @REQ-MND-03 @edge @UC-2.1 @req-6c3122f6
  Scenario Outline: A request without parameters gets an array when the publisher holds several objects or is configured for arrays, and an object otherwise
    Given <publisher>
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data"
    Then <shape>

    Examples:
      | publisher                                                                  | shape                                |
      | an extended publisher with monthly entries for "2025-10,2025-11,2025-12"   | the body is a JSON array of 3 objects |
      | a basic publisher with one entry for "2026-01"                             | the body is a JSON object             |

  @REQ-PER-04 @REQ-PER-06 @error @UC-4.1
  Scenario: A slurm configuration with an invalid utcOffset is refused
    Given a slurm accounting export with the utcOffset "+25:00"
    When the slurm adapter reads it
    Then the adapter reports the skipped row with the reason mentioning "utcOffset"
    And the adapter yields 0 objects

  @REQ-PER-04 @REQ-PER-05 @REQ-PER-06 @edge @UC-4.1 @rk-mand-8
  Scenario: A Kepler replay for a month with a daylight-saving change writes each bound in the offset in force
    Given a publisher given the calendar month "2026-03" in the time zone "Europe/Berlin"
    When the publisher builds the declarations
    Then the published period is "2026-03-01T00:00:00+01:00" to "2026-04-01T00:00:00+02:00"
    And the period is classified as "monthly"

  @REQ-MIN-02 @REQ-PRT-01 @error @UC-4.2 @rk-opt-5
  Scenario: A figure the source does not have is left out and nothing is estimated
    Given a CSV with one row whose energy cell is empty
    When the CSV adapter reads it
    Then the published object has no member "energy-consumption"
    And no zero was written for "energy-consumption"

  @REQ-QRY-03 @REQ-QRY-07 @error @UC-5.6 @rk-qry-2
  Scenario: A server that answers 400 for a value outside the profile fails the conformance battery
    Given a local server that answers 400 to a query value that does not match the ABNF
    When the conformance battery runs against the local origin
    Then the battery fails
    And the battery failure names the section "Query Parameters"

  @REQ-QRY-01 @REQ-QRY-02 @REQ-MND-03 @edge @UC-5.6 @rk-qry-1
  Scenario Outline: A static file passes as basic, and a server that honours only target passes as extended
    Given <publisher>
    And the publisher is served on a local port
    When the conformance battery runs against the local origin
    Then the origin passes every MUST of the conformance battery
    And the battery reports capabilities "<capabilities>"

    Examples:
      | publisher                                        | capabilities |
      | a basic publisher with one entry for "2026-01"   | basic        |
      | an extended publisher that honours only "target" | extended     |

  @REQ-SEC-08 @error @UC-6.3 @req-b55a61c6 @rk-lim-1
  Scenario: An attestation larger than 65536 bytes is refused
    Given a valid declaration object
    And the member "verifiable-attestation-uri" is "https://auditor.example/vc.json"
    And the credential at "https://auditor.example/vc.json" is 65537 bytes long
    When the consumer checks the attestation URI "https://auditor.example/vc.json"
    Then the attestation is not valid
    And the attestation reason is "too large"

  @REQ-LNK-01 @REQ-LNK-02 @REQ-EVD-01 @edge @UC-6.3 @req-7146a36d
  Scenario: A credential of exactly 65536 bytes is read, and further attestations are reached through the disclosure index
    Given a valid declaration object
    And the member "verifiable-attestation-uri" is "https://auditor.example/vc.json"
    And the member "disclosure-uri" is "https://auditor.example/index.json"
    And the credential at "https://auditor.example/vc.json" is 65536 bytes long and issued by a trusted issuer for the target "Example Corp" and the period "2025-01-01T00:00:00Z" to "2026-01-01T00:00:00Z"
    When the consumer checks the attestation URI "https://auditor.example/vc.json"
    Then the attestation is valid
    And exactly one attestation URI is read
