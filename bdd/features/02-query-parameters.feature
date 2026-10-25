Feature: Query parameters
  A server may honour target, start, end and granularity. It returns the objects it holds that satisfy every
  parameter it honours, as an array in ascending order of period.start, and computes nothing. A value outside the
  profile is ignored. Draft -10, "Query Parameters".

  Background:
    Given the clock is fixed at "2026-10-24T12:00:00Z"
    And an extended publisher holding these periods:
      | label     | start                | end                  | target      |
      | 2025      | 2025-01-01T00:00:00Z | 2026-01-01T00:00:00Z | example.com |
      | 2025-01   | 2025-01-01T00:00:00Z | 2025-02-01T00:00:00Z | example.com |
      | 2025-02   | 2025-02-01T00:00:00Z | 2025-03-01T00:00:00Z | example.com |
      | 2025-03   | 2025-03-01T00:00:00Z | 2025-04-01T00:00:00Z | example.com |
      | 2025-01-05| 2025-01-05T00:00:00Z | 2025-01-06T00:00:00Z | example.com |
      | api-2025-03 | 2025-03-01T00:00:00Z | 2025-04-01T00:00:00Z | /api/v1   |
    And the publisher is served on a local port

  @REQ-QRY-09 @REQ-QRY-10 @UC-2.2 @rk-qry-7 @golden @req-6c3122f6
  Scenario: The monthly objects of a year come back as an array in order
    When I send GET "/.well-known/sustainability-data?target=example.com&start=2025-01-01T00:00:00Z&end=2025-04-01T00:00:00Z&granularity=monthly"
    Then the status is 200
    And the body is a JSON array
    And the body lists the periods 2025-01, 2025-02, 2025-03
    And the body validates as a declaration

  @REQ-QRY-12 @UC-2.2 @rk-qry-4 @golden @req-6c3122f6
  Scenario Outline: An object is returned when its period overlaps the half-open range
    When I send GET "/.well-known/sustainability-data?granularity=monthly&target=example.com&<query>"
    Then the status is 200
    And the body lists the periods <periods>

    Examples: boundaries (end excluded, start of the next period excluded, one second more includes)
      | query                                                         | periods                |
      | start=2025-02-01T00:00:00Z&end=2025-03-01T00:00:00Z           | 2025-02                |
      | start=2025-01-31T23:59:59Z&end=2025-03-01T00:00:00Z           | 2025-01, 2025-02       |
      | start=2025-02-01T00:00:00Z&end=2025-03-01T00:00:01Z           | 2025-02, 2025-03       |
      | start=2025-01-15T00:00:00Z&end=2025-02-15T00:00:00Z           | 2025-01, 2025-02       |
      | start=2025-02-10T00:00:00Z&end=2025-02-11T00:00:00Z           | 2025-02                |
      | start=2025-04-01T00:00:00Z&end=2025-05-01T00:00:00Z           |                        |

  @REQ-QRY-13 @UC-2.2 @rk-qry-4 @golden @req-6c3122f6
  Scenario Outline: An absent bound is unbounded
    When I send GET "/.well-known/sustainability-data?granularity=monthly&target=example.com&<query>"
    Then the body lists the periods <periods>

    Examples:
      | query                                | periods                  |
      | start=2025-02-01T00:00:00Z           | 2025-02, 2025-03         |
      | end=2025-02-01T00:00:00Z             | 2025-01                  |
      | start=2025-03-01T00:00:00Z           | 2025-03                  |
      | end=2025-01-01T00:00:00Z             |                          |

  @REQ-QRY-12 @REQ-QRY-16 @UC-2.2 @rk-qry-4 @rk-qry-7 @golden @req-6c3122f6
  Scenario: A year and its months are all returned when no granularity narrows them, none merged
    When I send GET "/.well-known/sustainability-data?target=example.com&start=2025-02-10T00:00:00Z&end=2025-02-11T00:00:00Z"
    Then the body lists the periods 2025, 2025-02
    And the object "2025" is exactly the object the publisher holds

  @REQ-QRY-12 @rk-qry-4 @edge @req-6c3122f6
  Scenario: Fractional seconds in a UTC bound are honoured
    When I send GET "/.well-known/sustainability-data?target=example.com&granularity=monthly&start=2025-02-01T00:00:00.000Z&end=2025-03-01T00:00:00.000Z"
    Then the body lists the periods 2025-02

  @REQ-QRY-03 @rk-qry-3 @edge
  Scenario: A percent-encoded colon decodes to a value that matches the profile
    When I send GET "/.well-known/sustainability-data?target=example.com&granularity=monthly&start=2025-02-01T00%3A00%3A00Z&end=2025-03-01T00%3A00%3A00Z"
    Then the body lists the periods 2025-02

  @REQ-QRY-03 @REQ-QRY-07 @UC-2.2 @rk-qry-2 @error @req-ee318dc3
  Scenario Outline: A start or end that does not match the profile, or names no real date and time, is ignored, never read as another value
    When I send GET "/.well-known/sustainability-data?target=example.com&granularity=monthly&start=<value>&end=2025-03-01T00:00:00Z"
    Then the status is 200
    And the body lists the periods 2025-01, 2025-02

    Examples: start is ignored, so only end bounds the range
      | value                         |
      | 2025-02-01                    |
      | 2025-02-01T00:00:00           |
      | 2025-02-01t00:00:00z          |
      | 2025-02-01T00:00:00z          |
      | 2025-02-01 00:00:00Z          |
      | 2025-02-01T00:00:00+00:00     |
      | 2025-02-01T00:00:00+01:00     |
      | 2025-02-01T00:00Z             |
      | 2025-02-01T00:00:00Zjunk      |
      | junkT2025-02-01T00:00:00Z     |
      | 2025-02-30T00:00:00Z          |
      | 2025-13-01T00:00:00Z          |
      | 2025-02-01T25:00:00Z          |
      | 1738368000                    |
      |                               |

  @impl @REQ-QRY-07 @rk-qry-2 @edge @req-ee318dc3
  Scenario: A real leap second bound is ignored, because it cannot be read without reading it as 23:59:59
    When I send GET "/.well-known/sustainability-data?target=example.com&granularity=monthly&start=2016-12-31T23:59:60Z&end=2025-03-01T00:00:00Z"
    Then the status is 200
    And the body lists the periods 2025-01, 2025-02

  @impl @REQ-QRY-19 @rk-qry-2 @edge @req-6c3122f6
  Scenario: A request whose only parameter is a real leap second is answered as a request without parameters
    When I send GET "/.well-known/sustainability-data?start=2016-12-31T23:59:60Z"
    Then the status is 200
    And the body is the same as for GET "/.well-known/sustainability-data"

  @REQ-QRY-07 @rk-qry-2 @rk-qry-3 @edge @req-ee318dc3
  Scenario: A positive offset written with a literal plus is a space after form decoding and is ignored
    When I send GET "/.well-known/sustainability-data?target=example.com&granularity=monthly&start=2025-02-01T00:00:00+01:00"
    Then the status is 200
    And the body lists the periods 2025-01, 2025-02, 2025-03

  @REQ-QRY-07 @rk-qry-2 @edge @req-ee318dc3
  Scenario: One bad parameter does not spoil the others
    When I send GET "/.well-known/sustainability-data?start=2025-02-01&end=2025-03-01T00:00:00Z&granularity=monthly&target=example.com"
    Then the body lists the periods 2025-01, 2025-02

  @REQ-QRY-07 @rk-qry-2 @edge @req-ee318dc3
  Scenario: A repeated parameter is ignored in every occurrence and is not an error
    When I send GET "/.well-known/sustainability-data?target=example.com&granularity=monthly&start=2025-02-01T00:00:00Z&start=2025-03-01T00:00:00Z"
    Then the status is 200
    And the body lists the periods 2025-01, 2025-02, 2025-03

  @REQ-QRY-05 @REQ-QRY-07 @REQ-QRY-19 @rk-qry-1 @rk-qry-2 @error @req-6c3122f6 @req-ee318dc3
  Scenario Outline: A query the server cannot honour is never answered with an error
    When I send GET "/.well-known/sustainability-data?<query>"
    Then the status is 200
    And the body is a JSON array

    Examples:
      | query                                                    |
      | start=%                                                  |
      | start=%ZZ&end=%00                                        |
      | granularity=                                             |
      | period=2025&granularity=monthly                          |
      | start=2025-02-30T00:00:00Z&end=2025-02-31T00:00:00Z      |
      | start&end&granularity&target                             |
      | start=2025-03-01T00:00:00Z&end=2025-02-01T00:00:00Z      |
      | &&&=&=x                                                  |
      | extra=1&granularity=monthly                              |
      | Start=2025-02-01T00:00:00Z&GRANULARITY=monthly           |

  @REQ-QRY-04 @REQ-QRY-07 @rk-qry-2 @error @req-ee318dc3
  Scenario Outline: A granularity outside the three, in any case, is ignored
    When I send GET "/.well-known/sustainability-data?target=example.com&start=2025-01-01T00:00:00Z&end=2025-02-01T00:00:00Z&granularity=<value>"
    Then the status is 200
    And the body lists the periods 2025-01, 2025, 2025-01-05

    Examples:
      | value     |
      | Monthly   |
      | MONTHLY   |
      | hourly    |
      | weekly    |
      | quarterly |
      | month     |
      | monthly,daily |

  @REQ-QRY-12 @UC-2.2 @rk-qry-4 @edge @req-6c3122f6
  Scenario: An inverted range selects only objects that straddle both bounds, and is not an error
    # The sentence as written: period.start before end and period.end after start. The year 2025 starts before 1 February and ends after 1 March, so it is selected; no month is.
    Given an extended publisher holding these periods:
      | label   | start                | end                  | target      |
      | 2025-01 | 2025-01-01T00:00:00Z | 2025-02-01T00:00:00Z | example.com |
      | 2025-02 | 2025-02-01T00:00:00Z | 2025-03-01T00:00:00Z | example.com |
      | 2025-03 | 2025-03-01T00:00:00Z | 2025-04-01T00:00:00Z | example.com |
    When I send GET "/.well-known/sustainability-data?target=example.com&start=2025-03-01T00:00:00Z&end=2025-02-01T00:00:00Z"
    Then the status is 200
    And the body lists no periods
    Given an extended publisher holding these periods:
      | label   | start                | end                  | target      |
      | 2025    | 2025-01-01T00:00:00Z | 2026-01-01T00:00:00Z | example.com |
      | 2025-01 | 2025-01-01T00:00:00Z | 2025-02-01T00:00:00Z | example.com |
      | 2025-02 | 2025-02-01T00:00:00Z | 2025-03-01T00:00:00Z | example.com |
      | 2025-03 | 2025-03-01T00:00:00Z | 2025-04-01T00:00:00Z | example.com |
    When I send GET "/.well-known/sustainability-data?target=example.com&start=2025-03-01T00:00:00Z&end=2025-02-01T00:00:00Z"
    Then the status is 200
    And the body lists the periods 2025

  @REQ-QRY-14 @REQ-TGT-04 @UC-3.2 @rk-qry-5 @rk-mand-11 @golden @req-22b478b8 @req-e6268aef
  Scenario Outline: target selects by exact match
    When I send GET "/.well-known/sustainability-data?target=<target>&granularity=monthly&start=2025-03-01T00:00:00Z&end=2025-04-01T00:00:00Z"
    Then the body lists the periods <periods>

    Examples:
      | target              | periods     |
      | example.com         | 2025-03     |
      | /api/v1             | api-2025-03 |
      | %2Fapi%2Fv1         | api-2025-03 |
      | /api                |             |
      | /api/v1/users       |             |
      | /api/v1/            |             |
      | api/v1              |             |
      | Example.com         | 2025-03     |
      | EXAMPLE.COM         | 2025-03     |
      | example.org         |             |

  @REQ-QRY-14 @REQ-TGT-04 @rk-qry-5 @rk-mand-11 @edge @req-22b478b8 @req-e6268aef
  Scenario: A host target is compared case-insensitively, a path target as a string
    Given an extended publisher holding these periods:
      | label | start                | end                  | target      |
      | host  | 2025-01-01T00:00:00Z | 2026-01-01T00:00:00Z | example.com |
      | path  | 2025-01-01T00:00:00Z | 2026-01-01T00:00:00Z | /API/v1     |
    When I send GET "/.well-known/sustainability-data?target=%2Fapi%2Fv1"
    Then the body lists no periods
    When I send GET "/.well-known/sustainability-data?target=%2FAPI%2Fv1"
    Then the body lists the periods path
    When I send GET "/.well-known/sustainability-data?target=EXAMPLE.com"
    Then the body lists the periods host

  @REQ-QRY-14 @REQ-TGT-04 @rk-qry-5 @rk-mand-11 @edge @req-22b478b8 @req-e6268aef
  Scenario: An organization name with spaces and non-ASCII letters is matched as a string, unnormalized
    Given an extended publisher holding these periods:
      | label | start                | end                  | target        |
      | org   | 2025-01-01T00:00:00Z | 2026-01-01T00:00:00Z | Acme Retail plc |
      | uml   | 2025-01-01T00:00:00Z | 2026-01-01T00:00:00Z | Grün GmbH     |
    When I send GET "/.well-known/sustainability-data?target=Acme%20Retail%20plc"
    Then the body lists the periods org
    When I send GET "/.well-known/sustainability-data?target=Gr%C3%BCn%20GmbH"
    Then the body lists the periods uml
    When I send GET "/.well-known/sustainability-data?target=Gru%CC%88n%20GmbH"
    Then the body lists no periods

  @REQ-QRY-15 @UC-2.2 @rk-qry-6 @golden @req-e6268aef
  Scenario Outline: granularity selects whole calendar years, months or days
    When I send GET "/.well-known/sustainability-data?target=example.com&granularity=<granularity>"
    Then the body lists the periods <periods>

    Examples:
      | granularity | periods                                  |
      | yearly      | 2025                                     |
      | monthly     | 2025-01, 2025-02, 2025-03                |
      | daily       | 2025-01-05                               |

  @REQ-QRY-15 @REQ-PER-05 @rk-qry-6 @rk-mand-9 @edge @req-e6268aef
  Scenario Outline: granularity reads each bound in its own offset
    Given an extended publisher holding these periods:
      | label     | start                     | end                       | target      |
      | sg-month  | 2026-03-01T00:00:00+08:00 | 2026-04-01T00:00:00+08:00 | example.com |
      | de-march  | 2025-03-01T00:00:00+01:00 | 2025-04-01T00:00:00+02:00 | example.com |
      | de-day-23 | 2025-03-30T00:00:00+01:00 | 2025-03-31T00:00:00+02:00 | example.com |
      | quarter   | 2025-01-01T00:00:00Z      | 2025-04-01T00:00:00Z      | example.com |
      | fiscal    | 2025-04-01T00:00:00Z      | 2026-04-01T00:00:00Z      | example.com |
      | shifted   | 2025-01-01T01:00:00Z      | 2025-02-01T01:00:00Z      | example.com |
    When I send GET "/.well-known/sustainability-data?granularity=<granularity>"
    Then the body lists the periods <periods>

    Examples:
      | granularity | periods                         |
      | monthly     | de-march, sg-month              |
      | daily       | de-day-23                       |
      | yearly      |                                 |

  @REQ-QRY-09 @rk-qry-4 @rk-qry-5 @rk-qry-6 @golden @req-6c3122f6
  Scenario: Every honoured parameter must be satisfied together
    When I send GET "/.well-known/sustainability-data?target=/api/v1&granularity=monthly&start=2025-01-01T00:00:00Z&end=2025-03-01T00:00:00Z"
    Then the body lists no periods
    When I send GET "/.well-known/sustainability-data?target=/api/v1&granularity=monthly&start=2025-01-01T00:00:00Z&end=2025-04-01T00:00:00Z"
    Then the body lists the periods api-2025-03

  @REQ-QRY-01 @REQ-QRY-02 @rk-qry-1 @edge @req-227b9272 @req-969238cd
  Scenario Outline: A server that honours only some parameters ignores the others
    Given an extended publisher that honours only "<honoured>"
    When I send GET "/.well-known/sustainability-data?target=/api/v1&start=2025-03-01T00:00:00Z&end=2025-04-01T00:00:00Z&granularity=yearly"
    Then the status is 200
    And the body lists the periods <periods>

    Examples:
      | honoured    | periods                                  |
      | target      | api-2025-03                              |
      | granularity | 2025                                     |
      | start,end   | 2025, api-2025-03, 2025-03               |

  @REQ-QRY-11 @UC-2.2 @rk-body-2 @rk-qry-7 @golden @req-6c3122f6
  Scenario: A query that selects nothing is an empty array, not 404
    When I send GET "/.well-known/sustainability-data?target=nothing.example"
    Then the status is 200
    And the header "Content-Type" is "application/sustainability-data+json"
    And the body is a JSON array of 0 objects
    And the body validates as a declaration

  @REQ-QRY-11 @rk-body-2 @edge @req-6c3122f6
  Scenario: A range with no data and a target with no data give the same answer
    When I send GET "/.well-known/sustainability-data?target=nothing.example"
    And I send GET "/.well-known/sustainability-data?start=1999-01-01T00:00:00Z&end=2000-01-01T00:00:00Z"
    Then the two bodies are identical

  @REQ-QRY-10 @UC-2.2 @rk-qry-7 @golden @req-6c3122f6
  Scenario: Objects come back in ascending order of period.start whatever the order held
    Given an extended publisher holding these periods in this order:
      | label | start                | end                  | target      |
      | mar   | 2025-03-01T00:00:00Z | 2025-04-01T00:00:00Z | example.com |
      | jan   | 2025-01-01T00:00:00Z | 2025-02-01T00:00:00Z | example.com |
      | feb   | 2025-02-01T00:00:00Z | 2025-03-01T00:00:00Z | example.com |
    When I send GET "/.well-known/sustainability-data?granularity=monthly"
    Then the body lists the periods jan, feb, mar

  @REQ-QRY-10 @REQ-QRY-19 @rk-qry-7 @edge @req-6c3122f6
  Scenario: Order is by the instant of period.start, not by the text
    Given an extended publisher holding these periods in this order:
      | label  | start                     | end                       | target      |
      | utc    | 2025-01-01T00:00:00Z      | 2025-01-02T00:00:00Z      | example.com |
      | east   | 2025-01-01T05:00:00+08:00 | 2025-01-02T05:00:00+08:00 | example.com |
      | west   | 2024-12-31T20:00:00-05:00 | 2025-01-01T20:00:00-05:00 | example.com |
    When I send GET "/.well-known/sustainability-data"
    Then the body lists the periods east, utc, west

  @impl @REQ-QRY-10 @REQ-QRY-19 @rk-qry-7 @edge @req-6c3122f6
  Scenario: Two objects that start at the same instant keep a stable order: end, then target
    Given an extended publisher holding these periods in this order:
      | label  | start                | end                  | target      |
      | b-year | 2025-01-01T00:00:00Z | 2026-01-01T00:00:00Z | /b          |
      | a-year | 2025-01-01T00:00:00Z | 2026-01-01T00:00:00Z | /a          |
      | month  | 2025-01-01T00:00:00Z | 2025-02-01T00:00:00Z | /b          |
    When I send GET "/.well-known/sustainability-data"
    Then the body lists the periods month, a-year, b-year

  @REQ-QRY-16 @rk-qry-7 @golden
  Scenario: Objects are returned as held, byte for byte, signatures included
    Given every held object is signed with Ed25519
    When I send GET "/.well-known/sustainability-data?target=example.com&granularity=monthly"
    Then every object is identical to the held object of the same label
    And every signature status is "verified"

  @REQ-QRY-16 @rk-qry-7 @edge
  Scenario: A range that covers part of a held object returns it whole, never a clipped copy
    When I send GET "/.well-known/sustainability-data?target=example.com&granularity=yearly&start=2025-06-01T00:00:00Z&end=2025-07-01T00:00:00Z"
    Then the body lists the periods 2025
    And the object's period is "2025-01-01T00:00:00Z" to "2026-01-01T00:00:00Z"

  @REQ-QRY-16 @rk-qry-7 @rk-qry-6 @edge
  Scenario: Months that sum to a year are never merged into a year
    Given an extended publisher holding these periods:
      | label | start                | end                  | target      |
      | m1    | 2025-01-01T00:00:00Z | 2025-02-01T00:00:00Z | example.com |
      | m2    | 2025-02-01T00:00:00Z | 2025-03-01T00:00:00Z | example.com |
    When I send GET "/.well-known/sustainability-data?granularity=yearly&start=2025-01-01T00:00:00Z&end=2026-01-01T00:00:00Z"
    Then the body lists no periods

  @REQ-SEC-07 @UC-7.1 @edge
  Scenario: The reference gateway never returns more than it holds
    Given the reference gateway is running
    When I send GET "/.well-known/sustainability-data?start=2000-01-01T00:00:00Z&end=2100-01-01T00:00:00Z&granularity=daily"
    Then the status is 200
    And the body has at most 200 objects
    And the body validates as a declaration

  @REQ-QRY-09 @UC-7.1 @rk-qry-4 @rk-qry-6 @golden @req-6c3122f6
  Scenario: The reference gateway answers a monthly query with valid -10 objects
    Given the reference gateway is running
    # At the gateway clock (2026-10-17T12:00:00Z) August and September 2026 are the two complete months held.
    When I send GET "/.well-known/sustainability-data?start=2026-08-01T00:00:00Z&end=2026-10-01T00:00:00Z&granularity=monthly"
    Then the status is 200
    And the body is a JSON array of 2 objects
    And every object's "period" has date-time bounds
    And the body is in ascending period order without overlap
    And the body validates as a declaration

  @REQ-QRY-06 @UC-5.2 @rk-qry-3 @golden
  Scenario: The consumer sends only UTC values and converts a local bound first
    Given a basic publisher with one entry for "2026-01"
    And the publisher is served on a local port
    When the consumer fetches the local origin asking for start "2026-03-01T00:00:00+08:00" and end "2026-04-01T00:00:00+08:00"
    Then the request carried "start=2026-02-28T16:00:00Z"
    And the request carried "end=2026-03-31T16:00:00Z"
    And the request carried no "+" character in its query

  @REQ-QRY-06 @UC-5.2 @error
  Scenario Outline: The consumer refuses to send a bound that is not a date-time
    When the consumer builds a request asking for start "<value>"
    Then the consumer refuses with a message mentioning "date-time"

    Examples:
      | value        |
      | 2026-03-01   |
      | tomorrow     |
      | 2026-03-01T00:00 |

  @REQ-QRY-17a @REQ-QRY-18 @UC-5.2 @rk-qry-8 @error @req-d2b6ec62
  Scenario: The consumer notices a response whose period is not the one it asked for
    Given a basic publisher with one entry for "2026-01"
    And the publisher is served on a local port
    When the consumer fetches the local origin asking for start "1999-01-01T00:00:00Z" and end "2000-01-01T00:00:00Z"
    Then the fetch reports that the period was not as requested
    And no period is recorded as covered

  @REQ-QRY-17a @REQ-QRY-18 @UC-5.2 @rk-qry-8 @error @req-d2b6ec62
  Scenario: The consumer notices a response whose target is not the one it asked for
    Given a basic publisher with one entry for "2026-01"
    And the publisher is served on a local port
    When the consumer fetches the local origin asking for target "/nothing"
    Then the fetch reports that the target was not as requested
    And no target is recorded as covered

  @REQ-QRY-18 @REQ-PRT-05 @UC-5.2 @rk-qry-8 @edge @req-23c17076 @req-d2b6ec62
  Scenario: A response that covers only part of the requested range is not recorded as covering all of it
    Given a basic publisher with one entry for "2025-01"
    And the publisher is served on a local port
    When the consumer fetches the local origin asking for start "2025-01-01T00:00:00Z" and end "2026-01-01T00:00:00Z"
    Then the recorded coverage is "2025-01-01T00:00:00Z" to "2025-02-01T00:00:00Z"
    And the fetch reports that the period was not fully covered

  @REQ-QRY-18 @UC-5.2 @rk-qry-8 @rk-body-2 @edge @req-d2b6ec62
  Scenario: An empty array is recorded as no data, not as coverage of the range
    Given an extended publisher holding these periods:
      | label | start                | end                  | target      |
      | 2024  | 2024-01-01T00:00:00Z | 2025-01-01T00:00:00Z | example.com |
    And the publisher is served on a local port
    When the consumer fetches the local origin asking for start "2030-01-01T00:00:00Z" and end "2031-01-01T00:00:00Z"
    Then no period is recorded as covered
    And the fetch does not report an error

  @REQ-QRY-17a @REQ-QRY-18 @UC-5.2 @rk-qry-8 @edge @req-d2b6ec62
  Scenario: Objects of other targets inside an array are flagged one by one
    Given an extended publisher that ignores the target parameter and holds these periods:
      | label | start                | end                  | target      |
      | own   | 2025-01-01T00:00:00Z | 2026-01-01T00:00:00Z | example.com |
      | other | 2025-01-01T00:00:00Z | 2026-01-01T00:00:00Z | /api/v1     |
    And the publisher is served on a local port
    When the consumer fetches the local origin asking for target "/api/v1"
    Then the object "own" is reported as not the requested target
    And the target "/api/v1" is recorded as covered by "other" only

  @REQ-QRY-17a @REQ-QRY-17b @UC-5.2 @rk-qry-8 @golden @req-d2b6ec62
  Scenario: A response within the requested range is not flagged
    Given an extended publisher holding these periods:
      | label | start                | end                  | target      |
      | jan   | 2026-01-01T00:00:00Z | 2026-02-01T00:00:00Z | example.com |
      | feb   | 2026-02-01T00:00:00Z | 2026-03-01T00:00:00Z | example.com |
    And the publisher is served on a local port
    When the consumer fetches the local origin asking for start "2026-01-01T00:00:00Z" and end "2026-03-01T00:00:00Z" at granularity "monthly"
    Then the fetch reports nothing as not requested
    And the recorded coverage is "2026-01-01T00:00:00Z" to "2026-03-01T00:00:00Z"

  # ---- target value, parameterless request, partial answers ----

  @REQ-QRY-08 @golden @req-e6268aef @rk-qry-5
  Scenario Outline: A path prefix selects the same object whether or not its slash is percent-encoded
    When I send GET "/.well-known/sustainability-data?target=<value>"
    Then the status is 200
    And the body lists the periods api-2025-03

    Examples:
      | value     |
      | /api/v1   |
      | %2Fapi%2Fv1 |
      | %2fapi%2fv1 |

  @REQ-QRY-08 @error @req-e6268aef @rk-qry-5
  Scenario: A path value without the leading slash matches no path-prefix object
    When I send GET "/.well-known/sustainability-data?target=api/v1"
    Then the status is 200
    And the body is a JSON array
    And the body lists no periods

  @REQ-QRY-08 @REQ-TGT-04 @edge @req-e6268aef @req-22b478b8 @rk-qry-5
  Scenario Outline: A host value is compared case-insensitively after percent-decoding
    When I send GET "/.well-known/sustainability-data?granularity=monthly&target=<value>"
    Then the body lists the periods 2025-01, 2025-02, 2025-03

    Examples:
      | value       |
      | example.com |
      | EXAMPLE.COM |
      | Example.Com |

  @REQ-QRY-19 @golden @req-6c3122f6 @rk-qry-7
  Scenario: A request without parameters to an extended publisher returns the held objects as an array in ascending order
    When I send GET "/.well-known/sustainability-data"
    Then the status is 200
    And the body is a JSON array of 6 objects
    And the body lists the periods 2025-01, 2025, 2025-01-05, 2025-02, api-2025-03, 2025-03

  @REQ-QRY-19 @error @req-6c3122f6 @rk-qry-1 @rk-qry-2
  Scenario Outline: A request in which every parameter is ignored is answered as a request without parameters
    When I send GET "/.well-known/sustainability-data<query>"
    Then the status is 200
    And the body is the same as for GET "/.well-known/sustainability-data"
    And the body lists the periods 2025-01, 2025, 2025-01-05, 2025-02, api-2025-03, 2025-03

    Examples: every parameter is outside the profile or unknown
      | query                                        |
      | ?start=%&&&=&=x                              |
      | ?granularity=weekly                          |
      | ?start=2025-02-01&end=garbage                |
      | ?granularity=Monthly&unknown=1               |

  @impl @REQ-QRY-19 @edge @req-6c3122f6 @rk-qry-7
  Scenario: Equal period.start values are ordered by period.end, then target, and full ties keep the held order
    Given an extended publisher holding these periods in this order:
      | label       | start                | end                  | target       |
      | long        | 2025-03-01T00:00:00Z | 2025-05-01T00:00:00Z | example.com  |
      | zeta        | 2025-03-01T00:00:00Z | 2025-04-01T00:00:00Z | zeta.example |
      | alpha       | 2025-03-01T00:00:00Z | 2025-04-01T00:00:00Z | alpha.example |
      | alpha-again | 2025-03-01T00:00:00Z | 2025-04-01T00:00:00Z | alpha.example |
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data"
    Then the body lists the periods alpha, alpha-again, zeta, long

  @REQ-QRY-19 @edge @req-6c3122f6 @UC-7.1
  Scenario: The reference gateway answers its own report as one current object
    Given the reference gateway is running
    When I send GET "/.well-known/sustainability-data"
    Then the status is 200
    And the body is a JSON object
    And the object has period "2026-09-01T00:00:00Z" to "2026-10-01T00:00:00Z"
    And the object's "capabilities" is "extended"

  @REQ-PRT-01 @golden
  Scenario: An adapter with figures for two months emits two objects
    Given a CSV with monthly rows for "2026-08,2026-09"
    When the CSV adapter reads it
    Then the adapter yields 2 objects

  @REQ-PRT-01 @error
  Scenario: A month without figures yields no object and no zero is written in its place
    Given a CSV with monthly rows for "2026-08,2026-10"
    When the CSV adapter reads it
    Then the adapter yields 2 objects
    And no object has the period "2026-09-01T00:00:00Z" to "2026-10-01T00:00:00Z"

  @REQ-PRT-01 @edge
  Scenario: An empty CSV emits no object
    Given a CSV with monthly rows for ""
    When the CSV adapter reads it
    Then the adapter yields 0 objects

  @REQ-PRT-02 @golden @rk-opt-10
  Scenario Outline: An object with the seven mandatory members and exactly one metric member conforms
    Given a valid declaration object
    And every metric member and both evidence links are removed
    And the member "<metric>" is the number <value>
    When the consumer validates it
    Then it is valid
    And the publisher's schema agrees
    And the CDDL agrees

    Examples:
      | metric             | value |
      | energy-consumption | 100   |
      | renewable-energy   | 40    |
      | carbon-footprint   | 12.5  |

  @REQ-PRT-02 @REQ-MIN-01 @error @req-7f33240f @rk-opt-10
  Scenario: An object with the seven mandatory members and neither a metric nor a link is invalid
    Given a valid declaration object
    And every metric member and both evidence links are removed
    When the consumer validates it
    Then it is not valid

  @REQ-PRT-02 @edge @rk-opt-10
  Scenario: A second metric member does not stop an object from conforming
    Given a valid declaration object
    And every metric member and both evidence links are removed
    And the member "energy-consumption" is the number 100
    And the member "carbon-footprint" is the number 12.5
    When the consumer validates it
    Then it is valid

  @REQ-PRT-03 @golden
  Scenario: The tool asks for a methodology link and the generated declaration carries it
    Given the create-sustainability-data tool is given the default answers
    When the create-sustainability-data tool runs
    Then the tool writes one file
    And the written file validates as a declaration
    And the written member "methodology-uri" is present

  @REQ-PRT-03 @error
  Scenario: A declaration built from an estimate with no methodology link is refused by the tool
    Given the create-sustainability-data tool is given the default answers
    And the answer "measurement-method" is "hardware-estimated"
    And the answer "methodology-uri" is removed
    When the create-sustainability-data tool runs
    Then the tool refuses and names "methodology-uri"
    And no output file was written

  @REQ-PRT-03 @edge
  Scenario: A relative methodology link is kept relative
    Given the create-sustainability-data tool is given the default answers
    And the answer "methodology-uri" is "/sustainability/methodology"
    When the create-sustainability-data tool runs
    Then the written member "methodology-uri" is "/sustainability/methodology"

  @REQ-PRT-04 @golden @req-23c17076
  Scenario: The publisher writes the last completed month as what the figures cover
    Given a publisher given the calendar month "2026-09" with the offset "Z"
    When the publisher builds the declarations
    Then the published period is "2026-09-01T00:00:00Z" to "2026-10-01T00:00:00Z"
    And the published period ends no later than "updated"
    And the operator was not warned about "updated-before-period-end"

  @REQ-PRT-04 @REQ-PER-08 @error @req-23c17076 @req-305ad347
  Scenario: A month in progress labelled as the whole month raises the updated-before-period-end warning
    Given a publisher given the period "2026-10-01T00:00:00Z" to "2026-11-01T00:00:00Z"
    When the publisher builds the declarations
    Then the operator was warned about "updated-before-period-end"

  @REQ-PRT-04 @edge @req-23c17076
  Scenario: A period that ends exactly at updated is accepted without a warning
    Given the clock is fixed at "2026-10-24T00:00:00Z"
    And a publisher given the period "2026-10-01T00:00:00Z" to "2026-10-24T00:00:00Z"
    When the publisher builds the declarations
    Then the published period ends no later than "updated"
    And the operator was not warned about "updated-before-period-end"

  @REQ-PRT-05 @golden @req-23c17076 @rk-agg-1
  Scenario: Twelve contiguous months give contiguous coverage
    Given an extended publisher with monthly entries for "2025-01,2025-02,2025-03,2025-04,2025-05,2025-06,2025-07,2025-08,2025-09,2025-10,2025-11,2025-12"
    And the publisher is served on a local port
    When the consumer fetches the local origin asking for start "2025-01-01T00:00:00Z" and end "2026-01-01T00:00:00Z" at granularity "monthly"
    And the consumer totals the array
    Then the coverage is "contiguous"
    And the total covers "2025-01-01T00:00:00Z" to "2026-01-01T00:00:00Z"

  @REQ-PRT-05 @UC-5.4 @error @req-23c17076 @rk-agg-1
  Scenario: A missing month inside the range gives gaps, and the total is not presented as the whole range
    Given an extended publisher with monthly entries for "2025-01,2025-02,2025-03,2025-04,2025-05,2025-07,2025-08,2025-09,2025-10,2025-11,2025-12"
    And the publisher is served on a local port
    When the consumer fetches the local origin asking for start "2025-01-01T00:00:00Z" and end "2026-01-01T00:00:00Z" at granularity "monthly"
    And the consumer totals the array
    Then the coverage is "gaps"
    And the periods covered are "2025-01-01T00:00:00Z" to "2025-06-01T00:00:00Z" and "2025-07-01T00:00:00Z" to "2026-01-01T00:00:00Z"
    And the total is not presented as covering "2025-01-01T00:00:00Z" to "2026-01-01T00:00:00Z"

  @REQ-PRT-05 @edge @req-23c17076 @rk-agg-1
  Scenario: Months written in two offsets that still meet as instants are contiguous
    Given the declaration is an array of objects with periods "2025-01-01T00:00:00Z/2025-02-01T00:00:00Z", "2025-02-01T01:00:00+01:00/2025-03-01T01:00:00+01:00"
    When the consumer totals the array
    Then the coverage is "contiguous"
