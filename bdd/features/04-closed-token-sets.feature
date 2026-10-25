Feature: Closed token sets
  Nine members take their value from a closed set. Strict mode rejects a value outside the set and names the set.
  Compatibility mode disregards or converts a value of a legacy form (measurement-method, functional-unit, carbon-unit, role, target-type)
  and reports it; an energy-unit, carbon-accounting or capabilities outside its set is invalid in both modes. Tokens are compared as strings.
  Draft -10, "Mandatory Members", "Optional Members", "Upstream Declarations", "Formal Definition".

  Background:
    Given the clock is fixed at "2026-10-24T12:00:00Z"

  # ---- measurement-method (4) ----

  @REQ-MTH-01 @rk-mand-3 @golden
  Scenario Outline: Each of the four measurement methods is accepted
    Given a valid declaration object
    And the member "measurement-method" is "<token>"
    When the consumer reads it in strict mode
    Then it is valid
    When the publisher builds a declaration with measurement-method "<token>"
    Then the published member "measurement-method" is "<token>"

    Examples: from the most to the least direct
      | token                |
      | hardware-metered     |
      | hardware-estimated   |
      | cloud-billing        |
      | third-party-modeled  |

  @REQ-MTH-01 @REQ-CMP-03 @UC-5.3 @rk-mand-3 @rk-cmp-1 @error
  Scenario Outline: A measurement method outside the four is invalid as served and is read as third-party-modeled in compatibility mode
    Given a valid declaration object
    And the member "measurement-method" is "<value>"
    When the consumer reads it in strict mode
    Then it is not valid
    And the errors mention "measurement-method"
    And the errors mention "hardware-metered, hardware-estimated, cloud-billing, third-party-modeled"
    When the consumer reads it in compatibility mode
    Then it is valid
    And the fetched member "measurement-method" is "third-party-modeled"
    And the member "measurement-method" is reported as disregarded

    Examples:
      | value                                                                                         |
      | spend-based                                                                                   |
      | metered                                                                                       |
      | estimated                                                                                     |
      | modeled                                                                                       |
      | fuel and electricity metered; woodland removals from an annual biomass inventory              |
      | Hardware-Metered                                                                              |
      | HARDWARE-METERED                                                                              |
      | hardware_metered                                                                              |
      | third-party modeled                                                                           |
      |                                                                                               |

  @REQ-MTH-01 @REQ-CMP-03 @UC-5.3 @rk-mand-3 @rk-cmp-1 @error
  Scenario Outline: A measurement method that is not a string is not converted in either mode
    Given a valid declaration object
    And the member "measurement-method" is <json>
    When the consumer reads it in compatibility mode
    Then it is not valid

    Examples:
      | json  |
      | 3     |
      | null  |
      | true  |
      | ["hardware-metered"] |

  @REQ-MTH-01 @REQ-CMP-02 @UC-1.2 @rk-mand-3 @rk-cmp-2 @error
  Scenario Outline: The publisher refuses a measurement method outside the four and names the upgrade tool
    Given a publisher given the measurement method "<value>"
    Then the publisher refuses to build it
    And the refusal names "third-party-modeled"
    And the refusal names "sustainability-publisher upgrade"

    Examples:
      | value                |
      | Hardware-Metered     |
      | spend-based          |
      | metered              |

  @REQ-MTH-04 @rk-mand-4 @golden
  Scenario Outline: Figures that combine methods carry the least direct token
    Then combining the methods "<methods>" gives "<token>"

    Examples: the order is hardware-metered, hardware-estimated, cloud-billing, third-party-modeled
      | methods                                        | token               |
      | hardware-metered                               | hardware-metered    |
      | hardware-metered, hardware-estimated           | hardware-estimated  |
      | hardware-metered, cloud-billing                | cloud-billing       |
      | hardware-estimated, cloud-billing              | cloud-billing       |
      | hardware-metered, third-party-modeled          | third-party-modeled |
      | cloud-billing, third-party-modeled             | third-party-modeled |
      | third-party-modeled, hardware-metered, cloud-billing | third-party-modeled |

  @REQ-MTH-04 @rk-mand-4 @edge
  Scenario Outline: An empty or unknown input gives the residual token
    Then combining the methods "<methods>" gives "third-party-modeled"

    Examples:
      |  methods                  |
      |                           |
      | metered                   |
      | hardware-metered, metered |

  @REQ-MTH-03 @rk-mand-4 @edge
  Scenario: Converting with an emission factor or allocating to a part of a target does not change the token
    Given a publisher given metered energy of 100 kWh and the grid factor of 400 gCO2e per kWh
    And the figures are allocated 20 percent to the path "/api/v1"
    When the publisher builds the declaration for "/api/v1"
    Then the published member "measurement-method" is "hardware-metered"

  # ---- functional-unit (12) ----

  @REQ-FUN-01 @REQ-SCI-01 @UC-4.2 @rk-opt-8 @rk-opt-7 @golden @req-c340c99a
  Scenario Outline: Each of the twelve functional units is accepted with a score
    Given a valid declaration object
    And the member "functional-unit" is "<unit>"
    And the member "sci-score" is the number 0.4
    When the consumer reads it in strict mode
    Then it is valid
    When the publisher builds a declaration with functional-unit "<unit>" and sci-score 0.4
    Then the published member "functional-unit" is "<unit>"
    And the published member "sci-score" is the number 0.4

    Examples: the draft's list; per-session and per-vcpu-hour are the two added in -10
      | unit              |
      | per-request       |
      | per-transaction   |
      | per-page-view     |
      | per-session       |
      | per-user          |
      | per-job           |
      | per-token         |
      | per-inference     |
      | per-gigabyte      |
      | per-gigabyte-hour |
      | per-vcpu-hour     |
      | per-device        |

  @REQ-FUN-01 @rk-opt-8 @error
  Scenario Outline: A functional unit outside the twelve is invalid as served
    Given a valid declaration object
    And the member "functional-unit" is "<unit>"
    And the member "sci-score" is the number 0.4
    When the consumer reads it in strict mode
    Then it is not valid
    And the errors mention "functional-unit"
    And the errors mention "per-vcpu-hour"

    Examples:
      | unit                             | why                                           |
      | per-thousand-requests            | a score is for one unit                       |
      | per-terabyte-day                 | not in the set                                |
      | per-visit                        | page-view is the token                        |
      | per-gigabyte-month               | the time belongs to the period                |
      | per-active-user-per-month        | the time belongs to the period                |
      | per-vcpu                         | not the vcpu-hour                             |
      | per-core-hour                    | not in the set                                |
      | per-query                        | request is the token                          |
      | per-kwh                          | not in the set                                |
      | request                          | no per- prefix                                |

  @REQ-CMP-03 @UC-5.3 @rk-opt-8 @rk-cmp-1 @error
  Scenario Outline: A functional unit outside the twelve that no rule converts is disregarded with its score in compatibility mode
    Given a valid declaration object
    And the member "functional-unit" is "<unit>"
    And the member "sci-score" is the number 0.4
    When the consumer reads it in compatibility mode
    Then it is valid
    And the member "functional-unit" is reported as disregarded
    And the member "sci-score" is reported as disregarded
    And the fetched object has no member "functional-unit"
    And the fetched object has no member "sci-score"

    Examples:
      | unit                      |
      | per-gigabyte-month        |
      | per-unit-lifecycle        |
      | per-active-user-per-month |
      | per-cluster-month         |
      | per-core-hour             |
      | per-kwh                   |
      | req                       |

  # ---- upstream role (6, optional) ----

  @REQ-UPS-02 @UC-3.1 @rk-opt-13 @golden @req-9299a528
  Scenario Outline: Each of the six roles is accepted, and a role is optional
    Given a valid declaration object
    And the upstream member names "https://provider.example/tenants/acme.json" with role "<role>"
    When the consumer reads it in strict mode
    Then it is valid

    Examples:
      | role        |
      | hosting     |
      | colocation  |
      | cloud       |
      | cdn         |
      | network     |
      | electricity |

  @REQ-UPS-02 @UC-3.1 @rk-opt-13 @golden @req-9299a528
  Scenario: An upstream entry for any other provider has no role
    Given a valid declaration object
    And the upstream member names "https://registry.example/dc-1.json" without a role
    When the consumer reads it in strict mode
    Then it is valid

  @REQ-UPS-02 @REQ-CMP-03 @UC-3.1 @rk-opt-13 @rk-cmp-1 @error @req-9299a528
  Scenario Outline: A role outside the six is invalid as served; compatibility mode keeps the entry and disregards the role
    Given a valid declaration object
    And the upstream member names "https://provider.example/t.json" with role "<role>"
    When the consumer reads it in strict mode
    Then it is not valid
    And the errors mention "role"
    When the consumer reads it in compatibility mode
    Then it is valid
    And the member "upstream[0].role" is reported as disregarded
    And the fetched object keeps the upstream entry "https://provider.example/t.json"

    Examples:
      | role        |
      | transit     |
      | Cloud       |
      | CDN         |
      | colo        |
      | datacenter  |
      | isp         |
      |             |

  # ---- target-type (9) ----

  @REQ-TTY-01 @rk-opt-1 @golden
  Scenario Outline: Each of the nine target types is accepted
    Given a valid declaration object with target-type "<type>" and target "<target>"
    When the consumer reads it in strict mode
    Then it is valid

    Examples:
      | type         | target                    |
      | origin       | example.com               |
      | path         | /api/v1                   |
      | organization | Acme Retail plc           |
      | facility     | Frankfurt data center 3   |
      | service      | inference-endpoint-eu     |
      | product      | Widget Pro 2              |
      | device       | sensor-7f3a               |
      | tenant       | acme                      |
      | data-source  | grid-intensity-feed       |

  @REQ-TTY-01 @REQ-CMP-03 @UC-5.3 @rk-opt-1 @rk-cmp-1 @error
  Scenario Outline: A target type outside the nine is invalid as served and is disregarded in compatibility mode
    Given a valid declaration object with target-type "<type>" and target "example.com"
    When the consumer reads it in strict mode
    Then it is not valid
    And the errors mention "target-type"
    When the consumer reads it in compatibility mode
    Then it is valid
    And the member "target-type" is reported as disregarded

    Examples:
      | type        |
      | datacenter  |
      | warehouse   |
      | Origin      |
      | site        |
      | region      |

  # ---- carbon-unit (3) ----

  @REQ-CAR-01 @rk-opt-3 @golden
  Scenario Outline: Each carbon unit is accepted and keeps the numbers as stated
    Given a valid declaration object
    And the member "carbon-footprint" is the number 4140
    And the member "carbon-unit" is "<unit>"
    When the consumer reads it in strict mode
    Then it is valid
    And the carbon is <grams> gCO2e

    Examples:
      | unit   | grams        |
      | gCO2e  | 4140         |
      | kgCO2e | 4140000      |
      | tCO2e  | 4140000000   |

  @REQ-CAR-01 @rk-opt-3 @error
  Scenario Outline: A carbon unit outside the three is invalid as served
    Given a valid declaration object
    And the member "carbon-footprint" is the number 4140
    And the member "carbon-unit" is "<unit>"
    When the consumer reads it in strict mode
    Then it is not valid
    And the errors mention "carbon-unit"
    And the errors mention "tCO2e"

    Examples:
      | unit    |
      | mtCO2e  |
      | MtCO2e  |
      | kgco2e  |
      | KgCO2e  |
      | lbCO2e  |
      | CO2e    |
      | tCO2    |

  @REQ-CAR-01 @REQ-CMP-03 @UC-5.3 @rk-opt-3 @rk-cmp-1 @error
  Scenario: An unrecognized carbon unit is invalid in strict and in compatibility mode
    Given a valid declaration object
    And the member "carbon-footprint" is the number 4140
    And the member "scope-1" is the number 100
    And the member "scope-2" is the number 200
    And the member "scope-3" is the number 300
    And the member "carbon-unit" is "lbCO2e"
    When the consumer reads it in strict mode
    Then it is not valid
    And the errors mention "carbon-unit"
    When the consumer reads it in compatibility mode
    Then it is not valid
    And the errors mention "carbon-unit"
    And the member "carbon-unit" is not reported

  # ---- energy-unit (4) ----

  @REQ-ENG-01 @rk-opt-2 @golden
  Scenario Outline: Each energy unit is accepted
    Given a valid declaration object
    And the member "energy-consumption" is the number 2.4
    And the member "energy-unit" is "<unit>"
    When the consumer reads it in strict mode
    Then it is valid
    And the energy is <kwh> kWh

    Examples:
      | unit | kwh         |
      | Wh   | 0.0024      |
      | kWh  | 2.4         |
      | MWh  | 2400        |
      | GWh  | 2400000     |

  @REQ-ENG-01 @rk-opt-2 @error
  Scenario Outline: An energy unit outside the four is invalid as served and stays invalid in compatibility mode
    Given a valid declaration object
    And the member "energy-consumption" is the number 2.4
    And the member "energy-unit" is "<unit>"
    When the consumer reads it in strict mode
    Then it is not valid
    And the errors mention "energy-unit"
    When the consumer reads it in compatibility mode
    Then it is not valid
    And the errors mention "energy-unit"

    Examples:
      | unit |
      | TWh  |
      | J    |
      | kwh  |
      | MWH  |
      | KWh  |

  # ---- carbon-accounting (2) and capabilities (2) ----

  @REQ-CAR-03 @rk-opt-4 @golden
  Scenario Outline: Each carbon-accounting value is accepted
    Given a valid declaration object
    And the member "carbon-accounting" is "<value>"
    When the consumer reads it in strict mode
    Then it is valid

    Examples:
      | value          |
      | location-based |
      | market-based   |

  @REQ-CAR-03 @rk-opt-4 @error
  Scenario Outline: A carbon-accounting value outside the two is invalid as served and stays invalid in compatibility mode
    Given a valid declaration object
    And the member "carbon-accounting" is "<value>"
    When the consumer reads it in strict mode
    Then it is not valid
    And the errors mention "carbon-accounting"
    When the consumer reads it in compatibility mode
    Then it is not valid
    And the errors mention "carbon-accounting"

    Examples:
      | value                |
      | hourly-market-based  |
      | Location-Based       |
      | location_based       |
      | residual-mix         |
      | spend-based          |

  @REQ-MND-03 @rk-mand-2 @error
  Scenario Outline: A capabilities value outside basic and extended is invalid as served and stays invalid in compatibility mode
    Given a valid declaration object
    And the member "capabilities" is "<value>"
    When the consumer reads it in strict mode
    Then it is not valid
    When the consumer reads it in compatibility mode
    Then it is not valid
    And the errors mention "capabilities"

    Examples:
      | value     |
      | advanced  |
      | Basic     |
      | EXTENDED  |
      | full      |

  # ---- case sensitivity, one scenario across every set ----

  # A cell written \uXXXX is decoded by the step before it is used.
  @REQ-BDY-10 @rk-body-4 @rk-mand-3 @error
  Scenario Outline: Tokens are compared as strings: a case variant, a trailing space or a Unicode look-alike is a different value
    Given a valid declaration object
    And the member "<member>" is "<value>"
    When the consumer reads it in strict mode
    Then it is not valid
    And the errors mention "<member>"

    Examples:
      | member               | value                    |
      | measurement-method   | Hardware-metered         |
      | measurement-method   | hardware-metered\u0020   |
      | measurement-method   | hardware\u2011metered   |
      | functional-unit      | Per-User                 |
      | functional-unit      | per-user\u200b          |
      | target-type          | Facility                 |
      | target-type          | facilitу            |
      | carbon-unit          | TCO2e                    |
      | carbon-unit          | tco2e                    |
      | energy-unit          | KWH                      |
      | carbon-accounting    | Market-based             |
      | capabilities         | Basic                    |

  @REQ-BDY-10 @rk-body-4 @edge
  Scenario: A token written with JSON escapes is the same token once decoded
    Given a local server whose body is a declaration with the raw member '"measurement-method": "hardware-metered"'
    When the consumer fetches the local origin allowing insecure transport
    Then the fetch status is "ok"
    And the fetched member "measurement-method" is "hardware-metered"

  # ---- combinations ----

  @REQ-CAR-01 @REQ-CAR-03 @rk-opt-3 @rk-opt-4 @golden
  Scenario Outline: Each carbon unit combines with each accounting method
    Given a valid declaration object
    And the member "carbon-footprint" is the number 610
    And the member "carbon-unit" is "<unit>"
    And the member "carbon-accounting" is "<accounting>"
    When the consumer reads it in strict mode
    Then it is valid

    Examples:
      | unit   | accounting     |
      | gCO2e  | location-based |
      | gCO2e  | market-based   |
      | kgCO2e | location-based |
      | kgCO2e | market-based   |
      | tCO2e  | location-based |
      | tCO2e  | market-based   |

  @REQ-CAR-01 @REQ-ENG-01 @rk-opt-2 @rk-opt-3 @golden
  Scenario Outline: Each energy unit combines with each carbon unit
    Given a valid declaration object
    And the member "energy-consumption" is the number 12
    And the member "energy-unit" is "<energy>"
    And the member "carbon-footprint" is the number 5
    And the member "carbon-unit" is "<carbon>"
    When the consumer reads it in strict mode
    Then it is valid
    And the energy and the carbon keep their own units

    Examples:
      | energy | carbon |
      | Wh     | gCO2e  |
      | Wh     | kgCO2e |
      | Wh     | tCO2e  |
      | kWh    | gCO2e  |
      | kWh    | kgCO2e |
      | kWh    | tCO2e  |
      | MWh    | gCO2e  |
      | MWh    | kgCO2e |
      | MWh    | tCO2e  |
      | GWh    | gCO2e  |
      | GWh    | kgCO2e |
      | GWh    | tCO2e  |

  @REQ-TTY-01 @REQ-UPS-02 @UC-4.1 @rk-opt-1 @rk-opt-13 @golden @req-9299a528
  Scenario: A colocation provider's facility is the target of a tenant-scoped upstream
    Given a valid declaration object with target-type "facility" and target "Frankfurt data center 3"
    And the member "measurement-method" is "hardware-metered"
    And the upstream member names "https://colo.example/tenants/acme.json" with role "colocation"
    When the consumer reads it in strict mode
    Then it is valid

  @REQ-FUN-01 @REQ-TTY-01 @REQ-MTH-01 @UC-4.2 @rk-opt-8 @rk-opt-1 @rk-mand-3 @golden
  Scenario Outline: A functional-unit example for each kind of target
    Given a valid declaration object with target-type "<type>" and target "<target>"
    And the member "measurement-method" is "<method>"
    And the member "functional-unit" is "<unit>"
    And the member "sci-score" is the number 0.4
    When the consumer reads it in strict mode
    Then it is valid

    Examples:
      | type         | target              | method              | unit              |
      | origin       | example.com         | third-party-modeled | per-page-view     |
      | path         | /checkout           | third-party-modeled | per-transaction   |
      | service      | chat-api            | hardware-estimated  | per-session       |
      | service      | inference-eu        | hardware-estimated  | per-token         |
      | service      | image-gen           | hardware-estimated  | per-inference     |
      | service      | batch-etl           | hardware-metered    | per-job           |
      | service      | object-store        | cloud-billing       | per-gigabyte-hour |
      | tenant       | acme                | cloud-billing       | per-vcpu-hour     |
      | product      | Widget Pro 2        | third-party-modeled | per-device        |
      | organization | Acme Retail plc     | third-party-modeled | per-user          |
      | service      | cdn-edge            | hardware-estimated  | per-gigabyte      |
      | service      | api                 | hardware-estimated  | per-request       |

  @REQ-FRM-02 @rk-mand-3 @rk-opt-1 @rk-opt-2 @rk-opt-3 @rk-opt-4 @rk-opt-8 @rk-opt-13 @golden
  Scenario: The closed sets agree in the code, the schemas and the CDDL
    Then the three arrays of the publisher token module equal the JTD enums of the schemas
    And they equal the alternatives of the CDDL rules for measurement-method, functional-unit and role
    And the publisher and consumer token modules are byte-identical
    And target-type has nine tokens, carbon-unit three, energy-unit four, carbon-accounting two
    And functional-unit has twelve tokens

  @REQ-FRM-02 @rk-opt-8 @edge
  Scenario: The kit allow-lists equal the sets
    Then the Railway one-click, the WordPress plugin and the create-sustainability-data tool list exactly the four measurement methods
    And the report-to-declaration tool lists a subset of them

  # ---- adapters and tools use the closed sets as defined; upstream shape ----

  @REQ-MTH-02 @golden @rk-mand-3
  Scenario Outline: Each adapter input kind gets the token whose definition its source meets
    Given an adapter input of kind "<source>"
    When the adapter reads it
    Then the object's "measurement-method" is "<token>"

    Examples:
      | source                        | token               |
      | utility bill                  | hardware-metered    |
      | Kepler energy counters        | hardware-estimated  |
      | cloud provider invoice        | cloud-billing       |
      | grid-factor model             | third-party-modeled |

  @REQ-MTH-02 @error @rk-mand-3
  Scenario: An adapter that labels a modeled figure hardware-metered fails the reviewed token table
    Given an adapter that labels the input kind "grid-factor model" as "hardware-metered"
    When the reviewed token table check runs
    Then the check fails
    And the check message mentions "grid-factor model"

  @REQ-MTH-02 @edge @rk-mand-3
  Scenario: A hosting provider's invoice is cloud-billing even when the provider estimated it
    Given an adapter input of kind "hosting provider invoice estimated by the provider"
    When the adapter reads it
    Then the object's "measurement-method" is "cloud-billing"

  @REQ-MTH-05 @golden @rk-mand-4
  Scenario: An object that carries only an evidence link carries the token of the figures it describes
    Given a valid declaration object
    And every metric member and both evidence links are removed
    And the member "disclosure-uri" is "https://example.com/evidence"
    And the member "measurement-method" is "hardware-metered"
    When the consumer reads it in strict mode
    Then it is valid

  @REQ-MTH-05 @error @rk-mand-4
  Scenario: An evidence-only object without a measurement-method is refused
    Given a valid declaration object
    And every metric member and both evidence links are removed
    And the member "disclosure-uri" is "https://example.com/evidence"
    And the member "measurement-method" is removed
    When the consumer reads it in strict mode
    Then it is not valid
    And the errors mention "measurement-method"

  @REQ-MTH-05 @edge @rk-mand-4
  Scenario: An object with both links carries one token
    Given a valid declaration object
    And every metric member and both evidence links are removed
    And the member "disclosure-uri" is "https://example.com/evidence"
    And the member "verifiable-attestation-uri" is "https://verify.example/vc/42"
    And the member "measurement-method" is "cloud-billing"
    When the consumer reads it in strict mode
    Then it is valid
    And the member "measurement-method" is read back as "cloud-billing"

  @REQ-TTY-02 @golden @rk-opt-1
  Scenario Outline: The tools offer exactly the nine target types, and an example of each validates
    Given a valid declaration object with target-type "<type>" and target "<target>"
    When the consumer reads it in strict mode
    Then it is valid
    And the create-sustainability-data tool offers the target-type "<type>"
    And the target-types the create-sustainability-data tool offers are exactly the nine of the draft

    Examples:
      | type         | target                  |
      | organization | Acme Corporation        |
      | facility     | Frankfurt data center 3 |
      | origin       | example.com             |
      | path         | /api/v1                 |
      | service      | Acme Search             |
      | product      | Acme Widget 3           |
      | device       | sensor-7f3a             |
      | tenant       | tenant-4711             |
      | data-source  | grid-intensity-feed     |

  @REQ-TTY-02 @error @rk-opt-1
  Scenario: The tool refuses a tenth target type and names the nine
    Given the create-sustainability-data tool is given the default answers
    And the answer "target-type" is "region"
    When the create-sustainability-data tool runs
    Then the tool refuses and names "organization"
    And the tool refuses and names "data-source"
    And no output file was written

  @REQ-TTY-02 @REQ-EVD-04 @edge @rk-opt-14
  Scenario Outline: Tenant is the only target type whose upstream declaration is compared
    Given a subject declaration whose upstream chain is 1 declarations deep
    And the upstream declaration has target-type "<type>"
    When the consumer walks the upstream chain
    Then <outcome>

    Examples:
      | type         | outcome                         |
      | tenant       | a comparison verdict is "consistent" |
      | organization | no comparison is made           |
      | facility     | no comparison is made           |

  @REQ-FUN-02 @golden @rk-opt-8
  Scenario: 1.5e9 bytes is 1.5 gigabytes
    Given a publisher given 1500000000 bytes transferred
    When the publisher derives the per-gigabyte quantity
    Then the derived quantity is 1.5

  @REQ-FUN-02 @error @rk-opt-8
  Scenario: A conversion that divides bytes by 2 to the power 30 fails the unit test
    Given a conversion that divides bytes by 2^30
    When the unit-conversion test runs
    Then the test fails
    And the test message mentions "10^9"

  @REQ-FUN-02 @edge @rk-opt-8
  Scenario: One gibibyte of input is 1.073741824 gigabytes
    Given a publisher given 1073741824 bytes transferred
    When the publisher derives the per-gigabyte quantity
    Then the derived quantity is 1.073741824

  @REQ-FUN-04 @golden @rk-opt-8
  Scenario: A score in a unit that is not listed goes in an extension, and the object is valid
    Given a valid declaration object
    And the extension "https://acme.example/ext/score-per-minute" is '{"score": 0.4, "unit": "per-minute"}'
    When the consumer reads it in strict mode
    Then it is valid
    And the object has no "sci-score" and no "functional-unit"

  @REQ-FUN-04 @error @rk-opt-8
  Scenario: A functional-unit outside the twelve is refused and the twelve are named
    Given a valid declaration object with "functional-unit" "per-minute" and "sci-score" 0.4
    When the consumer reads it in strict mode
    Then it is not valid
    And the errors mention "functional-unit"
    And the errors mention "per-vcpu-hour"

  @REQ-FUN-04 @REQ-MIN-01 @edge @req-7f33240f @rk-opt-8
  Scenario: A score in an extension is not a metric for the minimum-content rule
    Given a valid declaration object
    And every metric member and both evidence links are removed
    And the extension "https://acme.example/ext/score-per-minute" is '{"score": 0.4, "unit": "per-minute"}'
    When the consumer reads it in strict mode
    Then it is not valid

  @REQ-FUN-05 @golden
  Scenario: The methodology stub asks what counts as one unit when a score is given
    Given the create-sustainability-data tool is given the default answers
    And the answer "functional-unit" is "per-request"
    And the answer "sci-score" is "0.012"
    When the create-sustainability-data tool runs
    Then the methodology stub has the heading "what counts as one unit"

  @REQ-UPS-01 @golden @rk-opt-13
  Scenario: An upstream with two entries, each with a declaration, is accepted
    Given a valid declaration object
    And the upstream member names "https://cloud.example/tenants/acme.json" with role "cloud"
    And the upstream member names "https://cdn.example/tenants/acme.json" with role "cdn"
    When the consumer reads it in strict mode
    Then it is valid

  @REQ-UPS-01 @error @rk-opt-13
  Scenario Outline: An upstream that is empty, not an array, or has an entry without a declaration is invalid
    Given a valid declaration object
    And the member "upstream" is the JSON '<json>'
    When the consumer reads it in strict mode
    Then it is not valid
    And the errors mention "upstream"

    Examples:
      | json                                  |
      | []                                    |
      | {"declaration": "https://a.example/x.json"} |
      | [{}]                                  |
      | ["https://a.example/x.json"]          |

  @REQ-UPS-01 @edge @rk-opt-13
  Scenario: An upstream entry with an unknown member is valid, and the entry is kept
    Given a valid declaration object
    And the member "upstream" is the JSON '[{"declaration": "https://a.example/x.json", "weight": 0.5}]'
    When the consumer reads it in strict mode
    Then it is valid
    And the fetched object keeps the upstream entry "https://a.example/x.json"

  @REQ-UPS-03 @golden @rk-opt-13
  Scenario: A tenant declaration is served at a URI of the operator's choice with the registered media type
    Given a valid declaration object with target-type "tenant" and target "acme"
    And the publisher is served on a local port at the path "/tenants/acme.json"
    When I send GET "/tenants/acme.json"
    Then the status is 200
    And the header "Content-Type" is "application/sustainability-data+json"
    And the body validates as a declaration

  @REQ-UPS-03 @error @rk-opt-13
  Scenario: A tenant declaration whose target is empty is invalid
    Given a valid declaration object with target-type "tenant" and target "acme"
    And the member "target" is ""
    When the consumer reads it in strict mode
    Then it is not valid
    And the errors mention "target"

  @REQ-UPS-03 @edge @rk-opt-13
  Scenario: The target of a tenant declaration is an opaque identifier, not a host
    Given a valid declaration object with target-type "tenant" and target "acme"
    When the consumer reads it in strict mode
    Then it is valid
    And there is no warning mentioning "host"

  @REQ-UPS-04 @golden @rk-opt-15
  Scenario: A chain of two declarations is followed with the same rules as the first
    Given a subject declaration whose upstream chain is 2 declarations deep
    When the consumer walks the upstream chain
    Then the walk completes
    And exactly 2 upstream declarations were retrieved

  @REQ-UPS-04 @error @rk-opt-15
  Scenario: An upstream that answers text/html is reported and not parsed
    Given a subject declaration whose upstream answers with the media type "text/html"
    When the consumer walks the upstream chain
    Then the upstream is reported as not retrieved
    And the upstream reason mentions "media type"

  @REQ-UPS-04 @edge @rk-opt-15
  Scenario: An upstream served at a path that is not the well-known path is retrieved
    Given a subject declaration whose upstream is served at "/tenants/acme.json"
    When the consumer walks the upstream chain
    Then the walk completes
    And the upstream declaration was retrieved from "/tenants/acme.json"
