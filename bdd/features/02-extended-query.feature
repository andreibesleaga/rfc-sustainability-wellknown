Feature: Extended query parameters
  A server may honour target, period and granularity. The seven-step procedure of the draft
  decides what comes back: one object, or a sorted array when a finer granularity is in effect.
  Draft -08 (prepared; -07 posted), section "Extended Query Parameters".

  @req-684991a9 @req-5152df1a @req-7f1dbd9c
  Scenario: A yearly period at monthly granularity returns the sorted, non-overlapping months
    Given an extended publisher with monthly entries for "2025-01,2025-02,2025-03,2025-04,2025-05,2025-06,2025-07,2025-08,2025-09,2025-10,2025-11,2025-12"
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data?period=2025&granularity=monthly"
    Then the status is 200
    And the body is a JSON array of 12 objects
    And the body is in ascending reporting-period order without overlap
    And every object's reporting-period starts with "2025"

  @req-5152df1a @req-9bcce9c7 @req-7f1dbd9c
  Scenario: A completed period without a granularity is one aggregated object carrying the contributors' provider
    Given an extended publisher with monthly entries for "2025-01,2025-02,2025-03,2025-04,2025-05,2025-06,2025-07,2025-08,2025-09,2025-10,2025-11,2025-12"
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data?period=2025"
    Then the status is 200
    And the body is a JSON object
    And the object's reporting-period is "2025"
    And the object's "provider" is "Example Org (https://example.com/contact)"

  @req-7f1dbd9c
  Scenario: Entries that cover only part of a finished period cannot be summed into a figure for the whole of it
    Given an extended publisher with monthly entries for "2025-01,2025-02,2025-03"
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data?period=2025"
    Then the status is 404

  @req-5152df1a
  Scenario: A granularity no finer than the period never produces an array
    Given an extended publisher with monthly entries for "2025-01,2025-02"
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data?period=2025-01&granularity=monthly"
    Then the status is 200
    And the body is a JSON object

  @req-684991a9
  Scenario: A Basic publisher ignores the parameters and answers its Basic response
    Given a basic publisher with one entry for "2026-01"
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data?period=1999&granularity=daily"
    Then the status is 200
    And the body is a JSON object
    And the object's reporting-period is "2026-01"

  @req-ae51fdec
  Scenario: The consumer compares the period it asked for with the one it received, and records the difference
    Given a basic publisher with one entry for "2026-01"
    And the publisher is served on a local port
    When the consumer fetches the local origin asking for period "1999" at granularity "daily"
    Then the fetch reports that the period was not as requested

  @req-ae51fdec
  Scenario: The consumer compares the target it asked for with the one it received
    Given a basic publisher with one entry for "2026-01"
    And the publisher is served on a local port
    When the consumer fetches the local origin asking for target "/nothing"
    Then the fetch reports that the target was not as requested

  @req-ae51fdec
  Scenario: A response within the requested period is not flagged
    Given an extended publisher with monthly entries for "2026-01,2026-02"
    And the publisher is served on a local port
    When the consumer fetches the local origin asking for period "2026" at granularity "monthly"
    Then the fetch reports nothing as not requested

  @req-c978c015
  Scenario: A server that honours target publishes the set of prefixes it honours in its methodology document
    Then the repository's gateway methodology publishes the set of target prefixes it honours

  @req-515afd88
  Scenario: A target the server does not publish is 404, indistinguishable from a period with no data
    Given the reference gateway is running
    When I send GET "/.well-known/sustainability-data?target=/nothing"
    Then the status is 404
    And the body is identical to the body of GET "/.well-known/sustainability-data?period=1999"

  @req-684991a9
  Scenario: The reference gateway's own report is Extended
    Given the reference gateway is running
    When I send GET "/.well-known/sustainability-data?period=2025&granularity=monthly"
    Then the status is 200
    And the body is a JSON array
    And the body is in ascending reporting-period order without overlap
    And the body validates as a declaration

  @req-581a802b
  Scenario: Daily granularity over a year is bounded by the calendar
    Given the reference gateway is running
    When I send GET "/.well-known/sustainability-data?period=2025&granularity=daily"
    Then the status is 200
    And the body has at most 366 objects

  @req-e73b19b7 @req-23ad5bde
  Scenario: Nothing finer than a day is ever served; an undefined granularity value is ignored
    Given the reference gateway is running
    When I send GET "/.well-known/sustainability-data?period=2025-01-05&granularity=hourly"
    Then the status is 200
    And the body is a JSON object
    And the object's reporting-period is "2025-01-05"

  @req-8fe518ba
  Scenario: A repeated parameter is a bad request
    Given the reference gateway is running
    When I send GET "/.well-known/sustainability-data?period=2025&period=2024"
    Then the status is 400

  @req-8ee496d1
  Scenario: An impossible calendar date is a bad request
    Given the reference gateway is running
    When I send GET "/.well-known/sustainability-data?period=2025-02-30"
    Then the status is 400
