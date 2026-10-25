Feature: Reference gateway demos
  The reference gateway is a live demonstration and a test fixture: its own report, the registry of curated
  subjects, the public validator and badge, the index of examples, and the routes that make the draft's rules
  visible. Nothing here is a requirement of the draft (Appendix B.2 only describes it); the scenarios pin the
  behaviour of gateway 0.2.0. Row ids G01 to G36 and GV1 to GV13 are the gateway's example matrix; each scenario names what it checks.

  Background:
    Given the clock is fixed at "2026-10-17T12:00:00Z"
    And the reference gateway is running

  # ---- the service's own report (G01 to G09): held set at the fixed clock = 79 days, 2 months, 2 edge months ----

  @REQ-QRY-19 @REQ-APX-01 @golden @UC-7.1 @req-6c3122f6 @rk-qry-1
  Scenario: G01 A request without parameters returns the current object for September 2026, signed
    When I send GET "/.well-known/sustainability-data"
    Then the status is 200
    And the body is a JSON object
    And the object has period "2026-09-01T00:00:00Z" to "2026-10-01T00:00:00Z"
    And the object's "capabilities" is "extended"
    And the signature header "alg" is "Ed25519"
    When the consumer verifies the signature
    Then the signature status is "verified"

  @REQ-QRY-12 @REQ-QRY-10 @golden @UC-7.1 @req-6c3122f6 @rk-qry-4 @rk-qry-7
  Scenario: G02 September and its thirty days are returned in ascending order, the shorter day first
    When I send GET "/.well-known/sustainability-data?start=2026-09-01T00:00:00Z&end=2026-10-01T00:00:00Z"
    Then the body is a JSON array of 31 objects
    And the body is in ascending period order
    And the first object has period "2026-09-01T00:00:00Z" to "2026-09-02T00:00:00Z"
    And the second object has period "2026-09-01T00:00:00Z" to "2026-10-01T00:00:00Z"

  @REQ-QRY-15 @golden @UC-7.1 @req-e6268aef @rk-qry-6
  Scenario Outline: G03 G04 G05 Granularity and range select whole units from the held set
    When I send GET "/.well-known/sustainability-data?<query>"
    Then the status is 200
    And the body is a JSON array of <count> objects

    Examples: the two edge months are not whole (granularity drops them) and lie outside the August-September range (the range drops them)
      | id  | query                                                                | count |
      | G03 | granularity=monthly                                                  | 2     |
      | G04 | granularity=daily                                                    | 79    |
      | G05 | start=2026-08-01T00:00:00Z&end=2026-10-01T00:00:00Z                  | 63    |

  @REQ-QRY-12 @REQ-QRY-11 @edge @UC-7.1 @req-6c3122f6 @rk-qry-7
  Scenario: G06 A range before go-live returns an empty array and not 404
    When I send GET "/.well-known/sustainability-data?start=2025-01-01T00:00:00Z&end=2026-01-01T00:00:00Z&granularity=monthly"
    Then the status is 200
    And the body is a JSON array of 0 objects

  @REQ-QRY-03 @REQ-QRY-07 @REQ-QRY-19 @error @UC-7.1 @req-ee318dc3 @req-6c3122f6 @rk-qry-2 @rk-qry-1
  Scenario Outline: G07 A value outside the profile, or a repeated parameter, is ignored and the answer is that of G01
    When I send GET "/.well-known/sustainability-data<query>"
    Then the status is 200
    And the body is identical to the body of GET "/.well-known/sustainability-data"
    And the entity tag equals the entity tag of GET "/.well-known/sustainability-data"

    Examples:
      | query                                          |
      | ?granularity=weekly                            |
      | ?start=2026-08-01                              |
      | ?start=2026-08-01T00:00:00%2B01:00             |
      | ?granularity=monthly&granularity=daily         |

  @REQ-QRY-14 @REQ-QRY-15 @golden @UC-7.1 @req-e6268aef @rk-qry-5
  Scenario: G08 The report's own target selects its two months
    When I send GET "/.well-known/sustainability-data?target=sustainability-data-gateway&granularity=monthly"
    Then the body is a JSON array of 2 objects

  @REQ-QRY-14 @REQ-QRY-11 @edge @UC-7.1 @req-e6268aef @rk-qry-5 @rk-qry-7
  Scenario: G09 A target the gateway does not report gives 200 and an empty array
    When I send GET "/.well-known/sustainability-data?target=/other"
    Then the status is 200
    And the body is a JSON array of 0 objects

  # ---- REQ-GWY-01: registry subjects ----

  @REQ-GWY-01 @golden @UC-7.2
  Scenario Outline: G34 A registry subject is served as its -10 file, noindex, with the terms of service, unsigned by the gateway
    When I send GET "/<domain>/.well-known/sustainability-data"
    Then the status is 200
    And the header "Content-Type" is "application/sustainability-data+json"
    And the header "X-Robots-Tag" is "noindex"
    And the header "Link" contains "/legal"
    And the header "Link" contains "terms-of-service"
    And the body equals the data file "gateway/data/<domain>.json"
    And the object has no gateway signature

    Examples:
      | domain          |
      | automattic.com  |
      | mozilla.org     |
      | hetzner.com     |

  @REQ-GWY-01 @error @UC-7.2
  Scenario Outline: G15 An unknown domain and each withheld domain answer 404 with a JSON error
    When I send GET "/<domain>/.well-known/sustainability-data"
    Then the status is 404
    And the body is a JSON error
    And the body is not a declaration

    Examples:
      | domain            |
      | unknown.example   |
      | akamai.com        |
      | cloudflare.com    |
      | fastly.com        |
      | microsoft.com     |
      | ovhcloud.com      |
      | scaleway.com      |
      | torchbox.com      |

  @REQ-GWY-01 @edge @UC-7.2
  Scenario: A conditional GET on a registry subject answers 304 and keeps both headers
    When I send GET "/automattic.com/.well-known/sustainability-data" with the ETag of GET "/automattic.com/.well-known/sustainability-data"
    Then the status is 304
    And the header "X-Robots-Tag" is "noindex"
    And the header "Link" contains "terms-of-service"

  # ---- REQ-GWY-02: boot gate ----

  @REQ-GWY-02 @golden @UC-7.2
  Scenario: The 27 declaration data files in -10 form start the gateway
    Given the 27 declaration data files of the gateway are in -10 form
    When the gateway starts
    Then the gateway is running

  @REQ-GWY-02 @error @UC-7.2
  Scenario: A data file in -08 form (reporting-period) stops the start and the message names the upgrade command
    Given a gateway data file whose declaration is in a "reporting-period" member
    When the gateway starts
    Then the gateway refuses to start
    And the start message mentions "sustainability-publisher upgrade"

  @REQ-GWY-02 @edge @UC-7.2
  Scenario: The self-measured file, which is not a declaration, is not gated
    Given the gateway data file "gateway/data/_self-measured.json" is not a declaration
    When the gateway starts
    Then the gateway is running

  # ---- REQ-GWY-03: the public validator ----

  @REQ-GWY-03 @golden @UC-7.3
  Scenario Outline: GV1 GV2 A valid origin is reported valid in the current format, with its signature status
    Given a fake origin serving "<file>" as "application/sustainability-data+json"
    When I send GET "/validate?origin=https://fake.example.com"
    Then the status is 200
    And the validator result has status "valid"
    And the validator result has format "current"
    And the validator result has signature "<signature>"
    And the validator result "period" is an object

    Examples:
      | id  | file                           | signature |
      | GV1 | valid/draft-introduction.json  | unsigned  |
      | GV2 | signed/ed25519-single.json     | verified  |

  @REQ-GWY-03 @edge @UC-7.3
  Scenario: GV2 A signature verified with a header key is reported as integrity only
    Given a fake origin serving "signed/ed25519-single.json" as "application/sustainability-data+json"
    When I send GET "/validate?origin=https://fake.example.com"
    Then the validator result note mentions "integrity"

  @REQ-GWY-03 @edge @UC-7.3
  Scenario: GV9 A twelve-hour period is valid and the note carries the day-floor advisory
    Given a fake origin serving "tolerated/period-12-hours.json" as "application/sustainability-data+json"
    When I send GET "/validate?origin=https://fake.example.com"
    Then the validator result has status "valid"
    And the validator result note mentions "calendar day"

  @REQ-GWY-03 @error @UC-7.3
  Scenario Outline: GV6 GV7 GV11 An origin that does not serve a valid declaration is reported invalid
    Given a fake origin serving "<file>" as "<media type>"
    When I send GET "/validate?origin=https://fake.example.com"
    Then the status is 200
    And the validator result has status "invalid"

    Examples:
      | id   | file                           | media type                          |
      | GV6  | invalid/bound-lowercase-t.json | application/sustainability-data+json |
      | GV7  | prose/period-reversed.json     | application/sustainability-data+json |
      | GV11 | valid/draft-introduction.json  | text/html                           |

  @REQ-GWY-03 @error @UC-7.3
  Scenario: GV12 A refused connection is reported unreachable
    Given a fake origin that refuses the connection
    When I send GET "/validate?origin=https://fake.example.com"
    Then the validator result has status "unreachable"

  @REQ-GWY-03 @edge @UC-7.3
  Scenario Outline: GV3 GV4 GV5 A -08 or -09 document is valid in the legacy format, with what was converted or disregarded
    Given a fake origin serving "<file>" as "application/sustainability-data+json"
    When I send GET "/validate?origin=https://fake.example.com"
    Then the validator result has status "valid"
    And the validator result has format "legacy"
    And the validator result lists "<member>" as <kind>

    Examples:
      | id  | file                                 | member             | kind       |
      | GV3 | legacy/in/08-year.json               | period             | converted  |
      | GV4 | legacy/in/09-year.json               | period             | converted  |
      | GV5 | legacy/in/08-method-free-text.json   | measurement-method | disregarded |

  @REQ-GWY-03 @edge @UC-7.3
  Scenario Outline: GV8 GV10 An empty array and a payload that differs from its object are valid with a detail
    Given a fake origin serving "<file>" as "application/sustainability-data+json"
    When I send GET "/validate?origin=https://fake.example.com"
    Then the validator result has status "valid"
    And the validator result <check>

    Examples:
      | id   | file                                    | check                              |
      | GV8  | valid/empty-array.json                  | detail mentions "no report"        |
      | GV10 | signed/bad/payload-target-differs.json  | has signature "unverified"         |

  # ---- REQ-GWY-04: validator limits ----

  @REQ-GWY-04 @golden @UC-7.3
  Scenario: An https origin on port 443 is checked once with the published consumer
    Given a fake origin serving "valid/draft-introduction.json" as "application/sustainability-data+json"
    When I send GET "/validate?origin=https://fake.example.com"
    Then the validator retrieved "https://fake.example.com:443/.well-known/sustainability-data" once

  @REQ-GWY-04 @error @UC-7.3
  Scenario Outline: GV13 An origin that is not https, is a loopback address or is missing is answered 400
    When I send GET "/validate<query>"
    Then the status is 400
    And the validator made no retrieval

    Examples:
      | query                              |
      | ?origin=http://x.example.com           |
      | ?origin=https://127.0.0.1          |
      |                                    |

  @REQ-GWY-04 @error @UC-7.3
  Scenario: A host that resolves to a private address is refused
    Given the host "private.example.com" resolves to "10.0.0.5"
    When I send GET "/validate?origin=https://private.example.com"
    Then the validator refuses the origin
    And the validator made no retrieval

  @REQ-GWY-04 @error @UC-7.3
  Scenario: A body over 64 KiB is cut and reported
    Given a fake origin whose body is 70000 bytes of JSON
    When I send GET "/validate?origin=https://fake.example.com"
    Then the validator result has status "invalid"
    And the validator result detail mentions "64 KiB"

  @REQ-GWY-04 @edge @UC-7.3
  Scenario: The second request for a host within the hour comes from the cache
    Given a fake origin serving "valid/draft-introduction.json" as "application/sustainability-data+json"
    When I send GET "/validate?origin=https://fake.example.com"
    And I send GET "/validate?origin=https://fake.example.com"
    Then the fake origin saw 1 request

  @REQ-GWY-04 @edge @UC-7.3
  Scenario: G33 A spent validator budget answers 503 with Retry-After and no outcome about the origin
    Given the validator budget is spent
    When I send GET "/validate?origin=https://x.example.com"
    Then the status is 503
    And the header "Retry-After" is present
    And the body has no member "status"

  @REQ-GWY-04 @edge @UC-7.3
  Scenario: A host named in VALIDATOR_EXCLUDE is not fetched
    Given the host "excluded.example.com" is named in VALIDATOR_EXCLUDE
    When I send GET "/validate?origin=https://excluded.example.com"
    Then the validator made no retrieval

  # ---- REQ-GWY-05: the badge ----

  @REQ-GWY-05 @golden @UC-7.3
  Scenario Outline: GV1 GV3 The badge carries the same outcome as the validator, a status word and a text alternative
    Given a fake origin serving "<file>" as "application/sustainability-data+json"
    When I send GET "/badge/fake.example.com.svg"
    Then the status is 200
    And the header "Content-Type" is "image/svg+xml; charset=utf-8"
    And the badge status word is "<word>"
    And the badge has a text alternative
    And the badge does not contain the words "verified" or "certified"

    Examples:
      | id  | file                           | word           |
      | GV1 | valid/draft-introduction.json  | valid          |
      | GV3 | legacy/in/08-year.json         | valid (legacy) |

  @REQ-GWY-05 @error @UC-7.3
  Scenario Outline: GV6 GV12 An invalid origin and an unreachable one get their own badge
    Given <origin>
    When I send GET "/badge/fake.example.com.svg"
    Then the badge status word is "<word>"
    And the badge does not contain the words "verified" or "certified"

    Examples:
      | id   | origin                                                                          | word        |
      | GV6  | a fake origin serving "invalid/bound-lowercase-t.json" as "application/sustainability-data+json" | invalid     |
      | GV12 | a fake origin that refuses the connection                                       | unreachable |

  @REQ-GWY-05 @edge @UC-7.3
  Scenario: GV2 A signed file's badge still does not say verified
    Given a fake origin serving "signed/ed25519-single.json" as "application/sustainability-data+json"
    When I send GET "/badge/fake.example.com.svg"
    Then the badge status word is "valid"
    And the badge does not contain the words "verified" or "certified"

  @REQ-GWY-05 @edge @UC-7.3
  Scenario: G33 A spent budget returns the notice badge with Retry-After, never cached as an outcome
    Given the validator budget is spent
    When I send GET "/badge/x.example.com.svg"
    Then the status is 503
    And the header "Retry-After" is present
    And the badge is the notice badge
    And the response is not cached as an outcome

  # ---- REQ-GWY-06: the index ----

  @REQ-GWY-06 @golden @UC-7.4
  Scenario: G12 G13 The page and the JSON index list every example and request, with period as an object
    When I send GET "/"
    Then the status is 200
    And the page lists every example with its exact request
    When I send GET "/index.json"
    Then the body has the lists "subjects", "adapter-demonstrations" and "wire-format-examples"
    And the list "adapter-demonstrations" has 11 entries
    And the list "wire-format-examples" has 42 entries
    And every entry has "period" as an object with "start" and "end"

  @REQ-GWY-06 @error @UC-7.4
  Scenario: A link or an entry that uses period= fails the index check
    Given an index entry whose request uses "period="
    When the index check runs
    Then the check fails
    And the check message mentions "period="

  @REQ-GWY-06 @edge @UC-7.4
  Scenario: G12 G13 A wire example carries its range and granularity, and the period column shows both bounds
    When I send GET "/index.json"
    Then every wire example carries "range" and "granularity"
    When I send GET "/"
    Then the period column of each row shows both bounds in a title
    And no link on the page contains "period="

  # ---- REQ-GWY-07: healthz and legal ----

  @REQ-GWY-07 @golden @UC-7.4
  Scenario: G14 /healthz answers ok with the subject count and /legal answers the notice as plain text
    When I send GET "/healthz"
    Then the status is 200
    And the body "status" is "ok"
    And the body "subjects" is a number
    When I send GET "/legal"
    Then the status is 200
    And the header "Content-Type" contains "text/plain"

  @REQ-GWY-07 @error @UC-7.4
  Scenario: A POST to /healthz is answered 405 with Allow
    When I send POST "/healthz"
    Then the status is 405
    And the header "Allow" is "GET, HEAD"

  @REQ-GWY-07 @edge @UC-7.4
  Scenario: /healthz is not subject to the rate limit
    Given a gateway with a rate limit of 600 requests per minute
    When I send 601 GET requests to "/healthz"
    Then every status is 200

  # ---- REQ-GWY-08: rate limit ----

  @REQ-GWY-08 @golden @UC-7.4
  Scenario: G30 Six hundred requests in a minute from one client are all answered
    Given a gateway with a rate limit of 600 requests per minute
    When I send 600 GET requests to "/.well-known/sustainability-data"
    Then every status is 200

  @REQ-GWY-08 @error @UC-7.4
  Scenario: G30 The 601st request in the minute gets 429 with Retry-After and a JSON error
    Given a gateway with a rate limit of 600 requests per minute
    When I send 601 GET requests to "/.well-known/sustainability-data"
    Then one of the statuses is 429
    And the last response carries a "Retry-After" of a positive number of seconds
    And the last response body is a JSON error

  @REQ-GWY-08 @edge @UC-7.4
  Scenario: G31 After the window the same client gets 200 again
    Given a gateway with a rate limit of 600 requests per minute
    And 601 requests were sent to "/.well-known/sustainability-data"
    When the clock moves to "2026-10-17T12:01:01Z"
    And I send GET "/.well-known/sustainability-data"
    Then the status is 200

  @REQ-GWY-08 @REQ-SEC-14 @edge @req-e700cd62 @UC-7.4
  Scenario: G32 A 429 is never cached as a declaration, and /healthz stays exempt
    Given a gateway with a rate limit of 600 requests per minute
    And 601 requests were sent to "/.well-known/sustainability-data"
    When I send GET "/healthz"
    Then the status is 200
    When the clock moves to "2026-10-17T12:01:01Z"
    And I send GET "/.well-known/sustainability-data"
    Then the status is 200
    And the header "ETag" is present
    And the body is a JSON object

  # ---- REQ-GWY-09: HEAD, conditional GET, other methods ----

  @REQ-GWY-09 @golden @UC-7.4 @REQ-URI-08
  Scenario: G10 G11 HEAD answers with the headers of GET and no body, and a conditional GET answers 304
    When I send HEAD "/.well-known/sustainability-data"
    Then the status is 200
    And the body is empty
    And the headers equal the headers of GET "/.well-known/sustainability-data"
    When I send GET "/.well-known/sustainability-data" with the ETag of GET "/.well-known/sustainability-data"
    Then the status is 304
    And the body is empty

  @REQ-GWY-09 @error @UC-7.4
  Scenario Outline: G11 G36 Any other method is answered 405 with Allow: GET, HEAD
    When I send <method> "<route>"
    Then the status is 405
    And the header "Allow" is "GET, HEAD"

    Examples:
      | method | route                                                   |
      | POST   | /.well-known/sustainability-data                        |
      | PUT    | /.well-known/sustainability-data?granularity=monthly    |
      | DELETE | /.well-known/sustainability-data?granularity=monthly    |
      | POST   | /mozilla.org/.well-known/sustainability-data            |

  @REQ-GWY-09 @edge @UC-7.4
  Scenario Outline: G35 G36 A query route answers a conditional GET with 304 and HEAD with the headers of GET
    When I send GET "/.well-known/sustainability-data?<query>" with the ETag of GET "/.well-known/sustainability-data?start=2026-08-01T00:00:00Z&end=2026-10-01T00:00:00Z"
    Then the status is 304
    And the body is empty
    And the entity tag equals the entity tag of GET "/.well-known/sustainability-data?start=2026-08-01T00:00:00Z&end=2026-10-01T00:00:00Z"
    When I send HEAD "/.well-known/sustainability-data?<query>"
    Then the status is 200
    And the body is empty
    And the headers equal the headers of GET "/.well-known/sustainability-data?<query>"

    Examples: the spelling of a bound does not change the cache entry
      | query                                                 |
      | start=2026-08-01T00:00:00Z&end=2026-10-01T00:00:00Z   |
      | start=2026-08-01T00:00:00.000Z&end=2026-10-01T00:00:00Z |

  # ---- REQ-GWY-10: accessibility of the pages ----

  @REQ-GWY-10 @golden @UC-7.4
  Scenario: G12 The index page declares its language, has one h1 and labels every control
    When I send GET "/"
    Then the page declares its language
    And the page has exactly one h1
    And every form control of the page has a label
    And the validator result is announced in an aria-live region

  @REQ-GWY-10 @error @UC-7.4
  Scenario: A control without a label, or a status shown by colour alone, fails the accessibility run
    Given a copy of the index page with a form control that has no label
    When the accessibility run checks the page
    Then the run fails
    And the run message mentions "label"

  @REQ-GWY-10 @edge @UC-7.4
  Scenario: The page is readable with scripts off and at 320 px
    When I send GET "/"
    Then the page needs no script to be read
    And the page reflows at a width of 320 px without horizontal scrolling

  # ---- signature routes (G20 to G23) ----

  @REQ-SIG-01 @REQ-VER-01 @golden @UC-7.4 @rk-sig-1
  Scenario Outline: G20 G22 A served signed example verifies and says nothing about accuracy
    When I send GET "/<domain>/.well-known/sustainability-data"
    Then the object is signed with <alg>
    When the consumer verifies the signature
    Then the signature status is "verified"
    And the presentation says the signature shows integrity and not accuracy

    Examples:
      | id  | domain              | alg     |
      | G20 | signed.example      | Ed25519 |
      | G22 | signed-es256.example | ES256   |

  @REQ-SIG-01 @golden @UC-7.4 @rk-sig-1
  Scenario: G21 A signed array carries one signature per object, each verifying against its own header
    When I send GET "/signed-array.example/.well-known/sustainability-data?granularity=monthly"
    Then the body is a JSON array of 3 objects
    When the consumer verifies every signature of the array
    Then every signature status is "verified"
    And the two signed members differ

  @REQ-SIG-01 @edge @UC-7.4 @rk-sig-1
  Scenario: G23 A selection from a signed array is served as signed, not re-signed
    When I send GET "/signed-array.example/.well-known/sustainability-data?start=2026-02-01T00:00:00Z&end=2026-03-01T00:00:00Z"
    Then the body is a JSON array of 1 objects
    When the consumer verifies every signature of the array
    Then every signature status is "verified"
    And the served signed member is the one held in the data file

  # ---- upstream walk routes (C5) ----

  @REQ-UPS-04 @REQ-SEC-10a @golden @UC-7.4 @rk-opt-15
  Scenario: The chain of three declarations is followed from chain-org.example
    When the consumer walks the upstream chain from "/chain-org.example/.well-known/sustainability-data"
    Then the walk completes
    And exactly 3 upstream declarations were retrieved

  @REQ-UPS-04 @REQ-SEC-10a @edge @UC-7.4 @rk-opt-15
  Scenario: The fifth declaration is reachable by URL but not by a walk of depth three
    When I send GET "/chain-grid.example/.well-known/sustainability-data"
    Then the status is 200
    When the consumer walks the upstream chain from "/chain-org.example/.well-known/sustainability-data"
    Then the fourth declaration below the subject was never requested

  @REQ-UPS-04 @REQ-SEC-10b @error @UC-7.4 @rk-opt-15
  Scenario: Two declarations that name each other answer normally, and only the walk stops
    When I send GET "/loop-a.example/.well-known/sustainability-data"
    Then the status is 200
    When the consumer walks the upstream chain from "/loop-a.example/.well-known/sustainability-data"
    Then the walk reports a loop
    And no upstream URI was retrieved twice

  # ---- every served example (C2) ----

  @REQ-URI-01 @REQ-URI-02 @golden @UC-7.4
  Scenario Outline: Every served example answers 200 with the registered media type, as the shape its row names
    When I send GET "/<domain>/.well-known/sustainability-data"
    Then the status is 200
    And the header "Content-Type" is "application/sustainability-data+json"
    And the body is <shape>

    Examples:
      | domain                | shape                    |
      | basic.example         | a JSON object            |
      | extended.example      | a JSON object            |
      | two-targets.example   | a JSON array of 2 objects |
      | functional-units.example | a JSON array of 12 objects |
      | year-and-months.example  | a JSON array of 13 objects |
