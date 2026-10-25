Feature: Payload and periods
  Every date in a declaration is an RFC 3339 date-time. A period is half-open: start included, end excluded,
  start before end. Whole calendar days, months and years are defined by the two bounds alone, each read in its
  own offset. Draft -10, "Mandatory Members", "Optional Members", "Periods and Freshness", "Privacy Considerations".

  Background:
    Given the clock is fixed at "2026-10-24T12:00:00Z"

  @REQ-PER-01 @rk-mand-5 @golden
  Scenario Outline: A period with a valid date-time pair is accepted
    Given a valid declaration object
    And the declaration has period "<start>" to "<end>"
    When the consumer validates it
    Then it is valid

    Examples: offsets, fractions and leap day
      | start                       | end                         |
      | 2025-01-01T00:00:00Z        | 2026-01-01T00:00:00Z        |
      | 2026-03-01T00:00:00+08:00   | 2026-04-01T00:00:00+08:00   |
      | 2026-03-01T00:00:00-05:00   | 2026-04-01T00:00:00-04:00   |
      | 2026-03-01T00:00:00+05:45   | 2026-04-01T00:00:00+05:45   |
      | 2025-01-01T00:00:00.000Z    | 2025-01-02T00:00:00.000Z    |
      | 2025-01-01T00:00:00.123456789Z | 2025-01-02T00:00:00Z     |
      | 2024-02-29T00:00:00Z        | 2024-03-01T00:00:00Z        |
      | 2025-01-01T00:00:00+00:00   | 2025-02-01T00:00:00Z        |
      | 2025-01-01T00:00:00Z        | 2025-01-01T00:00:01Z        |

  @REQ-PER-01 @REQ-FRM-04 @rk-mand-5 @error
  Scenario Outline: A bound that is not an upper-case RFC 3339 date-time is invalid
    Given a valid declaration object
    And the declaration has period "<start>" to "2026-01-01T00:00:00Z"
    When the consumer validates it
    Then it is not valid
    And the errors mention "period"

    Examples: start values
      | start                                |
      | 2025-01-01                           |
      | 2025-01-01T00:00Z                    |
      | 2025-01-01T00:00:00                  |
      | 2025-01-01t00:00:00Z                 |
      | 2025-01-01T00:00:00z                 |
      | 2025-01-01 00:00:00Z                 |
      | 2025-01-01T00:00:00+0100             |
      | 2025-01-01T00:00:00+01               |
      | 2025-01-01T00:00:00Z[Europe/Berlin]  |
      | 2025-01-01T00:00:00ZZ                |
      | x2025-01-01T00:00:00Z                |
      | 2025-13-01T00:00:00Z                 |
      | 2025-00-10T00:00:00Z                 |
      | 2025-02-29T00:00:00Z                 |
      | 2025-04-31T00:00:00Z                 |
      | 2025-01-01T24:00:00Z                 |
      | 2025-01-01T00:60:00Z                 |
      | 2025-01-01T00:00:00+24:00            |
      | 2025-01-01T00:00:00.Z                |
      | 20250101T000000Z                     |
      | 1735689600                           |

  @REQ-MND-02 @REQ-FRM-04 @rk-mand-1 @error
  Scenario Outline: updated is a date-time too
    Given a valid declaration object
    And the member "updated" is "<value>"
    When the consumer validates it
    Then it is not valid
    And the errors mention "updated"

    Examples:
      | value                |
      | 2026-03-01           |
      | 2026-03-01t12:00:00Z |
      | 2026-03-01T12:00:00z |
      | 2026-03-01T12:00:00  |

  @REQ-PER-01 @rk-mand-5 @error
  Scenario: A period object without start or end is invalid, and so is a period that is not an object
    Given a valid declaration object
    And the member "period" is the string "2025"
    When the consumer validates it
    Then it is not valid
    Given a valid declaration object
    And the member "period.end" is removed
    When the consumer validates it
    Then it is not valid

  @REQ-PER-02 @rk-mand-6 @error @req-24108bed
  Scenario Outline: start must be before end, compared as instants
    Given a valid declaration object
    And the declaration has period "<start>" to "<end>"
    When the consumer validates it
    Then it is not valid
    And the errors mention "start"

    Examples:
      | start                       | end                         |
      | 2025-01-01T00:00:00Z        | 2025-01-01T00:00:00Z        |
      | 2025-02-01T00:00:00Z        | 2025-01-01T00:00:00Z        |
      | 2025-01-01T08:00:00+08:00   | 2025-01-01T00:00:00Z        |
      | 2025-01-01T00:00:00+00:00   | 2025-01-01T00:00:00Z        |
      | 2025-01-01T00:00:00.5Z      | 2025-01-01T00:00:00.5Z      |

  @REQ-PER-02 @rk-mand-6 @edge @req-24108bed
  Scenario: Instants decide, not the text, when the offsets differ
    Given a valid declaration object
    And the declaration has period "2025-01-01T00:00:00+14:00" to "2025-01-01T00:00:00Z"
    When the consumer validates it
    Then it is valid

  @REQ-PER-02 @UC-1.1 @rk-mand-6 @error @req-24108bed
  Scenario: The publisher refuses to build a period whose start is not before its end
    Given a publisher given the period "2025-02-01T00:00:00Z" to "2025-01-01T00:00:00Z"
    Then the publisher refuses to build it
    And the refusal names "start"

  @REQ-PER-03 @rk-mand-7 @golden
  Scenario: Consecutive periods meet without overlap, and the end is not part of the period
    Given the declaration is an array of objects with periods "2025-01", "2025-02", "2025-03"
    When the consumer validates it
    Then it is valid
    And the periods "2025-01" and "2025-02" are reported as not overlapping
    And the period "2025-01" contains "2025-01-31T23:59:59Z" and does not contain "2025-02-01T00:00:00Z"

  @REQ-PER-03 @rk-mand-7 @edge
  Scenario Outline: Overlap is half-open for any pair of periods
    Then the period <a> and the period <b> <verdict>

    Examples:
      | a                                                 | b                                                 | verdict          |
      | 2025-01-01T00:00:00Z/2025-02-01T00:00:00Z         | 2025-02-01T00:00:00Z/2025-03-01T00:00:00Z         | do not overlap   |
      | 2025-01-01T00:00:00Z/2025-02-01T00:00:00Z         | 2025-01-31T23:59:59Z/2025-03-01T00:00:00Z         | overlap          |
      | 2025-01-01T00:00:00Z/2026-01-01T00:00:00Z         | 2025-06-01T00:00:00Z/2025-07-01T00:00:00Z         | overlap          |
      | 2025-01-01T00:00:00Z/2025-02-01T00:00:00Z         | 2025-02-01T01:00:00+01:00/2025-03-01T00:00:00Z    | do not overlap   |
      | 2025-01-01T08:00:00+08:00/2025-01-02T00:00:00Z    | 2025-01-01T00:00:00Z/2025-01-01T12:00:00Z         | overlap          |

  # Whole day: the end's calendar date, read in its own offset, is the start's plus one. Whole month: both bounds on day 1 and the end's year-month is the start's plus one. Whole year: both on 1 January and the end's year is the start's plus one.
  @REQ-PER-05 @rk-mand-9 @golden
  Scenario Outline: A whole calendar year, month or day is decided by the two bounds alone
    Given a valid declaration object
    And the declaration has period "<start>" to "<end>"
    Then the period is classified as "<unit>"

    Examples: UTC
      | start                       | end                         | unit    |
      | 2025-01-01T00:00:00Z        | 2026-01-01T00:00:00Z        | yearly  |
      | 2024-01-01T00:00:00Z        | 2025-01-01T00:00:00Z        | yearly  |
      | 2025-02-01T00:00:00Z        | 2025-03-01T00:00:00Z        | monthly |
      | 2024-02-01T00:00:00Z        | 2024-03-01T00:00:00Z        | monthly |
      | 2025-12-01T00:00:00Z        | 2026-01-01T00:00:00Z        | monthly |
      | 2025-02-28T00:00:00Z        | 2025-03-01T00:00:00Z        | daily   |
      | 2024-02-29T00:00:00Z        | 2024-03-01T00:00:00Z        | daily   |
      | 2025-01-01T00:00:00.000Z    | 2025-01-02T00:00:00.000Z    | daily   |
      | 2025-12-31T00:00:00Z        | 2026-01-01T00:00:00Z        | daily   |
      | 2025-01-01T00:00:00+00:00   | 2026-01-01T00:00:00+00:00   | yearly  |

  @REQ-PER-05 @REQ-PER-06 @rk-mand-9 @rk-mand-8 @edge
  Scenario Outline: Whole calendar units across daylight-saving changes and offset reforms
    Given a valid declaration object
    And the declaration has period "<start>" to "<end>"
    Then the period is classified as "<unit>"

    Examples: local accounting periods
      | case                                   | start                       | end                         | unit    |
      | Singapore March (+08:00 all year)      | 2026-03-01T00:00:00+08:00   | 2026-04-01T00:00:00+08:00   | monthly |
      | Berlin March, spring forward           | 2025-03-01T00:00:00+01:00   | 2025-04-01T00:00:00+02:00   | monthly |
      | Berlin October, fall back              | 2025-10-01T00:00:00+02:00   | 2025-11-01T00:00:00+01:00   | monthly |
      | Berlin 2025, whole year                | 2025-01-01T00:00:00+01:00   | 2026-01-01T00:00:00+01:00   | yearly  |
      | Berlin 23-hour day                     | 2025-03-30T00:00:00+01:00   | 2025-03-31T00:00:00+02:00   | daily   |
      | Berlin 25-hour day                     | 2025-10-26T00:00:00+02:00   | 2025-10-27T00:00:00+01:00   | daily   |
      | New York March, spring forward         | 2025-03-01T00:00:00-05:00   | 2025-04-01T00:00:00-04:00   | monthly |
      | Lord Howe half-hour change, April      | 2025-04-01T00:00:00+11:00   | 2025-05-01T00:00:00+10:30   | monthly |
      | Samoa December 2011, skipped 30 Dec    | 2011-12-01T00:00:00-10:00   | 2012-01-01T00:00:00+14:00   | monthly |
      | Samoa 2011, the year with a missing day | 2011-01-01T00:00:00-10:00  | 2012-01-01T00:00:00+14:00   | yearly  |
      | Kiribati 1994 date-line move           | 1994-12-01T00:00:00-10:00   | 1995-01-01T00:00:00+14:00   | monthly |

  @REQ-PER-05 @rk-mand-9 @error
  Scenario Outline: Several whole months, or a shifted or foreign-boundary period, are not a whole unit
    Given a valid declaration object
    And the declaration has period "<start>" to "<end>"
    Then the period is classified as "<unit>"

    Examples:
      | case                                | start                       | end                         | unit    |
      | a quarter is not a month            | 2025-01-01T00:00:00Z        | 2025-04-01T00:00:00Z        | none    |
      | two months                          | 2025-01-01T00:00:00Z        | 2025-03-01T00:00:00Z        | none    |
      | two years                           | 2025-01-01T00:00:00Z        | 2027-01-01T00:00:00Z        | none    |
      | reporting year ending 31 March      | 2025-04-01T00:00:00Z        | 2026-04-01T00:00:00Z        | none    |
      | one hour late month                 | 2025-01-01T01:00:00Z        | 2025-02-01T01:00:00Z        | none    |
      | month end one second short          | 2025-01-01T00:00:00Z        | 2025-01-31T23:59:59Z        | none    |
      | two days                            | 2025-01-01T00:00:00Z        | 2025-01-03T00:00:00Z        | none    |
      | half a day                          | 2025-01-01T00:00:00Z        | 2025-01-01T12:00:00Z        | none    |
      | 30 days from 1 Jan                  | 2025-01-01T00:00:00Z        | 2025-01-31T00:00:00Z        | none    |
      | February without its last day       | 2025-02-01T00:00:00Z        | 2025-02-28T00:00:00Z        | none    |

  @REQ-BDY-03 @rk-mand-12 @rk-body-5 @edge
  Scenario: A year and its months in one array are two views of the same figures, not additional ones
    Given the declaration is an array of objects with periods "2025", "2025-01", "2025-02"
    When the consumer validates it
    Then it is valid
    And the periods "2025-01" and "2025" are reported as overlapping

  @REQ-PER-04 @rk-mand-8 @golden @req-8322eb9f
  Scenario: A publisher writes each bound in the offset in force at that boundary
    Given a publisher given the calendar month "2025-03" in the time zone "Europe/Berlin"
    Then the published period is "2025-03-01T00:00:00+01:00" to "2025-04-01T00:00:00+02:00"
    And the period is classified as "monthly"

  @REQ-PER-04 @REQ-PER-06 @UC-4.1 @rk-mand-8 @golden @req-8322eb9f
  Scenario Outline: A publisher whose accounting day is a local day writes the one offset it uses
    Given a publisher given the calendar month "2026-03" with the offset "<offset>"
    Then the published period is "2026-03-01T00:00:00<offset>" to "2026-04-01T00:00:00<offset>"

    Examples:
      | offset |
      | Z      |
      | +08:00 |
      | -05:00 |

  @REQ-PER-04 @REQ-PER-07 @UC-1.1 @rk-mand-8 @rk-mand-10 @golden @req-658f55db @req-8322eb9f
  Scenario: A publisher writes whole UTC months and years with Z by default
    Given a publisher given the calendar year 2025
    Then the published period is "2025-01-01T00:00:00Z" to "2026-01-01T00:00:00Z"
    Given a publisher given the calendar month "2025-02"
    Then the published period is "2025-02-01T00:00:00Z" to "2025-03-01T00:00:00Z"

  @REQ-PER-08 @rk-mand-10 @golden @req-305ad347
  Scenario Outline: A period of a calendar day or longer on day boundaries raises no warning
    Given a valid declaration object
    And the declaration has period "<start>" to "<end>"
    When the consumer validates it
    Then it is valid
    And there is no warning mentioning "day"

    Examples:
      | start                       | end                         |
      | 2025-01-01T00:00:00Z        | 2025-01-02T00:00:00Z        |
      | 2025-01-01T00:00:00Z        | 2025-01-04T00:00:00Z        |
      | 2025-03-01T00:00:00Z        | 2025-04-01T00:00:00Z        |
      | 2025-03-30T00:00:00+01:00   | 2025-03-31T00:00:00+02:00   |
      | 2026-03-01T00:00:00+08:00   | 2026-03-02T00:00:00+08:00   |

  @REQ-PER-08 @UC-4.2 @rk-mand-10 @edge @req-305ad347
  Scenario Outline: A period shorter than a calendar day, or off day boundaries, is valid and draws a warning
    Given a valid declaration object
    And the declaration has period "<start>" to "<end>"
    When the consumer validates it
    Then it is valid
    And the warnings mention "calendar day"

    Examples:
      | case                 | start                       | end                         |
      | one hour             | 2025-01-01T00:00:00Z        | 2025-01-01T01:00:00Z        |
      | twelve hours         | 2025-01-01T00:00:00Z        | 2025-01-01T12:00:00Z        |
      | not at midnight      | 2025-01-01T06:00:00Z        | 2025-01-02T06:00:00Z        |
      | end off the boundary | 2025-01-01T00:00:00Z        | 2025-01-03T12:00:00Z        |
      | thirty hours         | 2025-01-01T00:00:00Z        | 2025-01-02T06:00:00Z        |
      | one second           | 2025-01-01T00:00:00Z        | 2025-01-01T00:00:01Z        |
      | midnight UTC written in +08:00, so 08:00 local | 2025-01-01T08:00:00+08:00 | 2025-01-02T08:00:00+08:00 |

  @REQ-PER-08 @rk-mand-10 @edge @req-305ad347
  Scenario: The warning is advice, never a refusal: the object stays valid and usable
    Given a valid declaration object
    And the declaration has period "2025-01-01T06:00:00Z" to "2025-01-01T07:00:00Z"
    When the consumer retrieves and validates it
    Then it is valid
    And the warnings mention "calendar day"
    And the object is kept in the result

  @REQ-TOT-03 @UC-5.4 @rk-agg-1 @golden @req-8b68868e
  Scenario: Meeting periods of one target add up after conversion to one unit
    Given the declaration is an array of two objects:
      | period                                            | carbon-footprint | carbon-unit | carbon-accounting |
      | 2025-01-01T00:00:00Z/2025-02-01T00:00:00Z         | 2                | tCO2e       | location-based    |
      | 2025-02-01T00:00:00Z/2025-03-01T00:00:00Z         | 500              | kgCO2e      | location-based    |
    When the consumer totals the array
    Then the total "carbon-footprint" is 2.5 tCO2e
    And the total covers "2025-01-01T00:00:00Z" to "2025-03-01T00:00:00Z"

  @REQ-TOT-02 @REQ-TOT-03 @UC-5.4 @rk-agg-1 @edge @req-8b68868e
  Scenario Outline: A total never counts the same figures twice or mixes accounting methods
    Given the declaration is an array of two objects:
      | period   | target   | carbon-footprint | carbon-accounting |
      | <p1>     | <t1>     | 10               | <a1>              |
      | <p2>     | <t2>     | 20               | <a2>              |
    When the consumer totals the array
    Then the total "carbon-footprint" is <total>

    Examples:
      | p1                                        | t1          | a1             | p2                                        | t2          | a2             | total     |
      | 2025-01-01T00:00:00Z/2026-01-01T00:00:00Z | example.com | location-based | 2025-02-01T00:00:00Z/2025-03-01T00:00:00Z | example.com | location-based | not added |
      | 2025-01-01T00:00:00Z/2025-02-01T00:00:00Z | example.com | location-based | 2025-02-01T00:00:00Z/2025-03-01T00:00:00Z | example.com | market-based   | not added |
      | 2025-01-01T00:00:00Z/2025-02-01T00:00:00Z | example.com | location-based | 2025-02-01T00:00:00Z/2025-03-01T00:00:00Z | /api/v1     | location-based | not added |
      | 2025-01-01T00:00:00Z/2025-02-01T00:00:00Z | example.com | location-based | 2025-02-01T00:00:00Z/2025-03-01T00:00:00Z | example.com | location-based | 30        |
      | 2025-01-01T00:00:00Z/2025-02-01T00:00:00Z | example.com |                | 2025-02-01T00:00:00Z/2025-03-01T00:00:00Z | example.com |                | 30        |
      | 2025-01-01T00:00:00Z/2025-02-01T00:00:00Z | example.com | location-based | 2025-02-01T00:00:00Z/2025-03-01T00:00:00Z | example.com |                | not added |
      | 2025-01-01T00:00:00Z/2025-02-01T00:00:00Z | example.com | location-based | 2025-01-31T00:00:00Z/2025-03-01T00:00:00Z | example.com | location-based | not added |
      | 2025-01-01T00:00:00+01:00/2025-02-01T00:00:00+01:00 | example.com | location-based | 2024-12-31T23:00:00Z/2025-02-01T00:00:00Z | example.com | location-based | not added |

  @REQ-TOT-01 @REQ-TOT-06 @UC-5.1 @golden
  Scenario: A reading is presented as covering its period, not as current
    Given a local server whose declaration covers "2025-01-01T00:00:00Z" to "2026-01-01T00:00:00Z" with "Cache-Control: max-age=3600"
    When the consumer fetches the local origin allowing insecure transport
    Then the presentation says the figures cover "2025-01-01T00:00:00Z" to "2026-01-01T00:00:00Z"
    And the presentation does not call the figures current

  @REQ-TOT-04 @REQ-TOT-05 @UC-5.1 @edge
  Scenario: A reading kept past its freshness lifetime is revalidated before it is relied on
    Given a local server whose declaration carries "Cache-Control: max-age=60" and an entity tag
    And the consumer fetched it at "2026-10-24T12:00:00Z"
    When the clock moves to "2026-10-24T12:05:00Z"
    And the consumer relies on the stored reading
    Then the consumer sent a conditional request with the entity tag
    And the server answered 304

  @REQ-NUM-01 @REQ-SCP-02 @REQ-DRV-03 @UC-1.1 @rk-opt-5 @rk-opt-6 @rk-opt-9 @golden @req-27e5209f @req-48bd044c
  Scenario Outline: A numeric member in range is valid
    Given a valid declaration object
    And the member "<member>" is the number <value>
    When the consumer validates it
    Then it is valid

    Examples:
      | member                             | value   |
      | energy-consumption                 | 0       |
      | energy-consumption                 | 1250.5  |
      | carbon-footprint                   | 0       |
      | renewable-energy                   | 0       |
      | renewable-energy                   | 100     |
      | renewable-energy                   | 62.5    |
      | scope-1                            | -12     |
      | scope-2                            | -0.5    |
      | scope-3                            | -300    |
      | carbon-intensity-gCO2e-per-kWh     | 0       |
      | estimated-annual-emissions-kgCO2e  | 0       |

  @REQ-NUM-01 @REQ-DRV-03 @rk-opt-5 @rk-opt-9 @error @req-27e5209f
  Scenario Outline: A numeric member out of range is invalid
    Given a valid declaration object
    And the member "<member>" is the number <value>
    When the consumer validates it
    Then it is not valid
    And the errors mention "<member>"

    Examples:
      | member                             | value   |
      | energy-consumption                 | -1      |
      | carbon-footprint                   | -0.001  |
      | carbon-intensity-gCO2e-per-kWh     | -5      |
      | estimated-annual-emissions-kgCO2e  | -1      |
      | renewable-energy                   | 100.1   |
      | renewable-energy                   | -1      |
      | sci-score                          | -0.1    |

  @REQ-NUM-02 @rk-body-6 @error @req-27e5209f
  Scenario Outline: A number beyond binary64 or a number written as a string is invalid
    Given a local server whose body is a declaration with the raw member '<raw>'
    When the consumer fetches the local origin allowing insecure transport
    Then the fetch did not succeed

    Examples:
      | raw                          |
      | "energy-consumption": 1e999  |
      | "energy-consumption": "12"   |
      | "energy-consumption": null   |
      | "carbon-footprint": true     |

  @REQ-NUM-01 @REQ-NUM-02 @UC-1.1 @rk-opt-5 @rk-body-6 @error @req-27e5209f
  Scenario: The publisher refuses a negative or non-finite figure and a number it cannot represent
    Then a publisher given a negative gross figure refuses to build
    And a publisher given a non-finite figure refuses to build
    And a publisher given the number 9007199254740993 for "energy-consumption" refuses to build

  @REQ-ENG-01 @REQ-CAR-01 @UC-4.2 @rk-opt-2 @rk-opt-3 @golden
  Scenario: The default units are kWh and gCO2e
    Given a valid declaration object
    And the member "energy-unit" is removed
    And the member "carbon-unit" is removed
    And the member "energy-consumption" is the number 1000
    And the member "carbon-footprint" is the number 500
    When the consumer reads the figures in standard units
    Then the energy is 1000 kWh
    And the carbon is 500 gCO2e

  @REQ-SCI-01 @rk-opt-7 @error @req-c340c99a
  Scenario: A score without a functional unit is invalid
    Given a valid declaration object
    And the member "sci-score" is the number 0.4
    And the member "functional-unit" is removed
    When the consumer validates it
    Then it is not valid
    And the errors mention "functional-unit"

  @REQ-SCI-01 @rk-opt-7 @golden @req-c340c99a
  Scenario: A functional unit without a score is valid
    Given a valid declaration object
    And the member "functional-unit" is "per-request"
    And the member "sci-score" is removed
    When the consumer validates it
    Then it is valid

  @REQ-BDY-04 @rk-body-5 @rk-opt-7 @edge
  Scenario: Figures that differ only in functional unit or accounting are separate objects for one target and period
    Given the declaration is an array of two objects:
      | period                                    | target      | sci-score | functional-unit |
      | 2025-01-01T00:00:00Z/2026-01-01T00:00:00Z | example.com | 0.4       | per-request     |
      | 2025-01-01T00:00:00Z/2026-01-01T00:00:00Z | example.com | 12        | per-user        |
    When the consumer validates it
    Then it is valid

  @REQ-SCP-01 @rk-opt-6 @edge @req-4edc4aed
  Scenario Outline: Scopes that do not account for the footprint draw a warning, not an error
    Given a valid declaration object
    And the member "carbon-unit" is "tCO2e"
    And the member "carbon-footprint" is the number <footprint>
    And the member "scope-1" is the number <s1>
    And the member "scope-2" is the number <s2>
    And the member "scope-3" is the number <s3>
    When the consumer validates it
    Then it is valid
    And the warnings <warns>

    Examples:
      | footprint | s1 | s2 | s3 | warns                          |
      | 610       | 90 | 220 | 300 | do not mention "scope"       |
      | 610       | 90 | 220 | 100 | mention "scope"              |
      | 610       | 90 | 220 | 330 | mention "scope"              |
      | 610       | 700 | 0  | -90 | do not mention "scope"       |

  @REQ-FRM-05 @golden
  Scenario Outline: Every positive case of the validated corpus is valid
    Given the case file "<file>"
    When the consumer validates it
    Then it is valid
    And the publisher's schema agrees
    And the CDDL agrees

    Examples: the draft's validated example cases
      | file                              |
      | all-ca-location-based.json        |
      | all-ca-market-based.json          |
      | all-cu-gCO2e.json                 |
      | all-cu-kgCO2e.json                |
      | all-cu-tCO2e.json                 |
      | all-eu-Wh.json                    |
      | all-eu-kWh.json                   |
      | all-eu-MWh.json                   |
      | all-eu-GWh.json                   |
      | all-fu-per-device.json            |
      | all-fu-per-gigabyte-hour.json     |
      | all-fu-per-gigabyte.json          |
      | all-fu-per-inference.json         |
      | all-fu-per-job.json               |
      | all-fu-per-page-view.json         |
      | all-fu-per-request.json           |
      | all-fu-per-token.json             |
      | all-fu-per-transaction.json       |
      | all-fu-per-user.json              |
      | all-mm-cloud-billing.json         |
      | all-mm-hardware-estimated.json    |
      | all-mm-hardware-metered.json      |
      | all-mm-third-party-modeled.json   |
      | all-role-cdn.json                 |
      | all-role-cloud.json               |
      | all-role-colocation.json          |
      | all-role-electricity.json         |
      | all-role-hosting.json             |
      | all-role-network.json             |
      | all-tt-data-source.json           |
      | all-tt-device.json                |
      | all-tt-facility.json              |
      | all-tt-organization.json          |
      | all-tt-origin.json                |
      | all-tt-path.json                  |
      | all-tt-product.json               |
      | all-tt-service.json               |
      | all-tt-tenant.json                |
      | ex-1.json                         |
      | ex-2.json                         |
      | ex-3.json                         |
      | ex-4.json                         |
      | ex-5.json                         |
      | example-0.json                    |
      | example-1.json                    |
      | example-2.json                    |
      | example-3.json                    |
      | example-4.json                    |
      | pos-cu-tCO2e.json                 |
      | pos-fractional-seconds.json       |
      | pos-fu-per-device.json            |
      | pos-fu-per-gigabyte-hour.json     |
      | pos-fu-per-gigabyte.json          |
      | pos-fu-per-inference.json         |
      | pos-fu-per-job.json               |
      | pos-fu-per-page-view.json         |
      | pos-fu-per-request.json           |
      | pos-fu-per-session.json           |
      | pos-fu-per-token.json             |
      | pos-fu-per-transaction.json       |
      | pos-fu-per-user.json              |
      | pos-fu-per-vcpu-hour.json         |
      | pos-method-cloud-billing.json     |
      | pos-method-hardware-estimated.json |
      | pos-method-hardware-metered.json  |
      | pos-method-third-party-modeled.json |
      | pos-negative-offset.json          |
      | pos-role-cdn.json                 |
      | pos-role-cloud.json               |
      | pos-role-colocation.json          |
      | pos-role-hosting.json             |
      | pos-role-network.json             |
      | pos-tt-facility.json              |
      | pos-upstream-role-electricity.json |
      | pos-upstream-without-role.json    |

  @REQ-FRM-05 @error
  Scenario Outline: Every negative case of the validated corpus is invalid
    Given the case file "<file>"
    When the consumer validates it
    Then it is not valid
    And the publisher's schema agrees
    And the CDDL agrees

    Examples: the draft's validated example cases
      | file                                          |
      | neg-ca-hourly-market-based.json               |
      | neg-cu-mtCO2e.json                            |
      | neg-eu-TWh.json                               |
      | neg-fu-case-Per-Request.json                  |
      | neg-fu-per-terabyte-day.json                  |
      | neg-fu-per-thousand-requests.json             |
      | neg-functional-unit-per-thousand-requests.json |
      | neg-functional-unit-per-visit.json            |
      | neg-functional-unit-single-object.json        |
      | neg-leading-garbage-anchoring.json            |
      | neg-method-case-variant.json                  |
      | neg-method-free-text.json                     |
      | neg-method-token-not-in-set.json              |
      | neg-mm-spend-based.json                       |
      | neg-no-seconds.json                           |
      | neg-period-date-only-in-array.json            |
      | neg-period-date-only.json                     |
      | neg-role-transit.json                         |
      | neg-trailing-garbage-anchoring.json           |
      | neg-tt-datacenter.json                        |
      | neg-updated-date-only.json                    |
      | neg-upstream-role-case-variant.json           |
      | neg-upstream-role-transit.json                |

  @REQ-FRM-05 @error
  Scenario Outline: A timestamp form that JSON Type Definition cannot state is invalid for the consumer and the CDDL
    Given the case file "<file>"
    When the consumer validates it
    Then it is not valid
    And the CDDL agrees

    Examples: the draft's validated example cases
      | file                                |
      | neg-offset-without-colon.json       |
      | neg-period-end-lowercase-z.json     |
      | neg-period-start-lowercase-t.json   |
      | neg-period-start-lowercase-z.json   |
      | neg-space-separator.json            |
      | neg-updated-lowercase-z.json        |

  # ---- arrays, I-JSON, language, target, derived members, links, examples ----

  @REQ-BDY-03 @golden @rk-body-1 @rk-mand-12
  Scenario: An origin and one of its services in one array are accepted
    Given the draft's example "An Origin and One of Its Services"
    When the consumer validates it
    Then it is valid
    And the body is a JSON array of 2 objects

  @REQ-BDY-03 @error @rk-mand-12
  Scenario: An array in which one element is invalid is invalid, and the error names the element
    Given the declaration is an array of a valid object and an object without the member "target"
    When the consumer validates it
    Then it is not valid
    And the errors mention "target"
    And the errors name the array element 1

  @REQ-BDY-03 @edge @rk-mand-12
  Scenario Outline: An array may hold a year beside its months, in any order, with overlaps
    Given the declaration is an array of objects with periods <periods>
    When the consumer validates it
    Then it is valid

    Examples:
      | periods                                                                                                                              |
      | "2025-03-01T00:00:00Z/2025-04-01T00:00:00Z", "2025-01-01T00:00:00Z/2026-01-01T00:00:00Z", "2025-01-01T00:00:00Z/2025-02-01T00:00:00Z" |
      | "2025-01-01T00:00:00Z/2025-02-01T00:00:00Z", "2025-01-01T00:00:00Z/2025-02-01T00:00:00Z"                                              |
      | "2025-01-01T00:00:00Z/2025-02-01T00:00:00Z", "2025-02-01T00:00:00+01:00/2025-03-01T00:00:00+01:00"                                    |

  @REQ-BDY-04 @golden @rk-body-5
  Scenario Outline: Figures that differ only in accounting method or functional unit are separate objects
    Given the declaration is an array of two objects of one target and one period:
      | target      | period                                    | <member>   | <figure>   |
      | example.com | 2025-01-01T00:00:00Z/2026-01-01T00:00:00Z | <first>    | <figure 1> |
      | example.com | 2025-01-01T00:00:00Z/2026-01-01T00:00:00Z | <second>   | <figure 2> |
    When the consumer validates it
    Then it is valid

    Examples:
      | member             | figure | first          | figure 1 | second       | figure 2 |
      | carbon-accounting  | scope-2 | location-based | 520      | market-based | 410      |
      | functional-unit    | sci-score | per-request  | 0.012    | per-user     | 3.4      |

  @REQ-BDY-04 @error @rk-body-5
  Scenario: One object that holds two carbon-accounting values is invalid
    Given a valid declaration object
    And the member "carbon-accounting" is the JSON '["location-based", "market-based"]'
    When the consumer validates it
    Then it is not valid
    And the errors mention "carbon-accounting"

  @REQ-BDY-04 @edge @rk-body-5
  Scenario: Twins that differ only in accounting method are not reported as duplicates
    Given the declaration is an array of two objects of one target and one period:
      | target      | period                                    | carbon-accounting | scope-2 |
      | example.com | 2025-01-01T00:00:00Z/2026-01-01T00:00:00Z | location-based    | 520     |
      | example.com | 2025-01-01T00:00:00Z/2026-01-01T00:00:00Z | market-based      | 410     |
    When the consumer validates it
    Then it is valid
    And there is no warning mentioning "duplicate"

  @REQ-BDY-06 @golden @rk-body-6
  Scenario: An ordinary document of finite numbers and Z timestamps passes the I-JSON gate
    Given a valid declaration object
    When the publisher serialises the object
    Then the I-JSON gate accepts the text

  @REQ-BDY-06 @error @rk-body-6
  Scenario Outline: A publisher input that is not I-JSON is refused
    Given a publisher input file whose "<member>" is the raw value <raw>
    When the publisher builds it
    Then the publisher refuses and names "<member>"

    Examples:
      | member             | raw                 |
      | energy-consumption | 1e400               |
      | energy-consumption | 9007199254740993    |
      | provider           | "ab\ud800cd"        |

  @REQ-BDY-06 @edge @rk-body-6
  Scenario: A value such as 0.1 plus 0.2 is written in its shortest round-trip form
    Given a publisher input file whose "energy-consumption" is the sum 0.1 + 0.2
    When the publisher builds it
    Then the published member "energy-consumption" is the number 0.30000000000000004

  @REQ-MND-05 @golden @req-233a411a
  Scenario: A configured language is sent as the Content-Language header
    Given a valid declaration object
    And the publisher is configured with the language "en"
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data"
    Then the header "Content-Language" is "en"
    And the object has no "language" member

  @REQ-MND-05 @REQ-BDY-07 @error @req-233a411a @req-9201dff3
  Scenario: A language member is refused as an undefined top-level member
    Given a publisher given the member "language" as the string "en"
    When the publisher builds the declarations
    Then the publisher refuses and names "language"
    And the refusal names "undefined top-level member"

  @REQ-MND-05 @edge @req-233a411a
  Scenario: No language configured sends no Content-Language header
    Given a valid declaration object
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data"
    Then the header "Content-Language" is not present

  @REQ-MND-05 @edge @req-233a411a
  Scenario: A language configured as an empty string sends no Content-Language header
    Given a valid declaration object
    And the publisher is configured with the language ""
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data"
    Then the header "Content-Language" is not present

  @REQ-MND-06 @golden
  Scenario: A relative methodology-uri is accepted and resolved against the retrieval URI
    Given a valid declaration object
    And the member "methodology-uri" is "/sustainability/methodology"
    When the consumer retrieves it from "https://example.com/.well-known/sustainability-data"
    Then it is valid
    And the resolved "methodology-uri" is "https://example.com/sustainability/methodology"

  @REQ-MND-06 @error
  Scenario: A methodology-uri that is not a string is invalid
    Given a valid declaration object
    And the member "methodology-uri" is the JSON '42'
    When the consumer validates it
    Then it is not valid
    And the errors mention "methodology-uri"

  @REQ-MND-06 @edge
  Scenario Outline: A methodology-uri with a space warns, and a link to a host that is down changes nothing
    Given a valid declaration object
    And the member "methodology-uri" is "<value>"
    When the consumer retrieves and validates it
    Then it is valid
    And <check>
    And no connection is made for "<value>"

    Examples:
      | value                                | check                                          |
      | https://example.com/my method        | the warnings mention "methodology-uri"         |
      | https://down.example/method          | there is no warning mentioning "methodology"   |

  @REQ-MND-07 @golden
  Scenario: The methodology stub carries the five headings and lists the extension names found in the declaration
    Given the create-sustainability-data tool is given the default answers
    And the extension "https://acme.example/esg/extensions/water-and-waste" is '{"water-consumption-m3": 1250}'
    When the create-sustainability-data tool runs
    Then the methodology stub has the five headings
    And the methodology stub lists the extension name "https://acme.example/esg/extensions/water-and-waste"

  @REQ-MND-07 @REQ-PRV-06 @edge
  Scenario: With noise on, the stub states the bound that was applied
    Given the create-sustainability-data tool is given the default answers
    And noise is enabled at 1 percent
    When the create-sustainability-data tool runs
    Then the methodology stub says that perturbation was applied within 1 percent

  @REQ-MND-02 @REQ-PER-01 @edge @rk-mand-5
  Scenario: A bound with a leap second is valid, read as the last second of the minute, and never emitted
    Given a valid declaration object
    And the declaration has period "2016-12-01T00:00:00Z" to "2016-12-31T23:59:60Z"
    When the consumer validates it
    Then it is valid
    And the fetched period is "2016-12-01T00:00:00Z" to "2016-12-31T23:59:59Z"
    And the notes mention "leap-second-read-as-59"
    And the publisher never emits a second of 60

  @REQ-TGT-01 @golden
  Scenario: A non-empty string target is accepted
    Given a valid declaration object
    And the member "target" is "Acme Retail plc"
    When the consumer validates it
    Then it is valid

  @REQ-TGT-01 @error @rk-mand-11
  Scenario Outline: A target that is missing, empty or not a string is invalid
    Given a valid declaration object
    And the member "target" is the JSON '<json>'
    When the consumer validates it
    Then it is not valid
    And the errors mention "target"

    Examples:
      | json     |
      | ""       |
      | 5        |
      | null     |
      | ["a"]    |
      | {}       |

  @REQ-TGT-01 @edge
  Scenario Outline: A one-character target and a target with spaces are accepted
    Given a valid declaration object
    And the member "target" is "<target>"
    When the consumer validates it
    Then it is valid

    Examples:
      | target                  |
      | x                       |
      | Acme Retail plc and sons |

  @REQ-TGT-02 @golden @req-d38c718d @rk-mand-11
  Scenario: A target with a diaeresis is published and read exactly as written
    Given an extended publisher holding the target "Grün GmbH"
    When the publisher builds the declarations
    And the consumer reads them
    Then the target member is byte-identical to "Grün GmbH"
    And the target member is not "Gruen GmbH"
    And the target member is not "Grun GmbH"
    And the publisher's options have no translate or transliterate member

  @REQ-TGT-02 @edge @req-d38c718d @rk-mand-11
  Scenario Outline: A target in another script is neither translated nor transliterated
    Given an extended publisher holding the target "<target>"
    When the publisher builds the declarations
    And the consumer reads them
    Then the target member is byte-identical to "<target>"

    Examples:
      | target              |
      | Пример ООО          |
      | 株式会社サンプル      |
      | شركة المثال          |

  @REQ-TGT-02 @edge @req-d38c718d @rk-mand-11
  Scenario: Precomposed and decomposed forms of a name stay two different targets
    Given an extended publisher holding these periods:
      | label       | start                | end                  | target    |
      | precomposed | 2025-01-01T00:00:00Z | 2026-01-01T00:00:00Z | Grün GmbH |
      | decomposed  | 2025-01-01T00:00:00Z | 2026-01-01T00:00:00Z | Grün GmbH |
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data?target=Gr%C3%BCn%20GmbH"
    Then the body lists the periods precomposed

  @REQ-TGT-03 @golden @req-22b478b8 @rk-mand-11
  Scenario: An internationalized host in A-label form is accepted for an origin
    Given a publisher given the target "xn--grn-ioa.example" with the target-type "origin"
    When the publisher builds the declarations
    Then every published object validates as a declaration

  @REQ-TGT-03 @error @req-22b478b8 @rk-mand-11
  Scenario: An internationalized host in U-label form is refused for an origin
    Given a publisher given the target "grün.example" with the target-type "origin"
    When the publisher builds the declarations
    Then the publisher refuses and names "target"

  @REQ-TGT-03 @edge @req-22b478b8 @rk-mand-11
  Scenario Outline: A host-shaped value of another type warns, and a name that is not host-shaped does not
    Given a publisher given the target "<target>" with the target-type "<type>"
    When the publisher builds the declarations
    Then <outcome>

    Examples:
      | target           | type         | outcome                                                  |
      | grün.example     | service      | the operator was warned about "target"                   |
      | Example.com Ltd  | organization | the operator was not warned about "target"               |

  @REQ-TGT-05 @golden @req-cdc28d84 @rk-mand-11
  Scenario: An origin-wide object defaults its target to the origin host
    Given a publisher for the origin "https://example.com" given no target
    When the publisher builds the declarations
    Then the published member "target" is "example.com"

  @REQ-TGT-05 @error @req-cdc28d84 @rk-mand-11
  Scenario: A path-prefix target without a leading slash is refused by the gate and the consumer, and accepted by the schemas
    Given a valid declaration object with target-type "path" and target "api/v1"
    When the consumer validates it
    Then it is not valid
    And the errors mention "target"
    And the draft CDDL accepts it
    And the repository JTD accepts it
    When the publisher builds it
    Then the publisher refuses and names "target"

  @REQ-TGT-05 @edge @req-cdc28d84 @rk-mand-11
  Scenario Outline: An organization name is used as written, and facility and device targets are free text
    Given a valid declaration object with target-type "<type>" and target "<target>"
    When the consumer validates it
    Then it is valid
    And the member "target" is read back as "<target>"

    Examples:
      | type         | target                    |
      | organization | Acme Retail plc           |
      | facility     | Frankfurt data center 3   |
      | device       | sensor-7f3a               |
      | path         | /api/v1                   |

  @REQ-TGT-06 @golden
  Scenario: The gateway presents a relayed registry subject as a claim of its own origin
    Given the reference gateway is running
    When I send GET "/mozilla.org/.well-known/sustainability-data"
    Then the status is 200
    And the header "Link" contains "terms-of-service"
    When I send GET "/legal"
    Then the notice says the figures for a third-party target are claims of the gateway operator

  @REQ-TGT-06 @error
  Scenario: A page that says the target published the relayed figures fails the legal wording test
    Given the published text "mozilla.org published these figures itself."
    When the legal wording test runs
    Then the test fails
    And the test message mentions "claim"

  @REQ-TGT-06 @edge
  Scenario: A badge for a third-party origin does not say verified
    Given the reference gateway is running
    When I send GET "/badge/thegreenwebfoundation.org.svg"
    Then the status is 200
    And the badge does not contain the words "verified" or "certified"

  @REQ-NUM-03 @golden
  Scenario: A Salesforce Net Zero Cloud export maps onto the scope members and the footprint
    Given a Salesforce Net Zero Cloud export with scope 1, scope 2 and scope 3 emissions
    When the adapter reads it
    Then the adapter yields 1 object
    And the object carries the members "carbon-footprint", "scope-1", "scope-2", "scope-3"

  @REQ-ENG-02 @golden
  Scenario: 2.4 GWh is read as 2400000 kWh
    Given the draft's example "An Organization's Yearly Figures"
    When the consumer validates it
    Then it is valid
    And the energy is 2400000 kWh

  @REQ-ENG-02 @error
  Scenario: A unit change after signing is reported as modified, and the served members stay in use
    Given a valid declaration object with "energy-consumption" 2.4 and "energy-unit" "GWh"
    And the object is signed with Ed25519
    And after signing, the member "energy-consumption" is changed to "2400000"
    And after signing, the member "energy-unit" is changed to "kWh"
    When the consumer verifies the signature
    Then the signature status is "verified"
    And the object is reported as modified after signing
    And the members in use are the ones the origin served, not the payload

  @REQ-ENG-02 @edge @rk-opt-2
  Scenario: An absent energy-unit reads the value as kilowatt-hours
    Given a valid declaration object
    And the member "energy-unit" is removed
    And the member "energy-consumption" is the number 120
    When the consumer validates it
    Then the energy is 120 kWh

  @REQ-CAR-02 @golden @rk-opt-3
  Scenario: 610 tonnes in the yearly example is gross emissions of 610000000 grams
    Given the draft's example "An Organization's Yearly Figures"
    When the consumer validates it
    Then the carbon is 610000000 gCO2e

  @REQ-CAR-02 @REQ-NUM-01 @error @rk-opt-5
  Scenario: A negative carbon-footprint is invalid, so removals are never netted into it
    Given a valid declaration object
    And the member "carbon-footprint" is the number -5
    When the consumer reads it in strict mode
    Then it is not valid
    And the errors mention "carbon-footprint"

  @REQ-CAR-02 @REQ-SCP-02 @edge @req-48bd044c @rk-opt-6
  Scenario: A removals-only organization publishes removals in a scope member, not in carbon-footprint
    Given a valid declaration object
    And the member "carbon-footprint" is the number 300
    And the member "scope-3" is the number -120
    When the consumer reads it in strict mode
    Then it is valid
    And the object's "carbon-footprint" is not negative

  @REQ-SCP-03 @golden @rk-opt-6
  Scenario: The scopes of the yearly example are 90, 220 and 300 tonnes
    Given the draft's example "An Organization's Yearly Figures"
    When the consumer validates it
    Then the scope member "scope-1" is read as 90 tCO2e
    And the scope member "scope-2" is read as 220 tCO2e
    And the scope member "scope-3" is read as 300 tCO2e

  @REQ-SCP-03 @error @rk-opt-6
  Scenario: A scope written in kilograms under carbon-unit tCO2e is read by the unit, never guessed
    Given a valid declaration object
    And the member "carbon-unit" is "tCO2e"
    And the member "scope-1" is the number 90000
    When the consumer validates it
    Then the scope member "scope-1" is read as 90000 tCO2e

  @REQ-SCP-03 @edge @rk-opt-3
  Scenario: An absent carbon-unit reads the three scopes in grams
    Given a valid declaration object
    And the member "carbon-unit" is removed
    And the member "scope-1" is the number 90
    When the consumer validates it
    Then the scope member "scope-1" is read as 90 gCO2e

  @REQ-SCI-02 @golden
  Scenario: A score beside carbon-unit tCO2e is read as grams per functional unit
    Given a valid declaration object with "functional-unit" "per-request" and "sci-score" 0.012
    And the member "carbon-unit" is "tCO2e"
    When the consumer validates it
    Then the sci-score is read as 0.012 gCO2e per "per-request"

  @REQ-SCI-02 @REQ-NUM-01 @error @rk-opt-5
  Scenario: A negative score is invalid whatever the carbon unit says
    Given a valid declaration object with "functional-unit" "per-request" and "sci-score" -0.012
    And the member "carbon-unit" is "tCO2e"
    When the consumer reads it in strict mode
    Then it is not valid
    And the errors mention "sci-score"

  @REQ-SCI-02 @edge
  Scenario Outline: The score is not rescaled by any carbon unit
    Given a valid declaration object with "functional-unit" "per-request" and "sci-score" 0.012
    And the member "carbon-unit" is "<unit>"
    When the consumer validates it
    Then the sci-score is read as 0.012 gCO2e per "per-request"

    Examples:
      | unit   |
      | gCO2e  |
      | kgCO2e |
      | tCO2e  |

  @REQ-DRV-01 @golden
  Scenario: A carbon intensity of 175 g per kWh is not rescaled by energy-unit or carbon-unit
    Given a valid declaration object
    And the member "energy-unit" is "GWh"
    And the member "carbon-unit" is "tCO2e"
    And the member "carbon-intensity-gCO2e-per-kWh" is the number 175
    When the consumer validates it
    Then the carbon intensity is read as 175 gCO2e per kWh

  @REQ-DRV-01 @REQ-NUM-01 @error @rk-opt-5
  Scenario: A negative carbon intensity is invalid
    Given a valid declaration object
    And the member "carbon-intensity-gCO2e-per-kWh" is the number -175
    When the consumer reads it in strict mode
    Then it is not valid
    And the errors mention "carbon-intensity-gCO2e-per-kWh"

  @REQ-DRV-01 @edge
  Scenario: The ratio of carbon to energy equals the intensity within rounding
    Given a valid declaration object
    And the member "energy-consumption" is the number 2.4
    And the member "energy-unit" is "GWh"
    And the member "carbon-footprint" is the number 420
    And the member "carbon-unit" is "tCO2e"
    And the member "carbon-intensity-gCO2e-per-kWh" is the number 175
    When the consumer validates it
    Then the ratio of the carbon to the energy equals the intensity within rounding

  @REQ-DRV-02 @golden
  Scenario: One day of 3200 grams is annualized to 1168 kilograms
    Given a valid declaration object
    And the declaration has period "2026-03-20T00:00:00Z" to "2026-03-21T00:00:00Z"
    And the member "carbon-footprint" is the number 3200
    And the member "carbon-unit" is "gCO2e"
    And the member "estimated-annual-emissions-kgCO2e" is the number 1168
    When the consumer validates it
    Then the annualized emissions are read as 1168 kgCO2e

  @REQ-DRV-02 @REQ-NUM-01 @error @rk-opt-5
  Scenario: A negative annualized figure is invalid
    Given a valid declaration object
    And the member "estimated-annual-emissions-kgCO2e" is the number -1168
    When the consumer reads it in strict mode
    Then it is not valid
    And the errors mention "estimated-annual-emissions-kgCO2e"

  @REQ-DRV-02 @edge
  Scenario: The annualized figure is not rescaled by carbon-unit
    Given a valid declaration object
    And the member "carbon-unit" is "tCO2e"
    And the member "estimated-annual-emissions-kgCO2e" is the number 1168
    When the consumer validates it
    Then the annualized emissions are read as 1168 kgCO2e

  @REQ-LNK-01 @golden @req-7146a36d @rk-opt-10
  Scenario: One attestation link is accepted
    Given a valid declaration object
    And the member "verifiable-attestation-uri" is "https://verify.example/vc/42"
    When the consumer validates it
    Then it is valid

  @REQ-LNK-01 @error @req-7146a36d @rk-opt-10
  Scenario Outline: An attestation link that is not one string is invalid
    Given a valid declaration object
    And the member "verifiable-attestation-uri" is the JSON '<json>'
    When the consumer validates it
    Then it is not valid
    And the errors mention "verifiable-attestation-uri"

    Examples:
      | json                                                       |
      | ["https://verify.example/vc/42"]                           |
      | ["https://verify.example/vc/42", "https://verify.example/vc/43"] |
      | []                                                         |

  @REQ-LNK-01 @edge @req-7146a36d @rk-opt-10
  Scenario: Further attestations are reached through the disclosure link while the object carries one
    Given a valid declaration object
    And the member "verifiable-attestation-uri" is "https://verify.example/vc/42"
    And the member "disclosure-uri" is "https://storage.example/disclosures"
    When the consumer validates it
    Then it is valid
    And exactly one attestation URI is read

  @REQ-LNK-02 @golden
  Scenario Outline: A disclosure index is returned with its media type, whatever its format
    Given a valid declaration object
    And the member "disclosure-uri" is "/esg/disclosures"
    And a local server that answers "/esg/disclosures" with "<media type>" and status 200
    When the consumer retrieves the disclosure index
    Then the disclosure index is returned with the media type "<media type>"

    Examples:
      | media type       |
      | application/json |
      | text/html        |

  @REQ-LNK-02 @error
  Scenario: A disclosure index that answers 404 returns that failure and does not invalidate the declaration
    Given a valid declaration object
    And the member "disclosure-uri" is "/esg/disclosures"
    And a local server that answers "/esg/disclosures" with "text/html" and status 404
    When the consumer retrieves the disclosure index
    Then the disclosure index failure is status 404
    And the object is still valid

  @REQ-LNK-02 @edge
  Scenario: A relative disclosure-uri is resolved against the retrieval URI and retrieved only on request
    Given a valid declaration object
    And the member "disclosure-uri" is "../esg/disclosures"
    When the consumer retrieves it from "https://example.com/.well-known/sustainability-data"
    Then the resolved "disclosure-uri" is "https://example.com/esg/disclosures"
    And no connection is made for "https://example.com/esg/disclosures"

  @REQ-MIN-02 @golden @rk-opt-5
  Scenario: A metric that is not reported is left out
    Given a publisher given the calendar month "2026-09" with the offset "Z"
    And the publisher is given the number 12 for "carbon-footprint" and nothing for "energy-consumption"
    When the publisher builds the declarations
    Then the published object has no member "energy-consumption"

  @REQ-MIN-02 @error @rk-opt-5
  Scenario Outline: No in-band value stands for not reported
    Given a valid declaration object
    And the member "energy-consumption" is the JSON '<json>'
    When the consumer reads it in strict mode
    Then it is not valid
    And the errors mention "energy-consumption"

    Examples:
      | json   |
      | null   |
      | -1     |
      | "n/a"  |
      | ""     |

  @REQ-MIN-02 @edge @rk-opt-5
  Scenario: A reported value of zero is kept and never treated as not reported
    Given a valid declaration object
    And the member "energy-consumption" is the number 0
    When the consumer reads it in strict mode
    Then it is valid
    And the member "energy-consumption" is not reported as missing

  @REQ-FRM-03 @golden
  Scenario: Unknown members at the top level, in period and in an upstream entry validate under the schemas
    Given a valid declaration object
    And the member "carbon-offsets-planned" is the number 12
    And the upstream member names "https://cloud.example/tenants/acme.json" with role "cloud"
    And the period and the upstream entry each carry an unknown member
    When the consumer validates it
    Then it is valid
    And the draft CDDL accepts it
    And the repository JTD accepts it

  @REQ-FRM-03 @REQ-BDY-07 @error @req-9201dff3
  Scenario: An undefined top-level member passes the schemas and is refused by the publisher gate
    Given a valid declaration object
    And the member "carbon-offsets-planned" is the number 12
    Then the draft CDDL accepts it
    And the repository JTD accepts it
    When the publisher gate checks it
    Then the publisher refuses and names "carbon-offsets-planned"

  @REQ-FRM-03 @edge
  Scenario: An unknown member nested inside an extension value is accepted
    Given a valid declaration object
    And the extension "https://acme.example/ext" is '{"nested": {"unknown": [1, 2, 3]}}'
    When the consumer validates it
    Then it is valid
    And the draft CDDL accepts it

  @REQ-EXM-01 @golden
  Scenario: The yearly example declares a cloud upstream and two extensions
    Given the draft's example "An Organization's Yearly Figures"
    When the consumer retrieves and validates it
    Then it is valid
    And the fetched upstream entry has role "cloud"
    And the extension "https://acme.example/esg/extensions/water-and-waste" is accepted
    And the extension name "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845" is accepted

  @REQ-EXM-01 @error
  Scenario: The Introduction example with one byte changed fails the verbatim check
    Given the repository copy of the draft's Introduction example with one byte changed
    When the verbatim check runs
    Then the check fails

  @REQ-EXM-01 @edge
  Scenario: The gateway examples are a byte-identical copy of the example responses
    When the verbatim check runs
    Then every file of "gateway/examples" is byte-identical to the file of the same name in "example-responses"

  @REQ-EXM-02 @golden @rk-qry-6
  Scenario: A monthly query on a publisher that holds a year and its months returns the months only
    Given an extended publisher holding these periods:
      | label   | start                | end                  | target      |
      | 2025    | 2025-01-01T00:00:00Z | 2026-01-01T00:00:00Z | example.com |
      | 2025-01 | 2025-01-01T00:00:00Z | 2025-02-01T00:00:00Z | example.com |
      | 2025-02 | 2025-02-01T00:00:00Z | 2025-03-01T00:00:00Z | example.com |
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data?start=2025-01-01T00:00:00Z&end=2026-01-01T00:00:00Z&granularity=monthly"
    Then the body lists the periods 2025-01, 2025-02

  @REQ-EXM-02 @golden @rk-qry-7
  Scenario: The same query without granularity also returns the year object
    Given an extended publisher holding these periods:
      | label   | start                | end                  | target      |
      | 2025    | 2025-01-01T00:00:00Z | 2026-01-01T00:00:00Z | example.com |
      | 2025-01 | 2025-01-01T00:00:00Z | 2025-02-01T00:00:00Z | example.com |
      | 2025-02 | 2025-02-01T00:00:00Z | 2025-03-01T00:00:00Z | example.com |
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data?start=2025-01-01T00:00:00Z&end=2026-01-01T00:00:00Z"
    Then the body lists the periods 2025-01, 2025, 2025-02

  @REQ-EXM-02 @error @rk-qry-7
  Scenario: The same request on a publisher that holds only 2026 returns an empty array
    Given an extended publisher holding these periods:
      | label   | start                | end                  | target      |
      | 2026-01 | 2026-01-01T00:00:00Z | 2026-02-01T00:00:00Z | example.com |
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data?start=2025-01-01T00:00:00Z&end=2026-01-01T00:00:00Z&granularity=monthly"
    Then the status is 200
    And the body is a JSON array of 0 objects

  @REQ-EXM-02 @edge @rk-qry-7
  Scenario: January and the year share a start, and the shorter end comes first
    Given an extended publisher holding these periods:
      | label   | start                | end                  | target      |
      | 2025    | 2025-01-01T00:00:00Z | 2026-01-01T00:00:00Z | example.com |
      | 2025-01 | 2025-01-01T00:00:00Z | 2025-02-01T00:00:00Z | example.com |
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data?start=2025-01-01T00:00:00Z&end=2025-01-02T00:00:00Z"
    Then the body lists the periods 2025-01, 2025

  @REQ-EXM-03 @golden @rk-qry-5
  Scenario: A request for the path prefix returns the second object alone
    Given the draft's example "An Origin and One of Its Services"
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data?target=/api/v1"
    Then the body is a JSON array of 1 objects
    And the object's "target" is "/api/v1"

  @REQ-EXM-03 @error @rk-qry-5
  Scenario: A request for a shorter prefix returns an empty array
    Given the draft's example "An Origin and One of Its Services"
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data?target=/api"
    Then the status is 200
    And the body is a JSON array of 0 objects

  @REQ-EXM-03 @edge @rk-mand-8
  Scenario: The month with +08:00 bounds is a whole calendar month
    Given the draft's example "An Origin and One of Its Services"
    When the consumer validates it
    Then the period is classified as "monthly"

  @REQ-EXM-04 @golden @rk-qry-5
  Scenario: The signed example is returned as a one-object array whose signature verifies
    Given the draft's example "A Signed Declaration with Scopes and an Attestation" signed with Ed25519
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data?target=/app/storage&start=2026-03-20T00:00:00Z&end=2026-03-21T00:00:00Z"
    Then the body is a JSON array of 1 objects
    And the object's "measurement-method" is "hardware-estimated"
    When the consumer verifies the signature
    Then the signature status is "verified"

  @REQ-EXM-04 @error @rk-qry-5
  Scenario: The same target for another day returns an empty array
    Given the draft's example "A Signed Declaration with Scopes and an Attestation" signed with Ed25519
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data?target=/app/storage&start=2026-03-21T00:00:00Z&end=2026-03-22T00:00:00Z"
    Then the body is a JSON array of 0 objects

  @REQ-EXM-04 @edge @rk-mand-4
  Scenario: The emission factor does not change the measurement-method token
    Given the draft's example "A Signed Declaration with Scopes and an Attestation" signed with Ed25519
    When the consumer validates it
    Then the object's "measurement-method" is "hardware-estimated"
    And the object's "scope-3" is "1.1"

  @REQ-ORG-01 @golden
  Scenario: The gateway describes the figures of a service as the publisher's allocation
    Given the reference gateway is running
    When I send GET "/index.json"
    Then the index entry for "service.example" says the figures are the publisher's allocation by the method the methodology document describes

  @REQ-ORG-01 @error
  Scenario: A page that presents the path object as the path's own measurement fails the legal wording test
    Given the published text "The path /api/v1 was measured on its own."
    When the legal wording test runs
    Then the test fails
    And the test message mentions "allocation"

  @REQ-ORG-01 @edge
  Scenario Outline: A device and a product carry the same allocation label
    Given the reference gateway is running
    When I send GET "/index.json"
    Then the index entry for "<subject>" says the figures are the publisher's allocation by the method the methodology document describes

    Examples:
      | subject         |
      | device.example  |
      | product.example |

  @REQ-ORG-02 @golden @rk-agg-2
  Scenario: A path of 8.6 kg beside an origin of 12.7 kg raises no error and no warning
    Given the draft's example "An Origin and One of Its Services"
    When the consumer validates it
    Then it is valid
    And there is no warning mentioning "add up"
    And no object is reported as modified

  @REQ-ORG-02 @UC-5.4 @error @rk-agg-2
  Scenario: A total over the whole and a part is refused while the comparison itself raises nothing
    Given the draft's example "An Origin and One of Its Services"
    When the consumer validates it
    Then there is no warning mentioning "add up"
    When the consumer totals the array
    Then the total is refused

  @REQ-ORG-02 @edge @rk-agg-2
  Scenario: Parts that sum to 140 percent of the whole are accepted silently
    Given the declaration is an array of three objects:
      | target      | period                                    | energy-consumption |
      | example.com | 2025-01-01T00:00:00Z/2026-01-01T00:00:00Z | 100                |
      | /api/v1     | 2025-01-01T00:00:00Z/2026-01-01T00:00:00Z | 70                 |
      | /app        | 2025-01-01T00:00:00Z/2026-01-01T00:00:00Z | 70                 |
    When the consumer validates it
    Then it is valid
    And there are no warnings

  @REQ-TOT-01 @golden @rk-agg-1
  Scenario: A figure is shown with the period its two bounds name
    Given a valid declaration object
    When the consumer retrieves and validates it
    Then the presentation says the figures cover "2025-01-01T00:00:00Z" to "2026-01-01T00:00:00Z"

  @REQ-TOT-01 @error @rk-agg-1
  Scenario: A figure for 2025 is never shown as covering 2026
    Given a valid declaration object
    When the consumer retrieves and validates it
    Then the presentation does not say the figures cover "2026-01-01T00:00:00Z" to "2027-01-01T00:00:00Z"

  @REQ-TOT-01 @edge @rk-agg-1
  Scenario: A twelve-hour period is shown with both bounds
    Given a valid declaration object
    And the declaration has period "2026-10-23T00:00:00Z" to "2026-10-23T12:00:00Z"
    When the consumer retrieves and validates it
    Then the presentation says the figures cover "2026-10-23T00:00:00Z" to "2026-10-23T12:00:00Z"
