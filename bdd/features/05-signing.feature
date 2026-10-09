Feature: Signing and verification
  The optional signed member is a JWS over the object itself. A consumer verifies bytes and
  key continuity, never accuracy. Draft -08 (prepared; -07 posted), sections "Signing", "The signed Member",
  "Verification", "What a Signature Proves", "Media Type Registration".

  @req-5c792780 @req-68ff48e7
  Scenario: An unsigned object is simply unsigned, and still a declaration
    Given a valid declaration object
    When the consumer validates it
    Then it is valid
    When the consumer verifies the signature
    Then the signature status is "unsigned"

  @req-35cfba2b @req-cbe48a93 @req-1bbed76b @req-c427596c @req-c9d470af
  Scenario Outline: A declaration signed with a recommended algorithm verifies, with the key in the header
    Given a valid declaration object
    And the object is signed with <alg>
    Then the signature header carries the public key as jwk
    When the consumer verifies the signature
    Then the signature status is "verified"
    And the verified payload carries no signed member
    Examples:
      | alg   |
      | EdDSA |
      | ES256 |

  @req-318bd979 @req-7b2bab02
  Scenario: Every object of a trend array carries its own signature
    Given the declaration is an array of objects with reporting-periods "2026-01,2026-02"
    And every object of the array is signed with EdDSA
    When the consumer verifies every signature of the array
    Then every signature status is "verified"

  @req-6f6e388c @req-fa97b1c8
  Scenario: An object changed after signing is reported as modified, and the served members stay in use
    Given a valid declaration object
    And the object is signed with EdDSA
    And after signing, the member "energy-consumption" is changed to "999"
    When the consumer verifies the signature
    Then the signature status is "verified"
    And the object is reported as modified after signing
    And the members in use are the ones the origin served, not the payload
    And the data is not reported as true or verified-accurate

  @req-26a25d5a @req-07d513cf
  Scenario Outline: alg none and MAC algorithms are rejected
    Given a valid declaration object
    And the signed member is a JWS with alg "<alg>"
    When the consumer verifies the signature
    Then the signature status is "unverified"
    Examples:
      | alg   |
      | none  |
      | HS256 |

  @req-c427596c @req-07d513cf
  Scenario: A signature without cty is rejected
    Given a valid declaration object
    And the signed member's cty is absent
    When the consumer verifies the signature
    Then the signature status is "unverified"

  @req-07d513cf
  Scenario: A signature whose cty names another media type is rejected
    Given a valid declaration object
    And the signed member's cty is "text/plain"
    When the consumer verifies the signature
    Then the signature status is "unverified"

  @req-c427596c
  Scenario: The cty may carry the application/ prefix; it still identifies this media type
    Given a valid declaration object
    And the signed member's cty is "application/sustainability-data+json"
    When the consumer verifies the signature
    Then the signature status is "verified"

  @req-168cf6a4
  Scenario: A payload that itself carries a signed member is rejected
    Given a valid declaration object
    And the signed member's payload itself carries a signed member
    When the consumer verifies the signature
    Then the signature status is "unverified"
    And the signature reason mentions "payload-carries-signed"

  @req-fa97b1c8
  Scenario: A payload that is not a declaration leaves the object unverified
    Given a valid declaration object
    And the signed member's payload is not a declaration
    When the consumer verifies the signature
    Then the signature status is "unverified"
    And the signature reason mentions "payload-not-declaration"

  @req-be2768a0
  Scenario: A payload about a different period is unverified
    Given a valid declaration object
    And the signed member's payload has reporting-period "2020-01"
    When the consumer verifies the signature
    Then the signature status is "unverified"
    And the signature reason mentions "payload-subject-mismatch"

  @req-256d3643
  Scenario: A key presented only as x5c is never promoted without an anchor
    Given a valid declaration object
    And a signed object whose header carries x5c and no jwk
    When the consumer verifies the signature
    Then the payload is never promoted over the served members

  @req-366595ae @req-a86d502c @req-73d31e3d
  Scenario: A verified signature keeps the served members in use and claims nothing about accuracy
    Given a valid declaration object
    And the object is signed with EdDSA
    When the consumer verifies the signature
    Then the signature status is "verified"
    And the members in use are the ones the origin served, not the payload
    And the data is not reported as true or verified-accurate

  @req-318bd979 @req-c9d470af
  Scenario: The reference gateway's own report arrives signed and intact through its HTTP path
    Given the reference gateway is running
    When I send GET "/.well-known/sustainability-data"
    Then the status is 200
    And the object carries a signed member
    And the body's signature verifies
