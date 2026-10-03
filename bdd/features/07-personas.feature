Feature: Personas and usage scenarios
  The people the draft is written for, each doing the one thing they come for. Every scenario
  runs against the real libraries or the real gateway. Draft -07, "Roles and Processing Model"
  and Appendix "Worked Example: A Live Deployment".

  @persona-static-publisher @req-addcb130 @req-1947d932
  Scenario: A site owner on static hosting publishes one signed file
    Given a valid declaration object
    And the object is signed with EdDSA
    When the consumer validates it
    Then it is valid
    When the consumer verifies the signature
    Then the signature status is "verified"

  @persona-site-owner @req-addcb130 @req-1947d932 @req-b781809b
  Scenario: A WordPress or shared-hosting site that serves a static file passes the battery
    Given a local server that answers the well-known path with "application/sustainability-data+json" and status 200
    Then the origin passes every MUST of the conformance battery

  @persona-dynamic-publisher @req-684991a9 @req-5152df1a
  Scenario: A service with monthly meter readings serves trends on demand
    Given an extended publisher with monthly entries for "2025-10,2025-11,2025-12"
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data?period=2025&granularity=monthly"
    Then the status is 200
    And the body is a JSON array of 3 objects
    And the body validates as a declaration
    Then the origin passes every MUST of the conformance battery

  @persona-hosting-provider @req-a6ff4c06 @req-51128dfd
  Scenario: A hosting provider's tenant names the provider's declaration as upstream
    Given a subject declaration whose upstream chain is 1 declarations deep
    When the consumer walks the upstream chain
    Then a comparison verdict is "consistent"

  @persona-device @req-9e0f6688 @req-fd873813
  Scenario: A device reports small energies in watt-hours
    Given a valid declaration object with target-type "device" and target "sensor-7f3a"
    And the member "energy-consumption" is the number 850
    And the member "energy-unit" is "Wh"
    And the member "carbon-footprint" is the number 208
    And the member "carbon-unit" is "gCO2e"
    When the consumer validates it
    Then it is valid

  @persona-organization @req-fe0fc6eb @req-3764274e
  Scenario: An organisation reports a year with scopes that add up
    Given a valid declaration object with target-type "organization" and target "Example Org"
    And the member "reporting-period" is "2025"
    And the member "energy-consumption" is the number 214219
    And the member "carbon-footprint" is the number 470
    And the member "carbon-unit" is "mtCO2e"
    And the member "scope-1" is the number 0
    And the member "scope-2" is the number 39
    And the member "scope-3" is the number 431
    And the member "carbon-accounting" is "market-based"
    When the consumer validates it
    Then it is valid
    And there is no warning mentioning "scope"

  @persona-hpc-centre @req-9e0f6688
  Scenario: An HPC centre reports in megawatt-hours
    Given a valid declaration object with target-type "service" and target "cluster.example.edu"
    And the member "energy-consumption" is the number 12480
    And the member "energy-unit" is "MWh"
    And the member "measurement-method" is "hardware-metered"
    When the consumer validates it
    Then it is valid

  @persona-aggregator @req-ae51fdec @req-bd666000
  Scenario: An aggregator checks what it got against what it asked, then aggregates
    Given a basic publisher with one entry for "2026-01"
    And the publisher is served on a local port
    When the consumer fetches the local origin asking for period "2025" at granularity "monthly"
    Then the fetch reports that the period was not as requested
    Given the declaration is an array of objects with reporting-periods "2026-01,2026-02"
    Then the consumer aggregates the array into totals without per-entry identities

  @persona-auditor @req-5ec85632 @req-366595ae
  Scenario: An auditor records attribution and integrity, and nothing more
    Given the reference gateway is running
    When I send GET "/.well-known/sustainability-data"
    Then the body's signature verifies
    When the consumer checks the attestation URI "not a uri"
    Then the attestation is not valid and the reason is "not-absolute-uri"

  @persona-regulator-reader @req-a86d502c
  Scenario: A reader who must not rely on the data gets no "verified" claim from the tools
    Given a valid declaration object
    And the object is signed with EdDSA
    When the consumer verifies the signature
    Then the data is not reported as true or verified-accurate

  @persona-relay @req-1947d932 @req-aeecb2eb
  Scenario: The reference gateway relays a third party's figures under its own path prefix
    Given the reference gateway is running
    When I send GET "/wikimedia.org/.well-known/sustainability-data"
    Then the status is 200
    And the header "Content-Type" is "application/sustainability-data+json"
    And the body validates as a declaration
    And the object's "target-type" is "organization"
    And the object's "target" is "Wikimedia Foundation"
