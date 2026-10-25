Feature: Compatibility with -08 and -09 documents
  A -09 document is not a valid -10 document, and a -08 document is not a valid -09 one. The consumer's
  compatibility reading converts what converts exactly and disregards what does not, and reports both. Strict mode
  reads the document as served. The publisher never emits an older form; `sustainability-publisher upgrade`
  converts files with the same rules.

  Background:
    Given the clock is fixed at "2026-10-24T12:00:00Z"

  # ---- periods ----

  @REQ-CMP-01 @UC-5.3 @rk-cmp-1 @golden
  Scenario Outline: A -08 reporting-period is read as a half-open period in UTC
    Given a -08 document with "reporting-period" "<reporting-period>"
    When the consumer reads it in compatibility mode
    Then it is valid
    And the fetched period is "<start>" to "<end>"
    And the member "period" is reported as converted
    And the fetched object has no member "reporting-period"

    Examples:
      | reporting-period | start                | end                  |
      | 2025             | 2025-01-01T00:00:00Z | 2026-01-01T00:00:00Z |
      | 2024             | 2024-01-01T00:00:00Z | 2025-01-01T00:00:00Z |
      | 2025-03          | 2025-03-01T00:00:00Z | 2025-04-01T00:00:00Z |
      | 2025-12          | 2025-12-01T00:00:00Z | 2026-01-01T00:00:00Z |
      | 2024-02          | 2024-02-01T00:00:00Z | 2024-03-01T00:00:00Z |
      | 2025-03-14       | 2025-03-14T00:00:00Z | 2025-03-15T00:00:00Z |
      | 2024-02-29       | 2024-02-29T00:00:00Z | 2024-03-01T00:00:00Z |
      | 2025-12-31       | 2025-12-31T00:00:00Z | 2026-01-01T00:00:00Z |

  @REQ-CMP-01 @UC-5.3 @rk-cmp-1 @error
  Scenario Outline: A -08 reporting-period that is not a real calendar value is not converted
    Given a -08 document with "reporting-period" "<reporting-period>"
    When the consumer reads it in compatibility mode
    Then it is not valid
    And the errors mention "period"

    Examples:
      | reporting-period |
      | 2025-13          |
      | 2025-00          |
      | 2025-02-30       |
      | 2025-02-29       |
      | 25               |
      | 2025-3           |
      | 2025/03          |
      | Q1 2025          |
      |                  |

  @REQ-CMP-01 @UC-5.3 @rk-cmp-1 @golden
  Scenario Outline: A -09 inclusive date pair is read as a half-open period, end plus one day
    Given a -09 document with period "<start>" to "<end>"
    When the consumer reads it in compatibility mode
    Then it is valid
    And the fetched period is "<new start>" to "<new end>"
    And the member "period" is reported as converted

    Examples:
      | start      | end        | new start            | new end              |
      | 2025-01-01 | 2025-12-31 | 2025-01-01T00:00:00Z | 2026-01-01T00:00:00Z |
      | 2025-03-01 | 2025-03-31 | 2025-03-01T00:00:00Z | 2025-04-01T00:00:00Z |
      | 2025-03-14 | 2025-03-14 | 2025-03-14T00:00:00Z | 2025-03-15T00:00:00Z |
      | 2024-02-01 | 2024-02-29 | 2024-02-01T00:00:00Z | 2024-03-01T00:00:00Z |
      | 2025-02-01 | 2025-02-28 | 2025-02-01T00:00:00Z | 2025-03-01T00:00:00Z |
      | 2025-04-01 | 2026-03-31 | 2025-04-01T00:00:00Z | 2026-04-01T00:00:00Z |

  @REQ-CMP-01 @UC-5.3 @rk-cmp-1 @error
  Scenario Outline: A -09 date pair that is not valid is not converted
    Given a -09 document with period "<start>" to "<end>"
    When the consumer reads it in compatibility mode
    Then it is not valid

    Examples:
      | start      | end        |
      | 2025-03-14 | 2025-03-13 |
      | 2025-02-30 | 2025-03-31 |
      | 2025-01-01 | 2025-13-01 |
      | 2025-01-01 |            |

  @REQ-CMP-01 @UC-5.3 @rk-cmp-1 @error
  Scenario Outline: Strict mode reads an older document as served, so it is invalid
    Given a <revision> document
    When the consumer reads it in strict mode
    Then it is not valid
    And the errors mention "period"

    Examples:
      | revision |
      | -08      |
      | -09      |

  @REQ-CMP-01 @UC-5.3 @rk-cmp-1 @edge
  Scenario: Converted periods are in the same instants a -10 reader would compute, so a total over a mixed array is exact
    Given the declaration is an array of three objects:
      | form | value                                      |
      | -08  | reporting-period 2025-01                   |
      | -09  | period 2025-02-01 to 2025-02-28            |
      | -10  | period 2025-03-01T00:00:00Z/2025-04-01T00:00:00Z |
    When the consumer reads it in compatibility mode
    Then the periods "2025-01" and "2025-02" and "2025-03" are reported as not overlapping
    And the objects are reported as converted: 2

  @REQ-QRY-02 @REQ-QRY-07 @rk-qry-1 @rk-qry-2 @golden @req-969238cd @req-ee318dc3
  Scenario Outline: A -10 server ignores the -08 and -09 query forms
    Given the reference gateway is running
    When I send GET "/.well-known/sustainability-data?<query>"
    Then the status is 200
    And the body is the same as for GET "/.well-known/sustainability-data"

    Examples:
      | query                                  |
      | period=2025                            |
      | period=2025-03&granularity=weekly      |
      | start=2025-01-01&end=2025-12-31        |
      | start=2025-01-01                       |

  # ---- tokens: conversion ----

  @REQ-CMP-03 @UC-5.3 @rk-cmp-1 @rk-mand-3 @golden
  Scenario Outline: A -09 free-text measurement method becomes the residual token and is reported
    Given a -09 document with "measurement-method" "<text>"
    When the consumer reads it in compatibility mode
    Then the fetched member "measurement-method" is "third-party-modeled"
    And the member "measurement-method" is reported as disregarded

    Examples:
      | text                                                                              |
      | Hardware-Metered                                                                  |
      | metered                                                                           |
      | fuel and electricity metered; woodland removals from an annual biomass inventory  |
      | calculated from activity data x emission factors                                  |

  @REQ-CMP-03 @UC-5.3 @rk-cmp-1 @rk-opt-8 @golden
  Scenario Outline: A functional unit of the legacy grammar is converted with its score
    Given a -09 document with "functional-unit" "<legacy>" and "sci-score" <score>
    When the consumer reads it in compatibility mode
    Then the fetched member "functional-unit" is "<unit>"
    And the fetched member "sci-score" is the number <new score>
    And the member "functional-unit" is reported as converted

    Examples: the -08 and -09 score and unit forms (case-insensitive)
      | legacy                       | score | unit              | new score  |
      | per-thousand-requests        | 12    | per-request       | 0.012      |
      | per-thousand-API-requests    | 0.42  | per-request       | 0.00042    |
      | per-million-requests         | 5     | per-request       | 0.000005   |
      | per-requests                 | 3     | per-request       | 3          |
      | request                      | 3     | per-request       | 3          |
      | Per-Request                  | 3     | per-request       | 3          |
      | per-call                     | 2     | per-request       | 2          |
      | per-query                    | 2     | per-request       | 2          |
      | per-1000-transactions        | 40    | per-transaction   | 0.04       |
      | per-visit                    | 1.5   | per-page-view     | 1.5        |
      | per-pageview                 | 1.5   | per-page-view     | 1.5        |
      | per-run                      | 20    | per-job           | 20         |
      | per-million-tokens           | 2     | per-token         | 0.000002   |
      | per-thousand-inferences      | 300   | per-inference     | 0.3        |

  @REQ-CMP-03 @UC-5.3 @rk-cmp-1 @rk-opt-8 @golden
  Scenario Outline: A functional unit that is already a current token is left as it is
    Given a -09 document with "functional-unit" "<legacy>" and "sci-score" <score>
    When the consumer reads it in compatibility mode
    Then the fetched member "functional-unit" is "<unit>"
    And the fetched member "sci-score" is the number <new score>
    And the member "functional-unit" is not reported

    Examples:
      | legacy                       | score | unit              | new score  |
      | per-request                  | 3     | per-request       | 3          |
      | per-user                     | 430   | per-user          | 430        |
      | per-device                   | 9     | per-device        | 9          |
      | per-gigabyte                 | 0.8   | per-gigabyte      | 0.8        |
      | per-page-view                | 1.5   | per-page-view     | 1.5        |
      | per-job                      | 20    | per-job           | 20         |
      | per-token                    | 0.001 | per-token         | 0.001      |
      | per-inference                | 0.3   | per-inference     | 0.3        |

  @REQ-CMP-03 @REQ-FUN-03 @UC-5.3 @rk-cmp-1 @rk-opt-8 @edge
  Scenario Outline: Storage over time converts exactly, to gigabyte-hours
    Given a -09 document with "functional-unit" "<legacy>" and "sci-score" <score>
    When the consumer reads it in compatibility mode
    Then the fetched member "functional-unit" is "per-gigabyte-hour"
    And the fetched member "sci-score" is the number <new score>

    Examples:
      | legacy                  | score | new score  |
      | per-gigabyte-hour       | 7     | 7          |
      | per-gigabyte-day        | 24    | 1          |
      | per-terabyte-hour       | 1000  | 1          |
      | per-terabyte-day        | 24000 | 1          |
      | per-terabyte-day        | 0.85  | 0.0000354  |

  @REQ-CMP-03 @UC-5.3 @rk-cmp-1 @rk-opt-8 @error
  Scenario Outline: A functional unit no rule converts is disregarded together with its score
    Given a -09 document with "functional-unit" "<legacy>" and "sci-score" 4.2
    When the consumer reads it in compatibility mode
    Then the member "functional-unit" is reported as disregarded
    And the member "sci-score" is reported as disregarded
    And the fetched object has no member "sci-score"

    Examples: the time belongs to the period, a converter does not guess it
      | legacy                      |
      | per-gigabyte-month          |
      | per-unit-lifecycle          |
      | per-active-user-per-month   |
      | per-cluster-month           |
      | req                         |
      | per-gb                      |
      | per-1k-requests             |

  @REQ-CMP-03 @REQ-FUN-01 @UC-5.3 @rk-cmp-1 @rk-opt-8 @edge
  Scenario Outline: per-session and per-vcpu-hour are -10 tokens and are kept as they are, with no conversion note
    Given a -09 document with "functional-unit" "<unit>" and "sci-score" 4.2
    When the consumer reads it in compatibility mode
    Then the fetched member "functional-unit" is "<unit>"
    And the fetched member "sci-score" is the number 4.2
    And the member "functional-unit" is not reported

    Examples:
      | unit          |
      | per-session   |
      | per-vcpu-hour |

  @REQ-CMP-03 @UC-5.3 @rk-cmp-1 @rk-opt-8 @edge
  Scenario: A unit without a score is converted or disregarded on the unit alone
    Given a -09 document with "functional-unit" "per-thousand-requests" and no "sci-score"
    When the consumer reads it in compatibility mode
    Then the fetched member "functional-unit" is "per-request"

  @REQ-CMP-03 @REQ-UPS-02 @UC-5.3 @rk-cmp-1 @rk-opt-13 @golden @req-9299a528
  Scenario Outline: A -09 role outside the six is disregarded and the entry is kept
    Given a -09 document with the upstream "https://provider.example/t.json" and role "<role>"
    When the consumer reads it in compatibility mode
    Then the member "upstream[0].role" is reported as disregarded
    And the fetched object keeps the upstream entry "https://provider.example/t.json"
    And the fetched upstream entry has no member "role"

    Examples:
      | role       |
      | transit    |
      | colo       |
      | Cloud      |
      | datacenter |

  @REQ-UPS-02 @REQ-CMP-03 @UC-5.3 @UC-3.1 @rk-cmp-1 @rk-opt-13 @edge @req-9299a528
  Scenario: colocation, which -09 listed no token for, is read as a role
    Given a -09 document with the upstream "https://provider.example/t.json" and role "colocation"
    When the consumer reads it in compatibility mode
    Then the fetched upstream entry has role "colocation"
    And the member "upstream[0].role" is not reported

  @REQ-CMP-03 @UC-5.3 @rk-cmp-1 @rk-opt-3 @golden
  Scenario: mtCO2e is read as tCO2e, numbers unchanged
    Given a -09 document with "carbon-unit" "mtCO2e" and "carbon-footprint" 610 and "scope-3" 300
    When the consumer reads it in compatibility mode
    Then the fetched member "carbon-unit" is "tCO2e"
    And the fetched member "carbon-footprint" is the number 610
    And the fetched member "scope-3" is the number 300
    And the member "carbon-unit" is reported as converted

  @REQ-CMP-03 @UC-5.3 @rk-cmp-1 @rk-opt-3 @error
  Scenario: Any other unknown carbon unit is not converted, so the document stays invalid
    Given a -09 document with "carbon-unit" "lbCO2e" and "carbon-footprint" 610 and "scope-3" 300
    When the consumer reads it in compatibility mode
    Then it is not valid
    And the errors mention "carbon-unit"
    And the member "carbon-unit" is not reported

  @REQ-CMP-03 @UC-5.3 @rk-cmp-1 @rk-opt-1 @golden
  Scenario: A target type outside the nine is disregarded
    Given a -09 document with "target-type" "datacenter"
    When the consumer reads it in compatibility mode
    Then the member "target-type" is reported as disregarded
    And the fetched object has no member "target-type"

  @REQ-TTY-01 @REQ-CMP-03 @UC-5.3 @rk-cmp-1 @rk-opt-1 @edge
  Scenario: facility, which -09 listed no token for, is read as a target type
    Given a -09 document with "target-type" "facility"
    When the consumer reads it in compatibility mode
    Then the fetched member "target-type" is "facility"

  @REQ-CMP-01 @REQ-CMP-03 @UC-5.3 @rk-cmp-1 @edge
  Scenario: A document with every older form is converted in one pass and each conversion is reported once
    Given a -09 document with period "2025-01-01" to "2025-12-31", method "metered", unit "per-thousand-requests" score 12, role "transit" and "carbon-unit" "mtCO2e"
    When the consumer reads it in compatibility mode
    Then it is valid
    And the report lists exactly these paths as converted: "period", "functional-unit", "carbon-unit"
    And the report lists exactly these paths as disregarded: "measurement-method", "upstream[0].role"

  # ---- signatures of older documents ----

  @REQ-CMP-03 @REQ-VER-13 @UC-5.3 @rk-cmp-1 @rk-sig-8 @edge
  Scenario: A -09 signed object whose tokens are converted verifies under compatibility when both sides convert the same way
    Given a -09 document with "functional-unit" "per-thousand-requests" and "sci-score" 12
    And the object is signed with EdDSA
    When the consumer reads it in compatibility mode
    And the consumer verifies the signature
    Then the signature status is "verified"
    And the signature note mentions "deprecated"

  @REQ-CMP-03 @UC-5.3 @rk-cmp-1 @error
  Scenario: A -09 signed object read in strict mode is invalid before its signature is looked at
    Given a -09 document with "functional-unit" "per-thousand-requests" and "sci-score" 12
    And the object is signed with EdDSA
    When the consumer reads it in strict mode
    Then it is not valid

  @REQ-CMP-01 @REQ-VER-13 @UC-5.3 @rk-cmp-1 @rk-sig-8 @edge
  Scenario: A signature over a -09 period verifies when the payload and the object are both -09
    Given a -09 document with period "2025-01-01" to "2025-12-31"
    And the object is signed with EdDSA
    When the consumer reads it in compatibility mode
    And the consumer verifies the signature
    Then the signature status is "verified"

  # ---- the publisher ----

  @REQ-CMP-02 @UC-1.2 @rk-cmp-2 @golden
  Scenario: The publisher accepts -08 and -09 periods as input and emits -10
    Given a publisher given the -08 reporting-period "2025-03"
    Then the published period is "2025-03-01T00:00:00Z" to "2025-04-01T00:00:00Z"
    And the published object has no member "reporting-period"
    Given a publisher given the -09 period "2025-03-01" to "2025-03-31"
    Then the published period is "2025-03-01T00:00:00Z" to "2025-04-01T00:00:00Z"

  @REQ-CMP-02 @UC-1.2 @rk-cmp-2 @golden
  Scenario: The publisher accepts an older period with an offset it is told
    Given a publisher given the -08 reporting-period "2026-03" with the offset "+08:00"
    Then the published period is "2026-03-01T00:00:00+08:00" to "2026-04-01T00:00:00+08:00"

  @REQ-CMP-02 @UC-1.2 @rk-cmp-2 @error
  Scenario Outline: The publisher refuses an older token and names the upgrade tool
    Given a publisher given <input>
    Then the publisher refuses to build it
    And the refusal names "sustainability-publisher upgrade"

    Examples:
      | input                                       |
      | the measurement method "metered"            |
      | the functional unit "per-thousand-requests" |
      | the carbon unit "mtCO2e"                    |
      | the upstream role "transit"                 |
      | the target type "datacenter"                |

  @REQ-CMP-02 @UC-1.2 @rk-cmp-2 @error
  Scenario: The CSV adapter skips a row with an older token and says why
    Given a CSV with one row whose measurement method is "metered" and one whose method is "hardware-metered"
    When the CSV adapter reads it
    Then the adapter yields 1 object
    And the adapter reports the skipped row with the reason mentioning "measurement-method"

  @REQ-CMP-02 @rk-opt-3 @edge
  Scenario: The publisher's enterprise adapters default to tCO2e
    Given a Salesforce Net Zero Cloud export without a carbon unit
    When the adapter reads it
    Then the object carries "carbon-unit" "tCO2e"

  # ---- the upgrade tool ----

  @REQ-CMP-04a @REQ-CMP-04b @REQ-CMP-04g @REQ-CMP-04i @UC-1.2 @rk-cmp-2 @golden
  Scenario Outline: upgrade converts a file and the result is valid -10
    Given the legacy file "<file>"
    When the upgrade tool runs on the document
    Then the upgrade output is valid under the -10 schema and the CDDL
    And the upgrade prints a line mentioning "<line>"
    And the upgrade exits with status 0

    Examples: fixtures copied from the -08 and -09 example responses, plus one live gateway data file
      | file                                     | line                  |
      | bdd/fixtures/legacy/08-organization.json | reporting-period      |
      | bdd/fixtures/legacy/09-organization.json | period                |
      | bdd/fixtures/legacy/09-removals.json     | measurement-method    |
      | bdd/fixtures/legacy/09-saas-platform.json | functional-unit      |
      | gateway/data/go.eco.json                 | carbon-unit           |

  @REQ-CMP-04e @UC-1.2 @rk-cmp-2 @edge
  Scenario: The gateway data wrapper is unwrapped, converted and wrapped again
    Given a gateway data file whose declaration is in a "document" member
    When the upgrade tool runs on the document
    Then the upgrade output keeps the "document" member
    And the converted declaration inside it is valid under the -10 schema

  @REQ-CMP-04e @UC-1.2 @rk-cmp-2 @edge
  Scenario: A fiscal-year extension decides the period of a -09 file
    Given the gateway data file "gateway/data/go.eco.json" with reporting-period "2025" and basis "fiscal-year-ended-2025-09-30"
    When the upgrade tool runs on the document
    Then the upgrade output has period "2024-10-01T00:00:00Z" to "2025-10-01T00:00:00Z"
    And the upgrade output does not keep the extension "urn:uuid:58f04ecf-c558-4674-8dc6-c8bdbb6a8041"
    And the upgrade prints a line mentioning "fiscal"

  @REQ-CMP-04f @UC-1.2 @rk-cmp-2 @golden
  Scenario: signed is not carried over, and the owner re-signs after upgrading
    Given a -09 document signed with EdDSA
    When the upgrade tool runs on the document
    Then the upgrade output has no member "signed"
    And the upgrade prints a line mentioning "signed"
    When the owner signs the output with an Ed25519 key
    Then the signature status is "verified"
    And the signature header "alg" is "Ed25519"

  @REQ-CMP-04a @UC-1.2 @rk-cmp-2 @edge
  Scenario Outline: The flags set the offset, the update time and the method
    Given a -09 document updated "2026-03-01T12:00:00Z" with period "2026-03-01" to "2026-03-31" and "measurement-method" "<method>"
    When the upgrade tool runs on the document with "<flags>"
    Then the upgrade output has period "<start>" to "<end>"
    And the upgrade output has "updated" "<updated>"
    And the upgrade output has "measurement-method" "<result>"

    Examples:
      | method   | flags                                                  | start                     | end                       | updated              | result              |
      | metered  |                                                        | 2026-03-01T00:00:00Z      | 2026-04-01T00:00:00Z      | 2026-03-01T12:00:00Z | third-party-modeled |
      | metered  | --offset +08:00                                        | 2026-03-01T00:00:00+08:00 | 2026-04-01T00:00:00+08:00 | 2026-03-01T12:00:00Z | third-party-modeled |
      | metered  | --updated 2026-11-02T00:00:00Z                         | 2026-03-01T00:00:00Z      | 2026-04-01T00:00:00Z      | 2026-11-02T00:00:00Z | third-party-modeled |
      | metered  | --measurement-method hardware-metered                  | 2026-03-01T00:00:00Z      | 2026-04-01T00:00:00Z      | 2026-03-01T12:00:00Z | hardware-metered    |
      | cloud-billing | --measurement-method hardware-metered             | 2026-03-01T00:00:00Z      | 2026-04-01T00:00:00Z      | 2026-03-01T12:00:00Z | cloud-billing       |

  @REQ-CMP-04g @REQ-CMP-04h @UC-1.2 @rk-cmp-2 @error
  Scenario Outline: A flag that is not valid stops the tool without writing
    Given a -09 document with period "2026-03-01" to "2026-03-31"
    When the upgrade tool runs on the document with "<flags>"
    Then the upgrade exits with status 2
    And no output file was written

    Examples:
      | flags                                       |
      | --offset 8                                  |
      | --offset +25:00                             |
      | --updated 2026-11-02                        |
      | --measurement-method spend-based            |
      | --unknown-flag                              |

  @REQ-CMP-04g @REQ-CMP-04h @UC-1.2 @rk-cmp-2 @error
  Scenario Outline: A document that cannot be converted is reported, not guessed
    Given the document <body>
    When the upgrade tool runs on the document
    Then the upgrade exits with status 1
    And the upgrade prints a line mentioning "<line>"

    Examples:
      | body                                              | line                |
      | with "measurement-method" 3                       | measurement-method  |
      | with "reporting-period" "2025-13"                 | reporting-period    |
      | which is not JSON                                 | JSON                |
      | which is the string "hello"                       | declaration         |

  @REQ-CMP-04b @REQ-CMP-04c @UC-1.2 @rk-cmp-2 @golden
  Scenario: upgrade --check exits 1 on a -09 file and lists each rule, and exits 0 on a -10 file
    Given a -09 document with period "2025-01-01" to "2025-12-31", method "metered", unit "per-thousand-requests" score 12 and role "transit"
    When the upgrade tool runs on the document with "--check"
    Then the upgrade exits with status 1
    And the upgrade prints a line mentioning "period"
    And the upgrade prints a line mentioning "measurement-method"
    And the upgrade prints a line mentioning "functional-unit"
    And the upgrade prints a line mentioning "role"
    And no output file was written
    Given a valid declaration object
    When the upgrade tool runs on the document with "--check"
    Then the upgrade exits with status 0

  @REQ-CMP-04c @UC-1.2 @rk-cmp-2 @edge
  Scenario: A value already valid in -10 is not a finding
    Given a valid declaration object with "functional-unit" "per-session" and "sci-score" 0.2
    When the upgrade tool runs on the document with "--check"
    Then the upgrade exits with status 0

  @REQ-CMP-04d @UC-1.2 @rk-cmp-2 @golden
  Scenario Outline: upgrade changes nothing in a -10 document, and twice is the same as once
    Given the case file "<file>"
    When the upgrade tool runs on the document
    Then the upgrade output is byte-identical to the input

    Examples:
      | file                          |
      | pos-fu-per-session.json       |
      | pos-fu-per-vcpu-hour.json     |
      | pos-role-colocation.json      |
      | pos-tt-facility.json          |
      | pos-cu-tCO2e.json             |
      | pos-negative-offset.json      |
      | example-0.json                |

  @REQ-CMP-04d @UC-1.2 @rk-cmp-2 @edge
  Scenario: Running upgrade a second time on its own output changes nothing
    Given a -09 document with period "2025-01-01" to "2025-12-31" and "functional-unit" "per-thousand-requests" and "sci-score" 12
    When the upgrade tool runs on the document
    And the upgrade tool runs on its own output
    Then the second output is byte-identical to the first

  @REQ-CMP-04a @UC-1.2 @rk-cmp-2 @edge
  Scenario: Members the rules do not touch are left as they were
    Given a -09 document with period "2025-01-01" to "2025-12-31" and the extension "https://acme.example/ext" with '{"a": [1, 2, {"b": null}]}'
    When the upgrade tool runs on the document
    Then every member other than "period" is deep-equal to the input

  @REQ-CMP-04a @UC-1.2 @rk-cmp-2 @edge
  Scenario: An array is converted object by object, and an empty array stays empty
    Given the document is an array of a -08 object and a -10 object
    When the upgrade tool runs on the document
    Then the first object is converted and the second is unchanged
    Given the document is an empty array
    When the upgrade tool runs on the document
    Then the upgrade output is an empty array

  @REQ-CMP-04a @UC-1.2 @rk-cmp-2 @edge
  Scenario: provider is normalized to NFC and nothing else about it changes
    Given a -09 document with "provider" in decomposed Unicode form
    When the upgrade tool runs on the document
    Then the upgrade output "provider" is in Normalization Form C

  # ---- upgrade exit status, no partial output, standard output by default ----

  @REQ-CMP-04g @golden @rk-cmp-2
  Scenario: A document with nothing to change makes the upgrade exit 0
    Given a valid declaration object
    When the upgrade tool runs on the document
    Then the upgrade exits with status 0
    And the upgrade output is byte-identical to the input

  @REQ-CMP-04g @error @rk-cmp-2
  Scenario: An unknown flag is a usage error: exit 2 and the usage is printed
    Given a -09 document with period "2026-03-01" to "2026-03-31"
    When the upgrade tool runs on the document with "--unknown-flag"
    Then the upgrade exits with status 2
    And the upgrade prints a line mentioning "usage"
    And no output file was written

  @REQ-CMP-04g @edge @rk-cmp-2
  Scenario Outline: A file that cannot be converted exits 1 with and without --check
    Given the document with "reporting-period" "2025-13"
    When the upgrade tool runs on the document with "<flags>"
    Then the upgrade exits with status 1
    And the upgrade prints a line mentioning "reporting-period"

    Examples:
      | flags   |
      |         |
      | --check |

  @REQ-CMP-04h @golden @rk-cmp-2
  Scenario: A successful conversion writes the whole output file
    Given a -09 document with period "2025-01-01" to "2025-12-31"
    When the upgrade tool runs on the document with the output file "out.json"
    Then the upgrade exits with status 0
    And the output file is valid under the -10 schema and the CDDL
    And the output file holds the whole document

  @REQ-CMP-04h @error @rk-cmp-2
  Scenario: A conversion that fails writes no output file and no partial document
    Given the document with "reporting-period" "2026-13"
    When the upgrade tool runs on the document with the output file "out.json"
    Then the upgrade exits with status 1
    And no output file was written

  @REQ-CMP-04h @edge @rk-cmp-2
  Scenario: An array whose second element cannot be converted writes nothing for the first
    Given the document is an array of a -08 object and an object with "reporting-period" "2025-13"
    When the upgrade tool runs on the document with the output file "out.json"
    Then the upgrade exits with status 1
    And no output file was written

  @REQ-CMP-04i @golden @rk-cmp-2
  Scenario: With IN alone the converted document goes to standard output and no file is written
    Given a -09 document with period "2025-01-01" to "2025-12-31"
    When the upgrade tool runs on the document
    Then the upgrade writes the converted document to standard output
    And no output file was written

  @REQ-CMP-04i @edge @rk-cmp-2
  Scenario: IN and a different OUT write OUT and leave IN untouched
    Given a -09 document with period "2025-01-01" to "2025-12-31"
    When the upgrade tool runs on the document with the output file "out.json"
    Then the output file is valid under the -10 schema and the CDDL
    And the input file is unchanged

  @REQ-CMP-04i @REQ-CMP-04h @error @rk-cmp-2
  Scenario: IN given twice converts in place, and a failed conversion leaves the file as it was
    Given the document with "reporting-period" "2025-13"
    When the upgrade tool runs on the document in place
    Then the upgrade exits with status 1
    And the input file is unchanged

  @REQ-CMP-04i @edge @rk-cmp-2
  Scenario: IN given twice converts the file in place
    Given a -09 document with period "2025-01-01" to "2025-12-31"
    When the upgrade tool runs on the document in place
    Then the upgrade exits with status 0
    And the input file is valid under the -10 schema and the CDDL
