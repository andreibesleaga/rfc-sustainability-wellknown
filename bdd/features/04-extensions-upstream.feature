Feature: Extensions and upstream declarations
  Extension data travels under names that are absolute URIs and are never fetched; upstream
  declarations name a provider's declaration and a consumer may walk the chain, bounded.
  Draft -08 (posted 2026-10-09), sections "Extensions", "Upstream Declarations", "Consumer Considerations".

  @req-2a41a04d @req-470fc872
  Scenario: An https name under the definer's control is accepted, also when another party defined it
    Then the extension name "https://example.com/ext/water-use" is accepted
    And the extension name "https://other-party.example/spec#v1" is rejected
    And the extension name "https://other-party.example/spec" is accepted

  @req-c508ab7e
  Scenario Outline: A UUID URN name is lowercase and hyphenated, and the reserved UUIDs are not names
    Then the extension name "<name>" is <verdict>
    Examples:
      | name                                           | verdict  |
      | urn:uuid:6ba7b810-9dad-11d1-80b4-00c04fd430c8  | accepted |
      | urn:uuid:6BA7B810-9DAD-11D1-80B4-00C04FD430C8  | rejected |
      | urn:uuid:6ba7b8109dad11d180b400c04fd430c8      | rejected |
      | urn:uuid:00000000-0000-0000-0000-000000000000  | rejected |
      | urn:uuid:ffffffff-ffff-ffff-ffff-ffffffffffff  | rejected |
      | com.example.water                              | rejected |
      | http://example.com/ext                         | accepted |

  @req-cd1ce13b @req-794f2d51 @req-a2519ec9
  Scenario: A consumer never fetches a name or a value it does not implement
    Given a valid declaration object
    And the extension "https://example.com/ext/water-use" is "{\"litres\": 12, \"see\": \"https://example.com/do-not-fetch\"}"
    When the consumer validates it
    Then it is valid
    And the validator made no network request

  @req-d5507448
  Scenario: An extension value that is not an object is an error on that name: the tolerance rules are exhaustive
    Given a valid declaration object
    And the extension "https://example.com/ext/water-use" is "12"
    When the consumer validates it
    Then it is not valid
    And the errors mention "extensions"

  @req-a151d441
  Scenario: The reference gateway documents every extension name it serves
    Given the reference gateway is running
    When I send GET "/tenant-demo.example/.well-known/sustainability-data"
    Then the status is 200
    And the repository's gateway methodology lists every extension name of the served report

  @req-a6ff4c06
  Scenario: An upstream entry names an https declaration and may carry a role
    Given a valid declaration object with target-type "tenant" and target "tenant.example"
    And the upstream member names "https://host.example/.well-known/sustainability-data" with role "hosting"
    When the consumer validates it
    Then it is valid

  @req-a6ff4c06 @req-13e27a5a @req-cbc8f500
  Scenario: An upstream declaration that is not https is not usable
    Given a valid declaration object with target-type "tenant" and target "tenant.example"
    And the upstream member names "http://host.example/.well-known/sustainability-data" with role ""
    When the consumer validates it
    Then it is valid
    And the warnings mention "upstream"

  @req-51128dfd
  Scenario: A consumer may retrieve the upstream declaration and compare the same period
    Given a subject declaration whose upstream chain is 1 declarations deep
    When the consumer walks the upstream chain
    Then a comparison verdict is "consistent"
    And every comparison names the reporting-period it compared

  @req-51128dfd
  Scenario: A subject that reports less than its provider says it delivered is flagged, not corrected
    Given a subject declaration whose upstream chain is 1 declarations deep
    And the upstream declaration says it delivered more energy than the subject reports
    When the consumer walks the upstream chain
    Then a comparison verdict is "under-reported"

  @req-6b29203c @req-4f5fc3f6
  Scenario: A walk stops three declarations below the start
    Given a subject declaration whose upstream chain is 6 declarations deep
    When the consumer walks the upstream chain
    Then the deepest retrieved comparison has depth 3
    And at most 3 upstream declarations were retrieved

  @req-6b29203c
  Scenario: A walk never retrieves the same URI twice
    Given a subject declaration whose upstream chain loops back on itself
    When the consumer walks the upstream chain
    Then no upstream URI was retrieved twice
