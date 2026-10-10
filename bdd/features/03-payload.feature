Feature: Payload format, mandatory and optional members, value constraints
  What a declaration object is, what it must carry, what it may carry, and how a consumer
  treats a defective member. Draft -08 (posted 2026-10-09), sections "Payload Format", "Mandatory Members",
  "Optional Members", "Value Constraints and Omitted Metrics".

  @req-87cef521 @req-6ff5a712
  Scenario: One object and a one-object array are the same declaration
    Given a valid declaration object
    When the consumer validates it
    Then it is valid
    Given the declaration is an array of objects with reporting-periods "2026-01"
    When the consumer validates it
    Then it is valid

  @req-87cef521 @req-6ff5a712
  Scenario Outline: A body whose top-level value is neither an object nor an array is not a declaration
    Given the body is the JSON text <json>
    When the consumer validates it
    Then it is not valid
    Examples:
      | json      |
      | 42        |
      | "text"    |
      | null      |
      | true      |

  @req-f030d448
  Scenario: An empty array conveys no report
    Given the array is empty
    When the consumer validates it
    Then it is not valid

  @req-6aacb550
  Scenario: A trend array is in ascending period order
    Given the declaration is an array of objects with reporting-periods "2026-01,2026-02,2026-03"
    When the consumer validates it
    Then it is valid
    Given the array's objects are in reverse order
    When the consumer validates it
    Then it is not valid

  @req-6aacb550
  Scenario: A trend array does not mix period precisions
    Given the declaration is an array of objects with reporting-periods "2026,2026-01"
    When the consumer validates it
    Then it is not valid
    And the errors mention "precision"

  @req-6aacb550
  Scenario: A trend array does not overlap
    Given the declaration is an array of objects with reporting-periods "2026-01,2026-01"
    When the consumer validates it
    Then it is not valid

  @req-6eecc6c6
  Scenario: A publisher never emits a top-level member the draft does not define
    Then a publisher never emits a top-level member the draft does not define

  @req-6484e85c @req-7da41e57
  Scenario: A publisher refuses to emit a negative or non-finite figure
    Then a publisher given a negative gross figure refuses to build
    And a publisher given a non-finite figure refuses to build

  @req-17b43ea2
  Scenario: A top-level member the consumer does not recognize is ignored, never fatal
    Given a valid declaration object
    And the member "x-future-member" is "1"
    When the consumer validates it
    Then it is valid

  @req-bfd65f4c @req-de740e5c
  Scenario Outline: An object missing a mandatory member is not a declaration
    Given a valid declaration object
    And the member "<member>" is removed
    When the consumer validates it
    Then it is not valid
    Examples:
      | member             |
      | updated            |
      | capabilities       |
      | provider           |
      | measurement-method |
      | methodology-uri    |
      | reporting-period   |
      | target             |

  @req-73d9560a @req-de740e5c
  Scenario: An object with no metric and no evidence link reports nothing
    Given a valid declaration object
    And the member "energy-consumption" is removed
    And the member "energy-unit" is removed
    And the member "carbon-footprint" is removed
    And the member "carbon-unit" is removed
    When the consumer validates it
    Then it is not valid

  @req-73d9560a
  Scenario: An evidence link alone makes a conformant object
    Given a valid declaration object
    And the member "energy-consumption" is removed
    And the member "energy-unit" is removed
    And the member "carbon-footprint" is removed
    And the member "carbon-unit" is removed
    And the member "disclosure-uri" is "https://example.com/esg/"
    When the consumer validates it
    Then it is valid

  @req-92070927 @req-a3f26dd8
  Scenario Outline: The recommended measurement-method tokens are accepted as written
    Given a valid declaration object
    And the member "measurement-method" is "<token>"
    When the consumer validates it
    Then it is valid
    Examples:
      | token               |
      | hardware-metered    |
      | hardware-estimated  |
      | cloud-billing       |
      | third-party-modeled |

  @req-9e0f6688
  Scenario: An origin-wide report names the host as its target
    Given a valid declaration object with target-type "origin" and target "example.com"
    When the consumer validates it
    Then it is valid

  @req-0248be7a @req-4bd0beb7
  Scenario: The target is an opaque identifier: never normalized, compared octet for octet
    Given a local server whose declaration's target is in decomposed Unicode form
    When the consumer fetches the local origin allowing insecure transport
    Then the fetched target is byte-identical to the served text and differs from its normalized form

  @req-fd873813 @req-7d44fec0
  Scenario: A negative metric reads as not reported, and the object survives
    Given a valid declaration object
    And the member "energy-consumption" is the number -5
    Then the member "energy-consumption" is read as not reported
    When the consumer validates it
    Then it is valid

  @req-c2a4d2a8
  Scenario: A publisher does not emit an energy unit without an energy figure
    Then a publisher given no energy figure emits no energy-unit

  @req-c2a4d2a8
  Scenario: An energy unit without an energy figure has no effect on the reader
    Given a valid declaration object
    And the member "energy-consumption" is removed
    When the consumer validates it
    Then it is valid

  @req-fe0fc6eb
  Scenario: The reference publisher's real subjects keep their scopes within the gross footprint they account for
    Then every served data file that carries scopes keeps them within its gross footprint

  Scenario: A reader accepts scopes as given and judges them by the methodology
    Given a valid declaration object
    And the member "scope-1" is the number 1
    And the member "scope-2" is the number 1
    And the member "scope-3" is the number 1
    When the consumer validates it
    Then it is valid

  @req-3764274e
  Scenario: A scope may be negative where the accounting conveys removals
    Given a valid declaration object
    And the member "scope-3" is the number -4
    When the consumer validates it
    Then it is valid

  @req-67891ef0
  Scenario: An SCI score needs its functional unit
    Given a valid declaration object
    And the member "sci-score" is the number 12.5
    When the consumer validates it
    Then it is not valid
    And the errors mention "functional-unit"

  @req-4c666180 @req-fd873813 @req-86e23e83
  Scenario: An unrecognized target-type is disregarded, not fatal
    Given a valid declaration object
    And the member "target-type" is "spaceship"
    When the consumer retrieves and validates it
    Then the member "target-type" is reported as not usable

  @req-fd873813 @req-7d44fec0 @req-a3f26dd8
  Scenario Outline: An unrecognized enumerated value is disregarded; tokens are case-sensitive ASCII
    Given a valid declaration object
    And the member "<member>" is "<value>"
    When the consumer retrieves and validates it
    Then the member "<member>" is reported as not usable
    Examples:
      | member            | value          |
      | energy-unit       | MW             |
      | energy-unit       | KWH            |
      | carbon-unit       | tonnes         |
      | carbon-accounting | mixed          |

  @req-13e27a5a @req-cbc8f500
  Scenario: A methodology link on another scheme is kept, flagged, and never dereferenced automatically
    Given a valid declaration object
    And the member "methodology-uri" is "http://example.com/methodology"
    When the consumer validates it
    Then it is valid
    And the warnings mention "methodology-uri"
    And the validator made no network request

  @req-13e27a5a @req-fd873813
  Scenario: An optional link that is not https is disregarded
    Given a valid declaration object
    And the member "disclosure-uri" is "ftp://example.com/esg"
    When the consumer validates it
    Then it is valid
    And the warnings mention "disclosure-uri"

  @req-61a943cf
  Scenario: Figures for part of an origin are declared for that part, not for the whole
    Given a valid declaration object with target-type "path" and target "/api/v1"
    When the consumer validates it
    Then it is valid
