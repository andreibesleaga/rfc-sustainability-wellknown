Feature: Mandatory service
  An origin publishes one declaration at one well-known URI, over HTTPS, with one media type. A static
  file is a complete, conformant publisher: it answers every request, whatever the query says.
  Draft -10, "The Well-Known URI", "The Declaration".

  Background:
    Given the clock is fixed at "2026-10-24T12:00:00Z"

  @REQ-URI-01 @REQ-URI-02 @UC-1.3 @golden
  Scenario: A static file at the well-known path is a declaration
    Given a valid declaration object
    And the publisher is served on a local port as a static file
    When I send GET "/.well-known/sustainability-data"
    Then the status is 200
    And the header "Content-Type" is "application/sustainability-data+json"
    And the body is a JSON object
    And the body validates as a declaration

  @REQ-QRY-02 @REQ-MND-03 @UC-1.3 @rk-qry-1 @rk-mand-2 @golden @req-969238cd
  Scenario Outline: A static file satisfies every request, whatever the query
    Given a basic publisher with one entry for "2026-01"
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data<query>"
    Then the status is 200
    And the body is identical to the body of GET "/.well-known/sustainability-data"
    And the object's "capabilities" is "basic"

    Examples:
      | query                                                                      |
      |                                                                            |
      | ?start=2025-01-01T00:00:00Z&end=2026-01-01T00:00:00Z                       |
      | ?target=/api/v1                                                            |
      | ?granularity=monthly                                                       |
      | ?start=2025-01-01T00:00:00Z&end=2026-01-01T00:00:00Z&granularity=daily     |
      | ?start=garbage                                                             |
      | ?granularity=Monthly                                                       |
      | ?period=2025                                                               |
      | ?unknown=1&unknown=2                                                       |
      | ?start=2025-01-01T00:00:00Z&start=2024-01-01T00:00:00Z                      |

  @REQ-URI-04 @REQ-URI-03a @REQ-URI-03b @UC-1.3 @error @req-7faa5bea
  Scenario: The consumer refuses to retrieve a declaration over plain HTTP
    When the consumer fetches the origin "http://example.test"
    Then the fetch did not succeed
    And the fetch outcome mentions "https"
    And the validator made no network request

  @REQ-URI-04 @REQ-SEC-11b @UC-1.3 @rk-opt-11 @edge @req-0c34adda @req-7faa5bea
  Scenario Outline: The consumer dereferences only https, for every kind of reference
    Given a valid declaration object
    And the member "methodology-uri" is "<reference>"
    When the consumer follows the evidence links of the object
    Then no connection is made for "<reference>"

    Examples:
      | reference                         |
      | http://example.test/method        |
      | ftp://example.test/method         |
      | file:///etc/passwd                |
      | data:text/plain,hello             |
      | javascript:alert(1)               |

  @REQ-URI-06 @UC-5.1 @golden @req-3b435062
  Scenario: A 200 response typed application/json is processed as a declaration
    Given a local server that answers the well-known path with "application/json" and status 200
    When the consumer fetches the local origin allowing insecure transport
    Then the fetched media type class is "json"
    And the fetch status is "ok"

  @REQ-URI-07 @UC-5.1 @error @req-3b435062
  Scenario Outline: A response with any other media type is not a declaration
    Given a local server that answers the well-known path with "<media type>" and status 200
    When the consumer fetches the local origin allowing insecure transport
    Then the fetch did not succeed
    And the fetch outcome mentions "media type"

    Examples:
      | media type                  |
      | text/html                   |
      | text/plain                  |
      | application/xml             |
      | application/ld+json         |
      | application/octet-stream    |

  @REQ-URI-05 @UC-5.1 @error
  Scenario Outline: A response that is not 200 OK is not a declaration
    Given a local server that answers the well-known path with "application/sustainability-data+json" and status <status>
    When the consumer fetches the local origin allowing insecure transport
    Then the fetch did not succeed

    Examples:
      | status |
      | 204    |
      | 404    |
      | 410    |
      | 500    |

  @REQ-BDY-05 @REQ-BDY-01 @UC-5.1 @rk-body-1 @golden @req-d243887d
  Scenario: One declaration object and a one-object array are equivalent
    Given a valid declaration object
    When the consumer validates it as a single object
    And the consumer validates it as an array of one object
    Then both are valid
    And both yield the same declaration

  @REQ-BDY-02 @UC-5.1 @rk-body-2 @edge
  Scenario: An empty array is a valid body
    Given the array is empty
    When the consumer validates it
    Then it is valid
    And the consumer reads no declaration object from it

  @REQ-BDY-02 @UC-5.1 @error
  Scenario Outline: A body that is not one JSON text of an object or an array of objects is rejected
    Given a local server whose body is the raw text '<body>'
    When the consumer fetches the local origin allowing insecure transport
    Then the fetch did not succeed

    Examples:
      | body             |
      | "just a string"  |
      | 42               |
      | null             |
      | [1, 2]           |
      | {"a": 1}{"b": 2} |
      |                  |

  @REQ-BDY-02 @UC-5.1 @error
  Scenario: A body that is not UTF-8 is rejected
    Given a local server whose body is the bytes "7b 22 70 72 6f 76 69 64 65 72 22 3a 22 ff fe 22 7d"
    When the consumer fetches the local origin allowing insecure transport
    Then the fetch did not succeed

  @REQ-MND-03 @UC-7.1 @rk-mand-2 @golden
  Scenario: A server that honours a query parameter declares itself extended
    Given the reference gateway is running
    When I send GET "/.well-known/sustainability-data?granularity=monthly"
    Then the status is 200
    And every object's "capabilities" is "extended"

  @REQ-MND-01 @rk-mand-13 @error
  Scenario Outline: An object without one of the seven mandatory members is invalid
    Given a valid declaration object
    And the member "<member>" is removed
    When the consumer validates it
    Then it is not valid
    And the errors mention "<member>"

    Examples:
      | member             |
      | updated            |
      | capabilities       |
      | provider           |
      | measurement-method |
      | methodology-uri    |
      | period             |
      | target             |

  @REQ-MIN-01 @UC-4.2 @rk-opt-10 @error @req-7f33240f
  Scenario: An object with neither a metric nor an evidence link is invalid
    Given a valid declaration object
    And every metric member and both evidence links are removed
    When the consumer validates it
    Then it is not valid

  @REQ-MIN-01 @UC-6.3 @rk-opt-10 @golden @req-7f33240f
  Scenario Outline: An evidence link alone makes a conformant object
    Given a valid declaration object
    And every metric member and both evidence links are removed
    And the member "<link>" is "https://example.com/evidence"
    When the consumer validates it
    Then it is valid

    Examples:
      | link                         |
      | disclosure-uri               |
      | verifiable-attestation-uri   |

  @REQ-MIN-01 @rk-opt-10 @edge @req-7f33240f
  Scenario: A metric of zero is a metric
    Given a valid declaration object
    And every metric member and both evidence links are removed
    And the member "carbon-footprint" is the number 0
    When the consumer validates it
    Then it is valid

  @REQ-BDY-08 @REQ-FRM-03 @rk-body-3 @edge @req-4f13e73d
  Scenario: A consumer ignores a top-level member it does not recognise
    Given a valid declaration object
    And the member "carbon-offsets-planned" is the number 12
    When the consumer retrieves and validates it
    Then it is valid
    And the fetch status is "ok"
    And the warnings mention "carbon-offsets-planned"
    And the command-line consumer exits with status 0

  @REQ-BDY-07 @REQ-BDY-09 @rk-body-3 @error @req-4f13e73d @req-9201dff3
  Scenario: A publisher never emits a top-level member the draft does not define
    When a publisher is asked to build an object with the top-level member "version"
    Then the publisher refuses to build it
    And the refusal names "version"

  @REQ-URF-02 @REQ-URF-01 @UC-5.1 @rk-opt-11 @golden
  Scenario: A relative URI reference is resolved against the retrieval URI
    Given a valid declaration object
    And the member "methodology-uri" is "/sustainability/methodology"
    When the consumer retrieves it from "https://example.com/.well-known/sustainability-data"
    Then the resolved "methodology-uri" is "https://example.com/sustainability/methodology"

  @REQ-URF-03 @rk-opt-11 @edge
  Scenario: A relay keeps the retrieval URI, so the references still resolve to the publisher
    Given a valid declaration object
    And the member "disclosure-uri" is "../esg/disclosures"
    When a relay stores the declaration retrieved from "https://example.com/.well-known/sustainability-data"
    And the relay forwards it
    Then the forwarded record carries the retrieval URI "https://example.com/.well-known/sustainability-data"
    And the resolved "disclosure-uri" is "https://example.com/esg/disclosures"

  @REQ-MND-04 @edge @req-233a411a
  Scenario Outline: provider is text in any script
    Given a valid declaration object
    And the member "provider" is "<provider>"
    When the consumer validates it
    Then it is valid
    And the member "provider" is read back as "<provider>"

    Examples:
      | provider                                  |
      | Acme Retail plc (sustainability@acme.example) |
      | Nordisk Energi Oy (kestavyys@nordisk.example) |
      | 株式会社サンプル (esg@sample.example)         |
      | شركة المثال (esg@example.example)             |
      | Пример ООО (esg@primer.example)               |

  # ---- HTTP exchange, media type parameters, IANA entry, empty source ----

  @REQ-URI-08 @golden
  Scenario: A conditional GET carrying the current entity tag is answered 304
    Given a valid declaration object
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data" with the ETag of GET "/.well-known/sustainability-data"
    Then the status is 304
    And the body is empty

  @REQ-URI-08 @error
  Scenario: A stale entity tag is answered 200 with the whole declaration
    Given a valid declaration object
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data" with If-None-Match '"stale-0000"'
    Then the status is 200
    And the body is a JSON object
    And the header "ETag" is present

  @REQ-URI-08 @edge
  Scenario: The weak form of the current entity tag still matches a conditional GET
    Given a valid declaration object
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data" with the weak form of the ETag of GET "/.well-known/sustainability-data"
    Then the status is 304

  @REQ-IAN-01 @golden
  Scenario: The publisher, the consumer and the gateway use the same single path suffix
    Given a valid declaration object
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data"
    Then the status is 200
    When the consumer fetches the local origin allowing insecure transport
    Then the consumer requested the path "/.well-known/sustainability-data"
    Given the reference gateway is running
    When I send GET "/.well-known/sustainability-data"
    Then the status is 200

  @REQ-IAN-02 @golden
  Scenario: The publisher sends the media type with no parameter
    Given a valid declaration object
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data"
    Then the header "Content-Type" is "application/sustainability-data+json"

  @REQ-IAN-02 @error
  Scenario: A publisher that adds a parameter to the media type is reported by the header check
    Given a local server that answers the well-known path with "application/sustainability-data+json; charset=utf-8" and status 200
    When the header check runs on the local origin
    Then the header check reports "media type parameter"

  @REQ-IAN-02 @edge
  Scenario Outline: The consumer accepts the media type with a parameter and ignores the parameter
    Given a local server that answers the well-known path with "<media type>" and status 200
    When the consumer fetches the local origin allowing insecure transport
    Then the fetch status is "ok"

    Examples:
      | media type                                           |
      | application/sustainability-data+json; charset=utf-8  |
      | application/sustainability-data+json;profile=x       |
      | Application/Sustainability-Data+JSON                 |

  @REQ-IAN-03 @golden
  Scenario: The body is UTF-8 JSON without a byte order mark
    Given a valid declaration object
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data"
    Then the body is a JSON object
    And the body has no byte order mark
    And the body is encoded in UTF-8

  @REQ-IAN-03 @error
  Scenario: A body in UTF-16 is not a declaration
    Given a local server whose body is the bytes "ff fe 7b 00 7d 00"
    When the consumer fetches the local origin allowing insecure transport
    Then the fetch did not succeed

  @REQ-IAN-03 @edge
  Scenario: A fragment identifier of the retrieval URI is ignored when the request is made
    Given a valid declaration object
    And the publisher is served on a local port
    When the consumer fetches the local origin with the fragment "section-2" allowing insecure transport
    Then the fetch status is "ok"
    And the request target was "/.well-known/sustainability-data"

  @REQ-IAN-04 @UC-1.3 @golden
  Scenario Outline: Each static kit returns the registered media type for the extensionless path
    Given the static kit "<kit>" serving a valid declaration
    When I send GET "/.well-known/sustainability-data"
    Then the status is 200
    And the header "Content-Type" is "application/sustainability-data+json"

    Examples:
      | kit              |
      | netlify          |
      | cloudflare-pages |
      | vercel           |
      | nginx            |
      | caddy            |

  @REQ-IAN-04 @UC-1.3 @error
  Scenario Outline: A static kit that returns another media type fails the kit check
    Given the static kit "<kit>" configured to return "<wrong type>"
    When the kit check runs
    Then the kit check fails
    And the kit check message mentions "Content-Type"

    Examples:
      | kit          | wrong type               |
      | netlify      | text/plain               |
      | vercel       | application/octet-stream |
      | github-pages | application/octet-stream |

  @REQ-IAN-04 @UC-1.3 @edge
  Scenario: A sustainability-data.json file is mapped by no rule of the kit, so the host serves it by its extension
    Then the kit "netlify" maps no rule to the path "/.well-known/sustainability-data.json"

  @REQ-LIB-03 @golden
  Scenario: A non-empty source answers 200 when no parameter is sent
    Given a basic publisher with one entry for "2026-01"
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data"
    Then the status is 200
    And the body is a JSON object

  @REQ-LIB-03 @error
  Scenario: A publisher that honours no parameter and holds nothing answers 404
    Given a basic publisher with no entry
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data"
    Then the status is 404

  @REQ-LIB-03 @edge
  Scenario: An extended publisher that holds nothing and receives a query answers 200 with an empty array
    Given an extended publisher holding no periods
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data?granularity=monthly"
    Then the status is 200
    And the body is a JSON array of 0 objects

  @REQ-URI-03b @UC-1.3 @error @req-7faa5bea
  Scenario: A kit that redirects the well-known path to an http URL fails the kit check
    Given the static kit "nginx" configured to redirect the well-known path to "http://example.test/.well-known/sustainability-data"
    When the kit check runs
    Then the kit check fails
    And the kit check message mentions "https"
