Feature: Security and privacy
  What an attacker could do with a declaration, and the provision of the draft that limits it. The consumer bounds
  every fetch and never follows a link it does not need; a server that computes answers rate-limits and caches;
  the publisher keeps periods at a day or longer. Draft -10, "Security Considerations", "Privacy Considerations".

  Background:
    Given the clock is fixed at "2026-10-24T12:00:00Z"

  # ---- addresses ----

  @REQ-SEC-12 @UC-5.1 @rk-lim-1 @error @req-0c34adda
  Scenario Outline: The consumer refuses a loopback, private or link-local address
    Then the consumer refuses the address "<address>"

    Examples: IPv4
      | address          |
      | 127.0.0.1        |
      | 127.255.255.254  |
      | 0.0.0.0          |
      | 10.1.2.3         |
      | 172.16.0.1       |
      | 172.31.255.255   |
      | 192.168.0.9      |
      | 169.254.169.254  |
      | 100.64.0.1       |

  @REQ-SEC-12 @UC-5.1 @rk-lim-1 @error @req-0c34adda
  Scenario Outline: The consumer refuses IPv6 and mapped forms of the same addresses
    Then the consumer refuses the address "<address>"

    Examples:
      | address               |
      | ::1                   |
      | ::                    |
      | fe80::1               |
      | fc00::1               |
      | fd12:3456:789a::1     |
      | ::ffff:127.0.0.1      |
      | ::ffff:10.0.0.1       |
      | ::ffff:169.254.169.254 |
      | 0:0:0:0:0:0:0:1       |

  @REQ-SEC-12 @UC-5.1 @rk-lim-1 @edge @req-0c34adda
  Scenario Outline: The consumer refuses the address however the host spells it
    When the consumer fetches the origin "<origin>"
    Then the fetch did not succeed
    And no connection is made

    Examples:
      | origin                      |
      | https://localhost           |
      | https://LOCALHOST           |
      | https://localhost.          |
      | https://2130706433          |
      | https://0x7f.0.0.1          |
      | https://017700000001        |
      | https://127.1               |
      | https://[::1]               |
      | https://user@127.0.0.1      |

  @REQ-SEC-12 @UC-5.1 @rk-lim-1 @golden @req-0c34adda
  Scenario Outline: The consumer allows a public address
    Then the consumer allows the address "<address>"

    Examples:
      | address         |
      | 93.184.216.34   |
      | 8.8.8.8         |
      | 2606:4700::1111 |
      | 172.32.0.1      |
      | 192.169.0.1     |

  @REQ-SEC-12 @UC-5.1 @rk-lim-1 @error @req-0c34adda
  Scenario Outline: The address rule applies at every connection, redirects included
    Given a public origin that redirects the well-known path with status <status> to "<target>"
    When the consumer fetches the origin
    Then the fetch did not succeed
    And no connection is made to "<target>"

    Examples:
      | status | target                              |
      | 301    | https://127.0.0.1/.well-known/sustainability-data |
      | 302    | https://10.0.0.5/                   |
      | 307    | https://192.168.1.1/                |
      | 308    | https://169.254.169.254/latest/meta-data |
      | 302    | https://[::1]/                      |

  @REQ-SEC-12 @UC-5.1 @rk-lim-1 @error @req-0c34adda
  Scenario: A host name that resolves to a private address at connection time is refused (DNS rebinding)
    Given the host "rebind.example" resolves to "93.184.216.34" when checked and to "127.0.0.1" when connected
    When the consumer fetches the origin "https://rebind.example"
    Then the fetch did not succeed
    And no data was read from "127.0.0.1"

  @REQ-SEC-12 @UC-5.1 @rk-lim-1 @edge @req-0c34adda
  Scenario: A host name with a public and a private address is refused
    Given the host "mixed.example" resolves to "93.184.216.34" and "10.0.0.7"
    When the consumer fetches the origin "https://mixed.example"
    Then the fetch did not succeed

  @REQ-SEC-11b @REQ-SEC-11c @REQ-SEC-12 @UC-6.3 @rk-lim-1 @error @req-0c34adda
  Scenario Outline: Every kind of link in a declaration obeys the same rules
    Given a valid declaration object
    And the member "<member>" is "<reference>"
    When the consumer follows the evidence links of the object
    Then no connection is made for "<reference>"

    Examples:
      | member                       | reference                       |
      | verifiable-attestation-uri   | https://127.0.0.1/vc.json       |
      | verifiable-attestation-uri   | http://example.test/vc.json     |
      | disclosure-uri               | https://10.0.0.5/index.json     |
      | disclosure-uri               | https://[fe80::1]/index.json    |
      | methodology-uri              | https://169.254.169.254/m       |

  @REQ-SEC-11b @REQ-SEC-12 @REQ-UPS-04 @UC-5.5 @rk-lim-1 @rk-opt-15 @error @req-0c34adda
  Scenario Outline: An upstream declaration URI obeys the same rules
    Given a valid declaration object
    And the upstream member names "<reference>" with role "cloud"
    When the consumer walks the upstream chain
    Then no connection is made for "<reference>"
    And the walk reports the upstream "<reference>" as refused

    Examples:
      | reference                         |
      | http://cloud.example/t.json       |
      | https://127.0.0.1/t.json          |
      | https://192.168.0.2/t.json        |
      | ftp://cloud.example/t.json        |
      | file:///etc/passwd                |

  @REQ-URF-02 @REQ-SEC-12 @REQ-UPS-04 @UC-5.5 @rk-opt-11 @rk-opt-15 @edge @req-0c34adda
  Scenario: An upstream entry that is a relative reference resolves against the retrieval URI and obeys the same rules
    Given a declaration retrieved from "https://example.com/.well-known/sustainability-data"
    And the upstream member names "/tenants/acme.json"
    When the consumer walks the upstream chain
    Then the connection is to "https://example.com/tenants/acme.json"

  # ---- bounds ----

  @REQ-SEC-11a @UC-5.1 @rk-lim-1 @error @req-0c34adda
  Scenario: The consumer bounds redirects
    Given a local server that redirects the well-known path in a loop
    When the consumer fetches the local origin allowing insecure transport
    Then the fetch did not succeed
    And the fetch outcome mentions "redirect"

  @REQ-SEC-11a @UC-5.1 @rk-lim-1 @error @req-0c34adda
  Scenario: The consumer bounds the number of redirects, not only loops
    Given a local server that redirects the well-known path through 12 distinct URLs
    When the consumer fetches the local origin allowing insecure transport with at most 5 redirects
    Then the fetch did not succeed

  @REQ-SEC-11a @UC-5.1 @rk-lim-1 @error @req-0c34adda
  Scenario: The consumer bounds the time of a fetch
    Given a local server that sends one byte per second
    When the consumer fetches the local origin allowing insecure transport with a time limit of 2 seconds
    Then the fetch did not succeed
    And the fetch outcome mentions "time"

  @REQ-SEC-11a @REQ-SEC-08 @UC-5.1 @rk-lim-1 @error @req-0c34adda @req-b55a61c6
  Scenario: The consumer bounds the size of what it reads
    Given a local server whose declaration body is 20000 bytes of JSON
    When the consumer fetches the local origin allowing insecure transport with at most 4096 bytes
    Then the fetch did not succeed
    And the fetch outcome mentions "bytes"

  @REQ-SEC-08 @UC-5.1 @rk-lim-1 @error @req-b55a61c6
  Scenario: The consumer bounds the number of objects it accepts and treats an excess as an error
    Given a local server whose declaration is an array of 10 objects
    When the consumer fetches the local origin allowing insecure transport with at most 5 objects
    Then the fetch did not succeed
    And the fetch outcome mentions "objects"

  @REQ-SEC-08 @UC-5.1 @rk-lim-1 @edge @req-b55a61c6
  Scenario Outline: A limit is a limit on the boundary
    Given a local server whose declaration is an array of <held> objects
    When the consumer fetches the local origin allowing insecure transport with at most 5 objects
    Then the fetch status is "<status>"

    Examples:
      | held | status           |
      | 4    | ok               |
      | 5    | ok               |
      | 6    | too-many-objects |
      | 0    | ok               |

  @REQ-SEC-08 @UC-5.1 @rk-lim-1 @error @req-b55a61c6
  Scenario: A body expanded by a content coding is bounded after expansion
    Given a local server that sends a gzip body of 2000 bytes that expands to 200000000 bytes
    When the consumer fetches the local origin allowing insecure transport with at most 1000000 bytes
    Then the fetch did not succeed
    And the process did not run out of memory

  @REQ-SEC-08 @REQ-SEC-09 @UC-5.1 @rk-lim-1 @error @req-2feb22c3 @req-b55a61c6
  Scenario Outline: A hostile JSON body is an error, never a crash
    Given a local server whose body is the generated text "<kind>"
    When the consumer fetches the local origin allowing insecure transport
    Then the fetch did not succeed
    And the consumer process is still running

    Examples:
      | kind                                              |
      | an array nested 100000 levels deep                |
      | an object nested 100000 levels deep               |
      | a string of 50000000 characters                   |
      | an object with 1000000 members                    |
      | a number with 100000 digits                       |

  @REQ-SEC-09 @REQ-NUM-02 @UC-5.1 @rk-lim-1 @rk-body-6 @error @req-27e5209f @req-2feb22c3
  Scenario Outline: Duplicate member names, unpaired surrogates and numbers beyond binary64 are errors
    Given a local server whose body is a declaration with the raw member '<raw>'
    When the consumer fetches the local origin allowing insecure transport
    Then the fetch did not succeed

    Examples:
      | raw                                                   |
      | "target": "a", "target": "b"                          |
      | "period": {"start": "2025-01-01T00:00:00Z", "end": "2026-01-01T00:00:00Z"}, "period": {"start": "2025-01-01T00:00:00Z", "end": "2026-01-01T00:00:00Z"} |
      | "provider": "x\ud800y"                                |
      | "energy-consumption": 1e400                           |

  @REQ-SEC-09 @UC-5.1 @rk-lim-1 @rk-body-6 @edge @req-2feb22c3
  Scenario: A duplicate name inside a nested object is found too
    Given a local server whose body is a declaration with the raw member '"extensions": {"urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845": {"a": 1, "a": 2}}'
    When the consumer fetches the local origin allowing insecure transport
    Then the fetch did not succeed

  # ---- upstream walk ----

  @REQ-SEC-10a @UC-5.5 @rk-opt-15 @golden @req-6bbbce7c
  Scenario Outline: The consumer follows upstream declarations up to three levels
    Given a subject declaration whose upstream chain is <depth> declarations deep
    When the consumer walks the upstream chain
    Then at most 3 upstream declarations were retrieved
    And the deepest retrieved comparison has depth <reached>

    Examples:
      | depth | reached |
      | 1     | 1       |
      | 2     | 2       |
      | 3     | 3       |
      | 4     | 3       |
      | 10    | 3       |

  @REQ-SEC-10a @UC-5.5 @rk-opt-15 @edge @req-6bbbce7c
  Scenario: The declaration the walk starts from is not counted as one of the three
    Given a subject declaration whose upstream chain is 4 declarations deep
    When the consumer walks the upstream chain
    Then the fourth declaration below the subject was never requested

  @REQ-SEC-10b @UC-5.5 @rk-opt-15 @error @req-6bbbce7c
  Scenario Outline: The consumer refuses a URI it has already retrieved in the walk
    Given a subject declaration whose upstream chain <shape>
    When the consumer walks the upstream chain
    Then no upstream URI was retrieved twice
    And the walk reports a duplicate

    Examples:
      | shape                                          |
      | loops back on itself                           |
      | names the subject itself as its own upstream   |
      | has two entries naming the same declaration    |
      | loops through three declarations               |

  @REQ-SEC-10b @UC-5.5 @rk-opt-15 @edge @req-6bbbce7c
  Scenario Outline: The same URI in another spelling is the same URI
    Given a subject declaration whose second upstream names "<second>" after the first named "https://cloud.example/t/acme.json"
    When the consumer walks the upstream chain
    Then "<second>" is not retrieved a second time

    Examples:
      | second                                 |
      | https://CLOUD.example/t/acme.json      |
      | https://cloud.example:443/t/acme.json  |
      | https://cloud.example/t/acme.json#top  |
      | https://cloud.example/t/./acme.json    |
      | https://cloud.example/t/x/../acme.json |

  @REQ-SEC-10c @UC-5.5 @UC-3.2 @rk-opt-15 @error @req-6bbbce7c
  Scenario: The consumer bounds the total number of retrievals in one walk
    Given a subject declaration with 50 upstream entries, each a distinct declaration
    When the consumer walks the upstream chain with at most 10 retrievals
    Then at most 10 upstream declarations were retrieved
    And the walk reports that the bound was reached

  @REQ-SEC-10a @REQ-SEC-10c @UC-5.5 @rk-opt-15 @edge @req-6bbbce7c
  Scenario: Breadth and depth are bounded together
    Given a subject declaration whose 5 upstream entries each have 5 upstream entries, to depth 3
    When the consumer walks the upstream chain with at most 20 retrievals
    Then at most 20 upstream declarations were retrieved
    And the deepest retrieved comparison has depth 3 or less

  @REQ-EVD-03 @REQ-EVD-04 @UC-3.2 @rk-opt-14 @golden @req-35a72fee
  Scenario: An upstream that delivered more than the subject reports is an inconsistency, not a failure
    Given the upstream declaration says it delivered more energy than the subject reports
    When the consumer walks the upstream chain
    Then a comparison verdict is "inconsistent"
    And the subject declaration is still valid
    And the walk does not report a conformance failure

  @REQ-EVD-05 @UC-3.2 @rk-opt-14 @edge
  Scenario Outline: The comparison is limited to what the format carries
    Given the subject and the upstream differ as "<difference>"
    When the consumer walks the upstream chain
    Then a comparison verdict is "<verdict>"

    Examples:
      | difference                                              | verdict       |
      | the upstream reports less than the subject              | consistent    |
      | the upstream reports exactly what the subject reports   | consistent    |
      | the upstream is in MWh and the subject in kWh, equal    | consistent    |
      | the carbon accounting methods differ                    | not comparable |
      | one has carbon-accounting and the other has none        | not comparable |
      | the periods do not match                                | not comparable |
      | the upstream target-type is not tenant                  | not comparable |

  @REQ-UPS-04 @UC-5.5 @rk-opt-15 @edge
  Scenario: An empty array as an upstream declaration does not crash the walk
    Given a subject declaration whose upstream declaration is an empty array
    When the consumer walks the upstream chain
    Then the walk completes
    And the upstream is reported as having no object

  @REQ-UPS-04 @UC-5.5 @rk-opt-15 @edge
  Scenario: An unreachable upstream does not fail the subject
    Given a subject declaration whose upstream answers 404
    When the consumer walks the upstream chain
    Then the subject declaration is still valid
    And the upstream is reported as not retrieved

  # ---- extensions and data ----

  @REQ-EXT-02 @REQ-EXT-05 @rk-opt-12 @golden
  Scenario Outline: An extension name is an identifier, accepted as published and never dereferenced
    Then the extension name "<name>" is accepted

    Examples:
      | name                                                   |
      | https://acme.example/esg/extensions/water-and-waste     |
      | urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845           |
      | urn:uuid:16C36135-E6AE-40F9-A972-015EEFC68845           |
      | HTTPS://ACME.EXAMPLE/ext                                |
      | https://acme.example/ext#v2                             |

  @REQ-EXT-04 @rk-opt-12 @error @req-8e5210f0
  Scenario Outline: An extension value is data: nothing in it is fetched or executed
    Given a valid declaration object
    And the extension "https://acme.example/ext" is '<value>'
    When the consumer retrieves and validates it
    Then it is valid
    And no connection is made
    And nothing in the extension was executed

    Examples:
      | value                                                           |
      | {"report": "https://tracker.example/pixel.gif"}                 |
      | {"script": "<script>alert(1)</script>"}                         |
      | {"include": "file:///etc/passwd"}                               |
      | {"$ref": "https://127.0.0.1/schema.json"}                       |
      | {"@context": "https://evil.example/context.jsonld"}             |

  @REQ-EXT-02 @rk-opt-12 @edge
  Scenario: Two extension names that differ only in case are different names
    Given a valid declaration object
    And the extension "https://acme.example/Ext" is '{"a": 1}'
    And the extension "https://acme.example/ext" is '{"a": 2}'
    When the consumer retrieves and validates it
    Then it is valid
    And the two extensions are read as separate

  @REQ-EXT-01 @rk-opt-12 @error
  Scenario: An extension whose value is not an object is invalid
    Given a valid declaration object
    And the extension "https://acme.example/ext" is '[1, 2]'
    When the consumer validates it
    Then it is not valid

  @REQ-SEC-13 @golden
  Scenario Outline: Every string is data, kept as text
    Given a valid declaration object
    And the member "<member>" is "<value>"
    When the consumer retrieves and validates it
    Then it is valid
    And the member "<member>" is read back as "<value>"
    And the member "<member>" is never interpreted as markup

    Examples:
      | member    | value                                     |
      | provider  | <img src=x onerror=alert(1)>              |
      | provider  | Acme'); DROP TABLE objects;--             |
      | target    | {{7*7}}                                   |
      | provider  | ${jndi:ldap://127.0.0.1/a}                |

  @REQ-SEC-03 @edge
  Scenario Outline: A displayed name is isolated from the surrounding text
    Given a valid declaration object
    And the member "provider" is "<provider>"
    When the consumer displays the provider
    Then the provider text is isolated for display

    Examples:
      | provider                                |
      | Acme ‮evil.example‬ plc       |
      | ‮txt.exe                           |
      | Acme ⁦hidden⁩                 |
      | عربي Acme Ltd                           |

  @REQ-CLM-01 @REQ-CLM-02 @UC-5.1 @rk-agg-3 @golden @req-3229f5af
  Scenario: The consumer never represents the data as verified because it was retrieved
    Given a valid declaration object
    When the consumer retrieves and validates it
    Then the presentation says the figures are claims of the origin that served them
    And the data is not reported as true or verified-accurate

  @REQ-EVD-01 @UC-6.3 @error
  Scenario: An attestation counts only once retrieved, validated against a trusted issuer and found to cover the target and period
    Given a valid declaration object
    And the member "verifiable-attestation-uri" is "https://auditor.example/vc.json"
    And the credential at "https://auditor.example/vc.json" is issued by an issuer the consumer does not trust
    When the consumer retrieves and validates it
    Then the attestation is reported as not checked
    When the consumer checks the attestation URI "https://auditor.example/vc.json"
    Then the attestation is not valid
    And the attestation reason is "no trusted issuer"

  # ---- server side ----

  @REQ-SEC-14 @REQ-GWY-08 @UC-7.4 @golden @req-e700cd62
  Scenario: A gateway rate-limits the well-known URI
    Given a gateway with a rate limit of 5 requests per minute
    When I send 6 GET requests to "/.well-known/sustainability-data?granularity=monthly"
    Then one of the statuses is 429
    And the header "Retry-After" is present

  @REQ-SEC-14 @REQ-GWY-08 @UC-7.4 @edge @req-e700cd62
  Scenario: A rate-limited answer is not a declaration and does not poison the cache
    Given a gateway with a rate limit of 1 requests per minute
    When I send 2 GET requests to "/.well-known/sustainability-data?granularity=monthly"
    Then the 429 response is not typed application/sustainability-data+json
    And the 429 response carries no entity tag
    And the consumer treats the 429 as a failed fetch, not an empty declaration

  @REQ-SEC-14 @REQ-GWY-09 @UC-7.1 @golden @req-e700cd62
  Scenario: A computed answer is cached and revalidated
    Given the reference gateway is running
    When I send GET "/.well-known/sustainability-data?granularity=monthly" with the ETag of GET "/.well-known/sustainability-data?granularity=monthly"
    Then the status is 304
    And the body is empty

  @REQ-SEC-14 @edge @req-e700cd62
  Scenario Outline: Two queries that select the same objects share an entity tag, whatever the spelling of an ignored parameter
    Given the reference gateway is running
    When I send GET "/.well-known/sustainability-data?granularity=monthly<noise>"
    Then the entity tag equals the entity tag of GET "/.well-known/sustainability-data?granularity=monthly"

    Examples:
      | noise                    |
      | &utm_source=x            |
      | &start=garbage           |
      | &period=2025             |

  # ---- privacy ----

  @REQ-PER-08 @REQ-PRV-02 @UC-4.1 @rk-mand-10 @golden @req-182dbb2b @req-305ad347
  Scenario: A publisher serves nothing shorter than a calendar day by default
    Given a publisher holding periods "2025-01-01T00:00:00Z/2025-01-01T12:00:00Z" and "2025-01-02T00:00:00Z/2025-01-03T00:00:00Z"
    When the publisher is served on a local port
    And I send GET "/.well-known/sustainability-data"
    Then the body lists only the period "2025-01-02T00:00:00Z/2025-01-03T00:00:00Z"
    And the operator was warned about "2025-01-01T00:00:00Z/2025-01-01T12:00:00Z"

  @REQ-PER-08 @UC-4.1 @UC-1.1 @rk-mand-10 @edge @req-305ad347
  Scenario Outline: The day-floor option decides what happens to a short period
    Given the dayFloor option is "<option>"
    And a publisher holding periods "2025-01-01T00:00:00Z/2025-01-01T12:00:00Z"
    When the publisher is served on a local port
    And I send GET "/.well-known/sustainability-data"
    Then the body lists <result>
    And the operator was warned <warned>

    Examples:
      | option | result                                              | warned |
      | drop   | no periods                                          | yes    |
      | warn   | the period "2025-01-01T00:00:00Z/2025-01-01T12:00:00Z" | yes    |
      | off    | the period "2025-01-01T00:00:00Z/2025-01-01T12:00:00Z" | no     |

  @REQ-PER-08 @rk-mand-10 @rk-mand-9 @edge @req-305ad347
  Scenario Outline: The floor reads each bound in its own offset
    Given a publisher holding periods "<period>"
    When the publisher is served on a local port
    And I send GET "/.well-known/sustainability-data"
    Then the body lists <result>

    Examples:
      | period                                            | result                  |
      | 2025-03-30T00:00:00+01:00/2025-03-31T00:00:00+02:00 | that period           |
      | 2025-10-26T00:00:00+02:00/2025-10-27T00:00:00+01:00 | that period           |
      | 2026-03-01T08:00:00+08:00/2026-03-02T08:00:00+08:00 | no periods            |
      | 2026-03-01T00:00:00+08:00/2026-03-02T00:00:00+08:00 | that period           |

  @REQ-PER-08 @UC-7.1 @rk-mand-10 @golden @req-305ad347
  Scenario: The reference gateway serves only day boundaries
    Given the reference gateway is running
    When I send GET "/.well-known/sustainability-data?granularity=daily&start=2026-01-01T00:00:00Z&end=2026-12-31T00:00:00Z"
    Then every bound of every period is at 00:00:00 of a day in its own offset
    And no period is shorter than one calendar day

  @REQ-PRV-03 @REQ-PRV-04 @REQ-PRV-05 @REQ-PRV-06 @golden @req-dda38f04
  Scenario: Noise stays within 1 percent, is applied once, and is the same on every build
    Given an extended publisher with monthly entries for "2025-01,2025-02" and noise enabled
    Then the published figures for "2025-01" are within 1% of 100 kWh, consistent with the carbon figure, and identical across two builds

  @REQ-PRV-04 @edge
  Scenario Outline: Noise is keyed by the instants of the period, so the spelling of a bound does not change it
    Given a publisher with noise enabled and a figure of 100 kWh
    When it publishes the period "<a>" and then the period "<b>"
    Then the two published energy figures are identical

    Examples:
      | a                                          | b                                            |
      | 2025-01-01T00:00:00Z/2025-02-01T00:00:00Z  | 2025-01-01T00:00:00+00:00/2025-02-01T00:00:00Z |
      | 2025-01-01T00:00:00Z/2025-02-01T00:00:00Z  | 2025-01-01T01:00:00+01:00/2025-02-01T01:00:00+01:00 |
      | 2025-01-01T00:00:00Z/2025-02-01T00:00:00Z  | 2025-01-01T00:00:00.000Z/2025-02-01T00:00:00.000Z |

  @REQ-PRV-05 @edge
  Scenario: Noise keeps annualized and derived members consistent so no unperturbed member discloses a perturbed one
    Given an extended publisher with monthly entries for "2025-01" and noise enabled
    Then the ratios between energy, carbon, intensity and the annualized figure equal the ratios before noise

  # ---- extensions, claimant, evidence, transport, held set, privacy advice ----

  @REQ-EXT-01 @golden @rk-opt-12
  Scenario: The yearly example carries two extensions, each an object under its own name
    Given the draft's example "An Organization's Yearly Figures"
    When the consumer validates it
    Then it is valid
    And the extension "https://acme.example/esg/extensions/water-and-waste" is accepted
    And the extension name "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845" is accepted

  @REQ-EXT-01 @error @rk-opt-12
  Scenario Outline: An extension value that is not an object is invalid
    Given a valid declaration object
    And the member "extensions" is the JSON '{"https://acme.example/ext": <json>}'
    When the consumer reads it in strict mode
    Then it is not valid
    And the errors mention "extensions"

    Examples:
      | json     |
      | "text"   |
      | [1, 2]   |
      | null     |
      | 7        |

  @REQ-EXT-01 @error @rk-opt-12
  Scenario Outline: An extensions member that is not an object is invalid
    Given a valid declaration object
    And the member "extensions" is the JSON '<json>'
    When the consumer reads it in strict mode
    Then it is not valid
    And the errors mention "extensions"

    Examples:
      | json     |
      | []       |
      | "x"      |
      | null     |

  @REQ-EXT-01 @edge @rk-opt-12
  Scenario: An empty extensions object is valid
    Given a valid declaration object
    And the member "extensions" is the JSON '{}'
    When the consumer reads it in strict mode
    Then it is valid

  @REQ-EXT-03 @golden @req-8e5210f0 @rk-opt-12
  Scenario: A registered handler receives the value of its own extension name
    Given a handler is registered for the extension name "https://acme.example/esg/extensions/water-and-waste"
    And the draft's example "An Organization's Yearly Figures"
    When the consumer retrieves and validates it
    Then the handler received the object of "https://acme.example/esg/extensions/water-and-waste"
    And the handler received nothing of "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845"

  @REQ-EXT-03 @error @req-8e5210f0 @rk-opt-12
  Scenario: A handler registered for another name never receives this value
    Given a handler is registered for the extension name "https://other.example/ext"
    And the draft's example "An Organization's Yearly Figures"
    When the consumer retrieves and validates it
    Then the handler received nothing

  @REQ-EXT-03 @edge @req-8e5210f0 @rk-opt-12
  Scenario: A handler that fails does not invalidate the declaration
    Given a handler that throws is registered for the extension name "https://acme.example/esg/extensions/water-and-waste"
    And the draft's example "An Organization's Yearly Figures"
    When the consumer retrieves and validates it
    Then it is valid
    And the warnings mention "water-and-waste"

  @REQ-EXT-05 @golden @rk-opt-12
  Scenario: A name is read the same before and after its domain changes hands
    Given a handler is registered for the extension name "https://acme.example/esg/extensions/water-and-waste"
    And the draft's example "An Organization's Yearly Figures"
    When the consumer retrieves and validates it
    Then the handler received the object of "https://acme.example/esg/extensions/water-and-waste"
    When the domain "acme.example" changes hands
    And the consumer retrieves and validates it
    Then the handler received the same object again

  @REQ-EXT-05 @error @rk-opt-12
  Scenario: The consumer makes no DNS query or registry lookup to interpret an extension name
    Given a recording resolver
    And the draft's example "An Organization's Yearly Figures"
    When the consumer retrieves and validates it
    Then the resolver saw no query for "acme.example"
    And no connection is made for "https://acme.example/esg/extensions/water-and-waste"

  @REQ-EXT-05 @edge @rk-opt-12
  Scenario: A handler keeps working when the domain of its name does not resolve
    Given a handler is registered for the extension name "https://gone.example/ext"
    And a valid declaration object
    And the extension "https://gone.example/ext" is '{"a": 1}'
    And the domain "gone.example" does not resolve
    When the consumer retrieves and validates it
    Then it is valid
    And the handler received the object of "https://gone.example/ext"

  @REQ-CLM-03 @golden @rk-agg-3
  Scenario: With no redirect the claimant is the requested origin
    Given a valid declaration object
    And the publisher is served on a local port
    When the consumer fetches the local origin allowing insecure transport
    Then the claimant is the requested origin

  @REQ-CLM-03 @error @rk-agg-3
  Scenario: A redirect to another origin never attributes the figures to the first origin
    Given a public origin that redirects the well-known path with status 301 to "https://other.example/.well-known/sustainability-data"
    When the consumer fetches the origin "https://first.example"
    Then the presentation says the figures are claims of "other.example"
    And the presentation does not say the figures are claims of "first.example"

  @REQ-CLM-03 @edge @rk-agg-3
  Scenario Outline: Every redirect status attributes the figures to the host that served the final response
    Given a public origin that redirects the well-known path with status <status> to "https://other.example/.well-known/sustainability-data"
    When the consumer fetches the origin "https://first.example"
    Then the claimant is "other.example"

    Examples:
      | status |
      | 301    |
      | 302    |
      | 307    |
      | 308    |

  @REQ-CLM-04 @golden @UC-5.1
  Scenario: A default fetch makes one request and no more
    Given a valid declaration object with the evidence links "disclosure-uri", "verifiable-attestation-uri" and an upstream entry
    And the publisher is served on a local port with a recording log
    When the consumer fetches the local origin allowing insecure transport
    Then the recording log shows 1 request

  @REQ-CLM-04 @error @UC-5.1
  Scenario: Asking for the disclosure index of a declaration that has none makes no request and says so
    Given a valid declaration object
    And the member "disclosure-uri" is removed
    And the publisher is served on a local port with a recording log
    When the consumer fetches the local origin with the option "disclosure" allowing insecure transport
    Then the recording log shows 1 request
    And the fetch outcome mentions "no disclosure-uri"

  @REQ-CLM-04 @edge @UC-5.1
  Scenario Outline: Each option adds only its own request
    Given a valid declaration object with the evidence links "disclosure-uri", "verifiable-attestation-uri" and an upstream entry
    And the publisher is served on a local port with a recording log
    When the consumer fetches the local origin with the option "<option>" allowing insecure transport
    Then the recording log shows 2 requests
    And the last request was for the <link>

    Examples:
      | option      | link                         |
      | disclosure  | disclosure-uri               |
      | attestation | verifiable-attestation-uri   |
      | upstream    | first upstream declaration   |

  @REQ-EVD-01 @golden @UC-6.3 @rk-opt-14
  Scenario: A credential from a trusted issuer that covers the target and the period makes the object attested
    Given a valid declaration object
    And the member "verifiable-attestation-uri" is "https://auditor.example/vc.json"
    And the credential at "https://auditor.example/vc.json" is issued by a trusted issuer for the target "Example Corp" and the period "2025-01-01T00:00:00Z" to "2026-01-01T00:00:00Z"
    When the consumer checks the attestation URI "https://auditor.example/vc.json"
    Then the attestation is valid

  @REQ-EVD-01 @error @UC-6.3 @rk-opt-14
  Scenario Outline: An attestation that is not retrieved, not trusted or not covering the object does not make it attested
    Given a valid declaration object
    And the member "verifiable-attestation-uri" is "https://auditor.example/vc.json"
    And the credential at "https://auditor.example/vc.json" <credential>
    When the consumer checks the attestation URI "https://auditor.example/vc.json"
    Then the attestation is not valid
    And the attestation reason is "<reason>"

    Examples:
      | credential                                                                                                                              | reason              |
      | is issued by an issuer the consumer does not trust                                                                                       | no trusted issuer   |
      | is issued by a trusted issuer for the target "Other Corp"                                                                                | target not covered  |
      | is issued by a trusted issuer for the period "2024-01-01T00:00:00Z" to "2025-01-01T00:00:00Z"                                            | period not covered  |
      | is issued by a trusted issuer for the target "Example Corp" and expired on "2026-01-01T00:00:00Z"                                         | expired             |
      | cannot be retrieved                                                                                                                      | not retrieved       |

  @REQ-EVD-01 @edge @UC-6.3 @rk-opt-14
  Scenario: An issuer that is not independent of the publisher is recorded as such
    Given a valid declaration object
    And the member "verifiable-attestation-uri" is "https://example.com/vc.json"
    And the credential at "https://example.com/vc.json" is issued by a trusted issuer that is the publisher itself for the target "Example Corp" and the period "2025-01-01T00:00:00Z" to "2026-01-01T00:00:00Z"
    When the consumer checks the attestation URI "https://example.com/vc.json"
    Then the attestation is valid
    And the attestation notes that the issuer is not independent of the publisher

  @REQ-EVD-02 @golden
  Scenario: Methodology and disclosure links are returned resolved and drawn no conclusion from
    Given a valid declaration object
    And the member "methodology-uri" is "/esg/methodology"
    And the member "disclosure-uri" is "/esg/disclosures"
    When the consumer retrieves it from "https://example.com/.well-known/sustainability-data"
    Then the resolved "methodology-uri" is "https://example.com/esg/methodology"
    And the resolved "disclosure-uri" is "https://example.com/esg/disclosures"

  @REQ-EVD-02 @edge
  Scenario: A link that cannot be reached changes nothing in the result
    Given a valid declaration object
    And the member "disclosure-uri" is "https://down.example/disclosures"
    When the consumer retrieves and validates it
    Then it is valid
    And no connection is made for "https://down.example/disclosures"

  @REQ-EVD-02 @edge
  Scenario: A methodology document that contradicts a figure changes nothing in the result
    Given a valid declaration object
    And the methodology document at the link states that the energy figure is wrong
    When the consumer retrieves and validates it
    Then it is valid
    And the energy is the figure of the object

  @REQ-EVD-03 @golden @req-35a72fee @rk-opt-14
  Scenario: The organization is compared with its cloud provider's tenant declaration for the same period
    Given a subject declaration whose upstream chain is 1 declarations deep
    And the upstream declaration has target-type "tenant"
    When the consumer compares the subject with its upstream
    Then a comparison verdict is "consistent"
    And every comparison names the period it compared

  @REQ-EVD-03 @error @req-35a72fee @rk-opt-14
  Scenario: Periods that differ by one hour are not compared
    Given a subject declaration whose upstream chain is 1 declarations deep
    And the upstream declaration has target-type "tenant"
    And the upstream period is "2025-01-01T01:00:00Z" to "2026-01-01T01:00:00Z"
    When the consumer compares the subject with its upstream
    Then no comparison is made

  @REQ-EVD-03 @edge @req-35a72fee @rk-opt-14
  Scenario Outline: Units are converted and periods are matched as instants before comparing
    Given a subject declaration whose upstream chain is 1 declarations deep
    And the upstream declaration has target-type "tenant"
    And the subject reports energy of <subject energy>
    And the upstream reports energy of <upstream energy>
    And the subject period is "<subject period>"
    And the upstream period is "<upstream period>"
    When the consumer compares the subject with its upstream
    Then a comparison verdict is "consistent"

    Examples:
      | subject energy | upstream energy | subject period                            | upstream period                                 |
      | 2400 MWh       | 2400000 kWh     | 2025-01-01T00:00:00Z/2026-01-01T00:00:00Z | 2025-01-01T00:00:00Z/2026-01-01T00:00:00Z       |
      | 2.4 GWh        | 2400 MWh        | 2025-01-01T00:00:00Z/2026-01-01T00:00:00Z | 2025-01-01T00:00:00+00:00/2026-01-01T00:00:00+00:00 |
      | 2400000 kWh    | 2400000 kWh     | 2025-01-01T00:00:00Z/2026-01-01T00:00:00Z | 2025-01-01T01:00:00+01:00/2026-01-01T01:00:00+01:00 |

  @REQ-EVD-05 @golden @rk-opt-14
  Scenario: With the same carbon-accounting value on both sides the carbon footprint is compared
    Given a subject declaration whose upstream chain is 1 declarations deep
    And the upstream declaration has target-type "tenant"
    And the subject and the upstream both declare "carbon-accounting" "market-based"
    When the consumer compares the subject with its upstream
    Then the comparison covers "energy-consumption" and "carbon-footprint"

  @REQ-EVD-05 @error @rk-opt-14
  Scenario: A location-based target against a market-based upstream compares the energy and not the carbon
    Given a subject declaration whose upstream chain is 1 declarations deep
    And the upstream declaration has target-type "tenant"
    And the subject declares "carbon-accounting" "location-based" and the upstream declares "carbon-accounting" "market-based"
    When the consumer compares the subject with its upstream
    Then the comparison covers "energy-consumption" only
    And the findings are worded as conditional on the target's scope covering what the upstream delivers

  @REQ-EVD-05 @edge @rk-opt-14
  Scenario: Two upstreams are compared one by one and never summed against the target
    Given a subject declaration with 2 upstream entries, each a distinct declaration with target-type "tenant"
    When the consumer compares the subject with its upstream
    Then there are 2 comparisons
    And no comparison sums the upstreams

  @REQ-SEC-01 @golden
  Scenario: The body the publisher serves is plain UTF-8 JSON with no compression of its own
    Given a valid declaration object
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data"
    Then the body is a JSON object
    And the header "Content-Encoding" is not present

  @REQ-SEC-01 @REQ-BDY-07 @error @req-9201dff3
  Scenario: A member that would carry executable content is not defined, and an undefined member is refused
    Given a publisher given the member "script" as the string "alert(1)"
    When the publisher builds the declarations
    Then the publisher refuses and names "script"

  @REQ-SEC-01 @edge
  Scenario: A content coding comes only from the web server in front of the publisher
    Given a valid declaration object
    And the publisher is served on a local port behind a web server that compresses with "gzip"
    When I send GET "/.well-known/sustainability-data" accepting "gzip"
    Then the header "Content-Encoding" is "gzip"
    And the decoded body is a JSON object

  @REQ-SEC-04 @golden @rk-lim-1
  Scenario: A certificate for the right host name from a trusted test CA is accepted
    Given a local TLS server with a certificate for "localhost" from the trusted test CA
    When the consumer fetches the local TLS origin
    Then the fetch status is "ok"

  @REQ-SEC-04 @error @rk-lim-1
  Scenario Outline: A certificate that does not verify makes the fetch fail, and no body is read
    Given a local TLS server with <certificate>
    When the consumer fetches the local TLS origin
    Then the fetch did not succeed
    And no body was read from the server

    Examples:
      | certificate                                                         |
      | an expired certificate from the trusted test CA for "localhost"      |
      | a certificate from the trusted test CA for the host name "other.example" |
      | a self-signed certificate for "localhost"                            |
      | a certificate for "localhost" from an issuer that is not trusted     |

  @REQ-SEC-04 @edge @rk-lim-1
  Scenario Outline: The consumer's options have no member that switches certificate verification off
    When the options of the consumer's fetch are listed
    Then the consumer options have no member named "<member>"

    Examples:
      | member             |
      | rejectUnauthorized |
      | insecure           |

  @REQ-SEC-04 @edge @rk-lim-1
  Scenario: The option that allows plain http for loopback does not relax certificate verification
    Given a local TLS server with a self-signed certificate for "localhost"
    When the consumer fetches the local TLS origin allowing insecure transport
    Then the fetch did not succeed
    And no body was read from the server

  @REQ-SEC-05 @golden @UC-6.2
  Scenario: A response in which every object is signed passes the signed-only policy
    Given the declaration is an array of objects with periods "2026-01", "2026-02"
    And every object of the array is signed with Ed25519
    When the consumer expects every object signed
    Then the policy passes

  @REQ-SEC-05 @error @UC-6.2
  Scenario: One unsigned object among signed ones fails the policy and the failure names the object
    Given the declaration is an array of objects with periods "2026-01", "2026-02", "2026-03"
    And every object of the array is signed with Ed25519
    And the signed member is removed from the second object
    When the consumer expects every object signed
    Then the array is reported as having an unsigned object
    And the failure names the object 2

  @REQ-SEC-05 @edge @UC-6.2
  Scenario: An array of one object is judged the same way
    Given the object is signed with Ed25519
    And the signed member is removed
    When the consumer expects every object signed
    Then the array is reported as having an unsigned object
    And the failure names the object 1

  @REQ-SEC-07 @golden @UC-7.1
  Scenario: At the gateway clock a range over the live window returns every held object
    Given the reference gateway is running
    When I send GET "/.well-known/sustainability-data?start=2026-07-30T00:00:00Z&end=2026-10-17T00:00:00Z"
    Then the status is 200
    And the body is a JSON array of 83 objects

  @REQ-SEC-07 @error @UC-7.1
  Scenario: A publisher whose maximum is 10 refuses to be built over 11 held objects
    Given an extended publisher with a maximum of 10 objects holding 11 periods
    Then building the publisher is refused and the message names "maxObjects"

  @REQ-SEC-07 @edge @UC-7.1
  Scenario: Whatever the clock, the gateway holds at most 200 objects, so no selection is cut
    Given the reference gateway is running
    And the clock moves to "2027-12-31T12:00:00Z"
    When I send GET "/.well-known/sustainability-data?granularity=daily"
    Then the gateway holds at most 200 objects
    And the body is a JSON array of 120 objects

  @REQ-PRV-01 @req-23ad5bde @golden
  Scenario Outline: The tool warns about each of the four disclosures a declaration can make
    Given the create-sustainability-data tool is given the default answers
    When the create-sustainability-data tool runs
    Then the tool prints a warning about "<disclosure>"

    Examples:
      | disclosure                    |
      | capacity and load patterns    |
      | precise metrics hardware      |
      | which services and paths exist |
      | contact strings               |

  @REQ-PRV-01 @req-23ad5bde @error
  Scenario: An adapter given a column it was not configured to map publishes nothing for it
    Given a CSV adapter with its documented columns
    And a CSV with a column "home-address"
    When the CSV adapter reads it
    Then the published object has no member "home-address"

  @REQ-PRV-01 @req-23ad5bde @edge
  Scenario: Access control stays the operator's, so the publisher answers a request without credentials
    Given a valid declaration object
    And the publisher is served on a local port
    When I send GET "/.well-known/sustainability-data"
    Then the status is 200
    And the header "WWW-Authenticate" is not present

  @REQ-PRV-07 @req-23ad5bde @golden
  Scenario Outline: A role address in provider raises no warning
    Given a publisher given the member "provider" as the string "Example Corp (<address>)"
    When the publisher builds the declarations
    Then the operator was not warned about "provider"

    Examples:
      | address                  |
      | sustain@example.com      |
      | ops@example.com          |
      | esg@example.com          |
      | compliance@example.com   |

  @REQ-PRV-07 @req-23ad5bde @error
  Scenario Outline: A personal address in provider raises the personal-address warning
    Given a publisher given the member "provider" as the string "Example Corp (<address>)"
    When the publisher builds the declarations
    Then the operator was warned about "provider"

    Examples:
      | address                  |
      | jane.doe@example.com     |
      | j.smith@example.com      |

  @REQ-PRV-07 @req-23ad5bde @edge
  Scenario: A provider without any address raises no warning
    Given a publisher given the member "provider" as the string "Example Corp"
    When the publisher builds the declarations
    Then the operator was not warned about "provider"

  @REQ-PRV-07 @req-23ad5bde @edge
  Scenario: The tool advises aggregating or omitting a metric that could be linked to individual users
    Given the create-sustainability-data tool is given the default answers
    And the answer "functional-unit" is "per-user"
    When the create-sustainability-data tool runs
    Then the tool prints advice to aggregate or omit a metric that could be linked to individual users or small groups
