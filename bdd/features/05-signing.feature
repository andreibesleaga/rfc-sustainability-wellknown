Feature: Signing and verification
  The optional signed member is a JWS over the object itself, without the signed member. The publisher emits
  Ed25519. The consumer verifies Ed25519 and ES256, and still verifies the deprecated EdDSA with a note. A
  verified signature shows integrity and, with a trusted key, continuity of authorship; never accuracy.
  Draft -10, "The signed Member", "Verifying a Signature", "Security Considerations".

  Background:
    Given the clock is fixed at "2026-10-24T12:00:00Z"
    And a valid declaration object

  # ---- what the publisher emits ----

  @REQ-SIG-01 @REQ-SIG-03 @REQ-SIG-04 @REQ-SIG-05 @UC-6.1 @rk-sig-1 @rk-sig-2 @rk-sig-3 @golden @req-0a3342fc @req-2a853416 @req-6b141664
  Scenario: The publisher signs with Ed25519 by default, and the header is complete
    Given the object is signed by the publisher with its default key
    Then the signature header "alg" is "Ed25519"
    And the signature header "cty" is "sustainability-data+json"
    And the signature header carries the public key as jwk
    And the signature header carries no private key member
    When the consumer verifies the signature
    Then the signature status is "verified"
    And the verified payload carries no signed member
    And the signature note does not mention "deprecated"

  @REQ-SIG-03 @rk-sig-2 @error @req-0a3342fc
  Scenario Outline: The publisher refuses to emit EdDSA
    When the publisher is asked to generate a signing key for "<alg>"
    Then the publisher refuses and names "Ed25519"

    Examples:
      | alg   |
      | EdDSA |
      | none  |
      | HS256 |

  @REQ-SIG-06 @UC-6.1 @rk-sig-1 @golden
  Scenario: The signature is regenerated in the same step as the object
    Given the object is signed by the publisher with its default key
    When the publisher rebuilds the object with "energy-consumption" 999
    Then the rebuilt object's signed payload has "energy-consumption" 999
    And the rebuilt object verifies

  @REQ-SIG-05 @rk-sig-1 @edge @req-2a853416
  Scenario: The signing key never appears in a published file
    Given the object is signed by the publisher with its default key
    Then the published text contains no member "d"
    And the published text contains no member "p", "q", "dp", "dq" or "qi"

  # ---- what the consumer accepts ----

  @REQ-VER-13 @UC-6.1 @rk-sig-2 @golden
  Scenario Outline: A declaration signed with Ed25519 or ES256 verifies, with the key in the header
    Given the object is signed with <alg>
    Then the signature header carries the public key as jwk
    When the consumer verifies the signature
    Then the signature status is "verified"
    And the signature note does not mention "deprecated"

    Examples:
      | alg     |
      | Ed25519 |
      | ES256   |

  @REQ-VER-13 @UC-6.1 @rk-sig-8 @edge
  Scenario: A -09 file signed with EdDSA still verifies, with a deprecation note
    Given the object is signed with EdDSA
    When the consumer verifies the signature
    Then the signature status is "verified"
    And the signature note mentions "deprecated"
    And the signature note mentions "RFC 9864"
    And the reported algorithm is "EdDSA"

  @REQ-VER-13 @rk-sig-8 @edge
  Scenario: The same key verifies a token named Ed25519 and a token named EdDSA
    Given the object is signed with Ed25519 by key "K1"
    And the same object is signed with EdDSA by key "K1"
    Then the two keys have the same thumbprint
    And both signatures verify

  @REQ-VER-13 @rk-sig-8 @rk-sig-7 @edge
  Scenario: The pinned-key path reports the algorithm of the token header
    Given the key "K1" is pinned from an earlier retrieval
    And the object is signed with EdDSA by key "K1"
    When the consumer verifies the signature
    Then the signature status is "verified"
    And the reported algorithm is "EdDSA"

  # ---- what the consumer rejects ----

  @REQ-VER-01 @UC-6.1 @rk-sig-2 @error @req-37bd6981
  Scenario Outline: alg none and every MAC algorithm are rejected
    Given the signed member is a JWS with alg "<alg>"
    When the consumer verifies the signature
    Then the signature status is "unverified"
    And the signature reason mentions "<alg>"

    Examples:
      | alg   |
      | none  |
      | None  |
      | HS256 |
      | HS384 |
      | HS512 |

  @REQ-VER-01 @REQ-VER-04 @rk-sig-2 @error @req-37bd6981
  Scenario: A MAC made with the public key as the secret does not verify
    Given the signed member is an HS256 JWS keyed with the bytes of the public key in its header jwk
    When the consumer verifies the signature
    Then the signature status is "unverified"

  @REQ-VER-02 @UC-6.1 @rk-sig-3 @error @req-37bd6981
  Scenario Outline: A signature without the right cty is rejected
    Given the object is signed with Ed25519
    And the signed member's cty is <cty>
    When the consumer verifies the signature
    Then the signature status is "unverified"
    And the signature reason mentions "cty"

    Examples:
      | cty                                  |
      | absent                               |
      | "JWT"                                |
      | "application/json"                   |
      | ""                                   |
      | "sustainability-data"                |

  @REQ-VER-02 @rk-sig-3 @edge @req-37bd6981
  Scenario: cty may carry the application/ prefix, which RFC 7515 treats as the same media type
    Given the object is signed with Ed25519
    And the signed member's cty is "application/sustainability-data+json"
    When the consumer verifies the signature
    Then the signature status is "verified"

  @REQ-VER-03 @rk-sig-4 @error @req-37bd6981
  Scenario Outline: A crit parameter the consumer does not understand is rejected
    Given the object is signed with Ed25519
    And the signed member's header carries crit <crit>
    When the consumer verifies the signature
    Then the signature status is "unverified"
    And the signature reason mentions "crit"

    Examples:
      | crit                         |
      | ["x-unknown"]                |
      | ["b64"]                      |
      | ["exp", "x-unknown"]         |

  @REQ-VER-04 @rk-sig-2 @error
  Scenario Outline: The algorithm comes from the key and the consumer's policy, never from alg alone
    Given the object is signed with <signed alg> by a key of type "<key type>"
    And the header says alg "<header alg>"
    When the consumer verifies the signature
    Then the signature status is "unverified"

    Examples:
      | signed alg | key type | header alg |
      | Ed25519    | OKP      | ES256      |
      | ES256      | EC       | Ed25519    |
      | ES256      | EC       | RS256      |

  @REQ-VER-11 @REQ-VER-12 @UC-6.1 @rk-sig-6 @error
  Scenario Outline: A damaged compact serialization leaves the object unverified and still usable
    Given the signed member is "<jws>"
    When the consumer verifies the signature
    Then the signature status is "unverified"
    And the object is still valid
    And the data is not reported as true or verified-accurate
    And the signed object is not reported as false or forged

    Examples:
      | jws                       |
      | not-a-jws                 |
      | a.b                       |
      | a.b.c.d                   |
      | ..                        |
      | e30.e30.AAAA              |

  # ---- the payload comparison ----

  @REQ-VER-05 @REQ-VER-06 @UC-6.1 @rk-sig-5 @rk-sig-6 @error @req-6f3b1824
  Scenario Outline: A payload that differs from the object in one of five members is unverified
    Given the object is signed with Ed25519
    And after signing, the object's "<member>" is changed to "<changed>"
    When the consumer verifies the signature
    Then the signature status is "unverified"
    And the signature reason mentions "<member>"
    And the members in use are the ones the origin served, not the payload

    Examples:
      | member            | changed                  |
      | target            | /api/v2                  |
      | period.start      | 2025-01-01T00:00:00+01:00 |
      | period.end        | 2026-01-02T00:00:00Z     |
      | carbon-accounting | market-based             |
      | functional-unit   | per-user                 |

  @REQ-VER-05 @rk-sig-6 @error @req-6f3b1824
  Scenario Outline: A payload that is not an object is unverified
    Given the signed member is a valid Ed25519 JWS whose payload is <payload>
    When the consumer verifies the signature
    Then the signature status is "unverified"

    Examples:
      | payload             |
      | "a string"          |
      | 42                  |
      | null                |
      | [{"target":"x"}]    |
      | the empty octets    |
      | not JSON            |

  @REQ-VER-06 @rk-sig-5 @edge @req-6f3b1824
  Scenario Outline: The five members are compared as strings, not as instants
    Given the object has period "2025-01-01T00:00:00Z" to "2026-01-01T00:00:00Z"
    And the object is signed with Ed25519
    And the object's served "<member>" is rewritten to the same instant as "<spelling>"
    When the consumer verifies the signature
    Then the signature status is "unverified"

    Examples: the same instant, a different string
      | member       | spelling                   |
      | period.start | 2025-01-01T00:00:00+00:00  |
      | period.start | 2025-01-01T00:00:00.000Z   |
      | period.start | 2025-01-01T01:00:00+01:00  |
      | period.end   | 2026-01-01T00:00:00+00:00  |
      | period.end   | 2026-01-01T08:00:00+08:00  |

  @REQ-VER-06 @rk-sig-5 @golden @req-6f3b1824
  Scenario: A member absent from both the payload and the object counts as equal
    Given the object has no "carbon-accounting" and no "functional-unit"
    And the object is signed with Ed25519
    When the consumer verifies the signature
    Then the signature status is "verified"

  @REQ-VER-06 @rk-sig-5 @error @req-6f3b1824
  Scenario Outline: A member present on one side only is a difference
    Given the object has no "<member>"
    And the object is signed with Ed25519
    And after signing, the member "<member>" is added to the served object as "<value>"
    When the consumer verifies the signature
    Then the signature status is "unverified"

    Examples:
      | member            | value          |
      | carbon-accounting | market-based   |
      | functional-unit   | per-request    |

  @REQ-VER-06 @UC-6.2 @rk-sig-5 @edge @req-6f3b1824
  Scenario Outline: A signature copied between twin objects of one target and period is unverified
    Given the declaration is an array of two objects of one target and one period:
      | carbon-accounting | functional-unit |
      | <a1>              | <f1>            |
      | <a2>              | <f2>            |
    And every object of the array is signed with Ed25519
    When the signed member of the first object is copied to the second
    And the consumer verifies every signature of the array
    Then the second object's signature status is "unverified"
    And the first object's signature status is "verified"

    Examples:
      | a1             | f1          | a2           | f2          |
      | location-based |             | market-based |             |
      | location-based | per-request | location-based | per-user  |
      |                | per-request |              | per-user    |

  @REQ-VER-09 @rk-sig-7 @golden
  Scenario: A change to an unrelated member after signing is reported as modified, and the served members stay in use
    Given the object is signed with Ed25519
    And after signing, the member "energy-consumption" is changed to "999"
    When the consumer verifies the signature
    Then the signature status is "verified"
    And the object is reported as modified after signing
    And the members in use are the ones the origin served, not the payload
    And the data is not reported as true or verified-accurate

  @REQ-VER-09 @rk-sig-7 @edge
  Scenario: provider is covered by the signature, and a changed provider is reported as modified
    Given the object is signed with Ed25519
    And after signing, the member "provider" is changed to "Someone Else Ltd"
    When the consumer verifies the signature
    Then the signature status is "verified"
    And the object is reported as modified after signing
    And the member "provider" is reported as modified

  # ---- key trust ----

  @REQ-VER-07 @REQ-VER-09 @UC-6.1 @rk-sig-7 @golden
  Scenario Outline: The payload takes precedence only when the key is trusted beyond the declaration
    Given the object is signed with Ed25519
    And after signing, the member "energy-consumption" is changed to "999"
    And the key was obtained <how>
    When the consumer verifies the signature
    Then the signature status is "verified"
    And the members in use <use>
    And the key trust level is "<level>"

    Examples:
      | how                                                       | use                                              | level        |
      | out of band                                               | are the payload's                                | out-of-band  |
      | pinned from an earlier retrieval                          | are the payload's                                | pinned       |
      | from an x5c chain to a trusted anchor, certificate naming the publisher | are the payload's                  | x5c-anchored |
      | from the header jwk                                       | are the ones the origin served, not the payload  | declaration-only |
      | from an x5c chain to an unknown anchor                    | are the ones the origin served, not the payload  | declaration-only |
      | from an x5c chain to a trusted anchor, certificate naming another host | are the ones the origin served, not the payload | declaration-only |
      | from an x5c chain with a self-signed end entity           | are the ones the origin served, not the payload  | declaration-only |

  @REQ-VER-14 @REQ-VER-07 @rk-sig-7 @edge
  Scenario: A key pinned from one retrieval makes a later re-signed object with another key unverified
    Given the key "K1" is pinned from an earlier retrieval
    And the object is signed with Ed25519 by key "K2" carried in its header
    When the consumer verifies the signature
    Then the signature status is "unverified"
    And the signature reason mentions "pin-mismatch"

  @REQ-VER-08 @REQ-VER-09 @rk-sig-7 @edge
  Scenario: kid alone, with no key out of band, cannot verify
    Given the object is signed with Ed25519 and a header with kid "k-2026" and no jwk and no x5c
    When the consumer verifies the signature
    Then the signature status is "unverified"
    And the signature reason mentions "key"

  @REQ-VER-07 @REQ-VER-08 @rk-sig-7 @golden
  Scenario: kid with the key obtained out of band verifies
    Given the object is signed with Ed25519 and a header with kid "k-2026" and no jwk and no x5c
    And the key "k-2026" was obtained out of band
    When the consumer verifies the signature
    Then the signature status is "verified"

  @REQ-VER-08 @rk-sig-7 @error
  Scenario Outline: A key URL in the JOSE header is never fetched and never counts as out of band
    Given the object is signed with Ed25519 and a header with <param> "https://keys.example/k.json" and no jwk and no x5c
    When the consumer verifies the signature
    Then the signature status is "unverified"
    And no connection is made to "keys.example"

    Examples:
      | param |
      | jku   |
      | x5u   |

  @REQ-VER-08 @REQ-SEC-12 @rk-sig-7 @error @req-0c34adda
  Scenario Outline: A key URL that points inside the network is not contacted either
    Given the object is signed with Ed25519 and a header with jku "<url>" and no jwk and no x5c
    When the consumer verifies the signature
    Then no connection is made to "<url>"

    Examples:
      | url                                   |
      | https://127.0.0.1/k.json              |
      | https://169.254.169.254/latest/meta-data |
      | https://10.0.0.5/k.json               |
      | https://localhost/k.json              |

  @REQ-VER-10 @rk-sig-7 @golden
  Scenario: provider is never matched against a certificate or a key
    Given the object has the member "provider" "Totally Different Name Ltd"
    And the object is signed with Ed25519 and the certificate subject is "example.com"
    And the key was obtained from an x5c chain to a trusted anchor, certificate naming the publisher
    When the consumer verifies the signature
    Then the signature status is "verified"
    And the verified result does not claim the provider name belongs to the key holder

  # ---- what a signature does and does not say ----

  @REQ-VER-12 @UC-6.1 @golden
  Scenario: An unsigned object is simply unsigned, and still a declaration
    When the consumer validates it
    Then it is valid
    When the consumer verifies the signature
    Then the signature status is "unsigned"
    And the data is not reported as true or verified-accurate

  @REQ-VER-11 @UC-6.1 @rk-agg-3 @golden
  Scenario: A verified signature is never presented as accuracy
    Given the object is signed with Ed25519
    When the consumer verifies the signature
    Then the signature status is "verified"
    And the presentation says the signature shows integrity and not accuracy
    And the data is not reported as true or verified-accurate

  @REQ-VER-12 @rk-sig-6 @error
  Scenario: A failed signature leaves the object unverified, never false, and the figures stay readable
    Given the object is signed with Ed25519
    And the last octet of the signature is flipped
    When the consumer verifies the signature
    Then the signature status is "unverified"
    And the object is still valid
    And the signed object is not reported as false or forged

  @REQ-SIG-02 @UC-6.2 @rk-sig-1 @golden
  Scenario: Every object of an array carries its own signature
    Given the declaration is an array of objects with periods "2026-01", "2026-02"
    And every object of the array is signed with Ed25519
    When the consumer verifies every signature of the array
    Then every signature status is "verified"
    And the two signed members differ

  @REQ-SEC-05 @REQ-VER-12 @UC-6.2 @rk-sig-1 @edge
  Scenario: A signature dropped from one object of an array shows only to a consumer that expects every object signed
    Given the declaration is an array of objects with periods "2026-01", "2026-02"
    And every object of the array is signed with Ed25519
    And the signed member is removed from the second object
    When the consumer verifies every signature of the array
    Then the second object's signature status is "unsigned"
    When the consumer expects every object signed
    Then the array is reported as having an unsigned object

  @REQ-VER-15 @UC-6.2 @rk-sig-1 @edge
  Scenario: The signature covers the object, not the array around it
    Given the declaration is an array of objects with periods "2026-01", "2026-02"
    And every object of the array is signed with Ed25519
    And the two objects are swapped in the array
    When the consumer verifies every signature of the array
    Then every signature status is "verified"
    And the consumer does not claim the order of the array was signed

  @REQ-SEC-06 @UC-6.1 @error
  Scenario: A replayed older signed object is recognized by the later updated the consumer already holds
    Given the object has "updated" "2026-03-01T12:00:00Z" and is signed with Ed25519
    And the consumer holds an object for the same target and period with "updated" "2026-06-01T12:00:00Z"
    When the consumer verifies the signature
    Then the signature status is "verified"
    And the object is reported as "replay-suspected"

  @REQ-SEC-06 @edge
  Scenario: A newer updated is not a replay
    Given the object has "updated" "2026-09-01T12:00:00Z" and is signed with Ed25519
    And the consumer holds an object for the same target and period with "updated" "2026-06-01T12:00:00Z"
    When the consumer verifies the signature
    Then the object is not reported as "replay-suspected"

  @REQ-VER-13 @REQ-UPS-04 @UC-5.5 @edge
  Scenario: Signature checks in the upstream walk use the same rules
    Given a subject declaration whose upstream chain is 1 declarations deep
    And the upstream declaration is signed with EdDSA
    When the consumer walks the upstream chain
    Then the upstream signature status is "verified"
    And the upstream signature note mentions "deprecated"

  # ---- JWS shape, key pin, what a signature covers ----

  @REQ-SIG-01 @golden @UC-6.1 @rk-sig-1
  Scenario: A signed object verifies, and its payload is the object without signed
    Given the object is signed with Ed25519
    When the consumer verifies the signature
    Then the signature status is "verified"
    And the verified payload carries no signed member

  @REQ-SIG-01 @error @UC-6.1 @rk-sig-1
  Scenario Outline: A signed value that is not a JWS Compact Serialization of three base64url parts is unverified
    Given the signed member is "<value>"
    When the consumer verifies the signature
    Then the signature status is "unverified"
    And the signed object is not reported as false or forged

    Examples:
      | value               |
      | not-a-jws           |
      | aaaa.bbbb           |
      | aaaa.bbbb.cccc.dddd |
      | aa aa.bbbb.cccc     |

  @REQ-SIG-01 @edge @UC-6.1 @rk-sig-1
  Scenario: The decoded payload is the publisher's serialization of the object without signed
    Given the object is signed with Ed25519
    When the consumer decodes the signed member
    Then the decoded payload is the JSON text of the object without the member "signed"

  @REQ-VER-14 @golden @UC-6.1 @rk-sig-7
  Scenario: The first retrieval pins the key
    Given the object is signed with Ed25519 by key "K1" carried in its header
    When the consumer verifies the signature and pins the key
    Then the signature status is "verified"
    And the key trust level is "declaration-only"

  @REQ-VER-14 @error @UC-6.1 @rk-sig-7
  Scenario: A re-signed object with a new key is reported pin-mismatch and the embedded key is not accepted
    Given the key "K1" is pinned from an earlier retrieval
    And the object is re-signed with Ed25519 by key "K2" carried in its header
    When the consumer verifies the signature
    Then the signature status is "unverified"
    And the signature reason mentions "pin-mismatch"
    And the key trust level is not "pinned"

  @REQ-VER-14 @edge @UC-6.1 @rk-sig-7
  Scenario: The original key keeps verifying after another key was refused
    Given the key "K1" is pinned from an earlier retrieval
    And the object is signed with Ed25519 by key "K1" carried in its header
    When the consumer verifies the signature
    Then the signature status is "verified"
    And the key trust level is "pinned"

  @REQ-VER-15 @golden @UC-6.1 @rk-sig-1
  Scenario: The output says what a verified signature covers
    Given the object is signed with Ed25519
    When the consumer verifies the signature
    Then the presentation says the signature protects the other members of its own object
    And the presentation says the signature shows integrity and not accuracy

  @REQ-VER-15 @error @UC-6.1 @rk-sig-1
  Scenario Outline: Wording that calls the header fields or the retrieval URI signed fails the wording test
    Given the published text "<text>"
    When the signature wording test runs
    Then the test fails
    And the test message mentions "<member>"

    Examples:
      | text                                         | member          |
      | The HTTP header fields are covered by the signature. | HTTP header fields |
      | The retrieval URI is signed.                 | retrieval URI   |
      | The whole array is signed.                   | array           |

  @REQ-VER-15 @edge @UC-6.2 @rk-sig-1
  Scenario: An array with one signed and one unsigned object reports each separately
    Given the declaration is an array of objects with periods "2026-01", "2026-02"
    And every object of the array is signed with Ed25519
    And the signed member is removed from the second object
    When the consumer verifies every signature of the array
    Then the first object's signature status is "verified"
    And the second object's signature status is "unsigned"
