Feature: Mandatory minimum supported service
  The Basic service every publisher provides: one HTTPS GET, one declaration, the headers the
  draft requires, and what a consumer may and may not accept.
  Draft -07, section "Mandatory Minimum Supported Service".

  Background:
    Given the reference gateway is running

  @req-addcb130 @req-1947d932 @req-b781809b @req-3bd371e9
  Scenario: A plain GET returns the declaration with the registered media type
    When I send GET "/.well-known/sustainability-data"
    Then the status is 200
    And the header "Content-Type" is "application/sustainability-data+json"
    And the header "X-Content-Type-Options" is "nosniff"
    And the header "Access-Control-Allow-Origin" is "*"
    And the body is a JSON object
    And the body validates as a declaration

  @req-130b8253
  Scenario: HEAD carries the same status and header fields and no body
    When I send HEAD "/.well-known/sustainability-data"
    Then the status is 200
    And the header "Content-Type" is "application/sustainability-data+json"
    And the header "ETag" is present
    And the body is empty

  @req-130b8253
  Scenario: HEAD and GET agree for a relayed subject too
    Then the subject "wikimedia.org" is served with the same headers for GET and HEAD

  @req-aeecb2eb
  Scenario: An origin that publishes nothing answers 404
    When I send GET "/nobody.example/.well-known/sustainability-data"
    Then the status is 404
    And the header "Content-Type" contains "application/json"
    And the header "X-Content-Type-Options" is "nosniff"

  @req-b2e98433
  Scenario: Any other method gets 405 with Allow
    When I send POST "/.well-known/sustainability-data"
    Then the status is 405
    And the header "Allow" is "GET, HEAD"

  @req-5d25d3af @req-4f1a55c9
  Scenario: A rate-limited request is refused the way HTTP says, with Retry-After
    Given a gateway with a rate limit of 2 requests per minute
    When I send 4 GET requests to "/.well-known/sustainability-data"
    Then one of the statuses is 429
    And the header "Retry-After" is present

  @req-50b85e9d @req-d86c92e6
  Scenario: The reference publisher does not redirect the well-known URI
    When I send GET "/.well-known/sustainability-data"
    Then the status is 200
    And the header "Location" is absent

  @req-e38d33df @req-9cf32c70
  Scenario: A consumer does not accept a declaration over plain HTTP
    When the consumer fetches the origin "http://127.0.0.1:9"
    Then the fetch did not succeed
    And the fetch outcome mentions "insecure"

  @req-e73cf54b
  Scenario: The consumer asks for the registered media type
    Given a local server that records request headers
    When the consumer fetches the local origin allowing insecure transport
    Then the fetch status is "ok"
    And the recorded request header "Accept" contains "application/sustainability-data+json"

  @req-49ec34e8
  Scenario: The consumer processes the registered media type as a declaration
    Given a local server that answers the well-known path with "application/sustainability-data+json" and status 200
    When the consumer fetches the local origin allowing insecure transport
    Then the fetch status is "ok"

  @req-49ec34e8
  Scenario: The consumer may still process the generic JSON type
    Given a local server that answers the well-known path with "application/json" and status 200
    When the consumer fetches the local origin allowing insecure transport
    Then the fetch status is "ok"

  @req-49ec34e8
  Scenario: A 200 with an unrelated media type is not a declaration
    Given a local server that answers the well-known path with "text/html" and status 200
    When the consumer fetches the local origin allowing insecure transport
    Then the fetch did not succeed

  @req-faf38e5f @req-d86c92e6
  Scenario: A followed redirect attributes the declaration to the final origin
    Given a local server that redirects the well-known path to another local origin
    When the consumer fetches the local origin allowing insecure transport
    Then the declaration is attributed to the second origin
