Feature: Operational considerations, security, privacy, internationalization
  Caching and revalidation, bounds on both sides, what a declaration can never prove, the
  privacy floors, and how text travels. Draft -07, sections "Operational Considerations",
  "Security Considerations", "Privacy Considerations", "Internationalization Considerations".

  @req-76f7d871 @req-7c267492
  Scenario: The reference gateway sends cache directives and validators, and revalidates with 304
    Given the reference gateway is running
    When I send GET "/.well-known/sustainability-data"
    Then the header "Cache-Control" contains "max-age="
    And the header "ETag" is present
    And the header "Last-Modified" is present
    When I send GET "/.well-known/sustainability-data" with the ETag of GET "/.well-known/sustainability-data"
    Then the status is 304
    And the body is empty
    And the header "Content-Length" is absent
    And the header "ETag" is present

  @req-7c267492 @req-4f1a55c9
  Scenario: An Extended response is cached: the same request yields the same entity tag
    Given the reference gateway is running
    When I send GET "/.well-known/sustainability-data?period=2025&granularity=monthly" with the ETag of GET "/.well-known/sustainability-data?period=2025&granularity=monthly"
    Then the status is 304

  @req-0eb0422b @req-4f5fc3f6
  Scenario: The consumer bounds the size of what it reads
    Given a local server whose declaration body is 20000 bytes of JSON
    When the consumer fetches the local origin allowing insecure transport with at most 4096 bytes
    Then the fetch did not succeed

  @req-0eb0422b @req-4f5fc3f6
  Scenario: The consumer bounds the number of objects it accepts
    Given a local server whose declaration is an array of 10 objects
    When the consumer fetches the local origin allowing insecure transport with at most 5 objects
    Then the fetch did not succeed

  @req-4f5fc3f6
  Scenario: The consumer bounds redirects
    Given a local server that redirects the well-known path in a loop
    When the consumer fetches the local origin allowing insecure transport
    Then the fetch did not succeed

  @req-4f5fc3f6
  Scenario Outline: The consumer refuses private, loopback and link-local addresses
    Then the consumer refuses the address "<address>"
    Examples:
      | address       |
      | 127.0.0.1     |
      | 10.1.2.3      |
      | 192.168.0.9   |
      | 169.254.10.10 |
      | ::1           |
      | fe80::1       |

  @req-4f5fc3f6
  Scenario: A public address is not refused
    Then the consumer allows the address "193.0.6.139"

  @req-d4a7c458
  Scenario: Duplicate member names are handled consistently, with the last value in effect
    Given a local server whose body is the raw text "{\"updated\":\"2026-02-01T00:00:00Z\",\"capabilities\":\"basic\",\"provider\":\"Example\",\"measurement-method\":\"hardware-metered\",\"methodology-uri\":\"https://example.com/m\",\"reporting-period\":\"2026-01\",\"target\":\"example.com\",\"energy-consumption\":1,\"energy-consumption\":2,\"energy-unit\":\"kWh\"}"
    When the consumer fetches the local origin allowing insecure transport
    Then the fetch status is "ok"
    And the fetched document's "energy-consumption" is 2

  @req-5ec85632
  Scenario: The reference report links its disclosures and its methodology
    Given the reference gateway is running
    When I send GET "/.well-known/sustainability-data"
    Then the object's "methodology-uri" starts with "https://"
    And the object's "disclosure-uri" starts with "https://"

  @req-0def9c52 @req-0fa7bcb6 @req-7b4a80ac
  Scenario: Noise, when a publisher opts in, is small, deterministic per period and consistent across related members
    Given an extended publisher with monthly entries for "2025-01,2025-02" and noise enabled
    Then the published figures for "2025-01" are within 1% of 100 kWh, consistent with the carbon figure, and identical across two builds

  @req-bd666000
  Scenario: An aggregate carries totals, not identities
    Given the declaration is an array of objects with reporting-periods "2026-01,2026-02,2026-03"
    Then the consumer aggregates the array into totals without per-entry identities

  @req-fcd911f3
  Scenario: Human-readable text is published in Normalization Form C
    Given a raw provider name in decomposed Unicode form
    When the publisher builds a declaration from it
    Then the published provider is in Normalization Form C

  @req-5bd052de
  Scenario: A provider name may be in any language
    Given a valid declaration object
    And the member "provider" is "شركة المثال (https://example.com/contact)"
    When the consumer validates it
    Then it is valid

  @req-24b4e556
  Scenario: A consumer isolates human-readable text when it renders it
    Given a valid declaration object
    And the member "provider" is "שם ספק (https://example.com/contact)"
    Then the provider text is isolated for display

  @req-0a7e7dc0
  Scenario: Language travels at the HTTP layer
    Given the reference gateway is running
    When I send GET "/.well-known/sustainability-data"
    Then the header "Content-Language" is "en"
    When I send GET "/nobody.example/.well-known/sustainability-data"
    Then the header "Content-Language" is "en"
