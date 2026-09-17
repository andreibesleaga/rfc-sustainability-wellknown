# Why -07 changed what it changed

Status: `-07` is **not yet posted**. `-06` is the latest posted revision. (Update this line when
`-07` is submitted.)

For the Independent Submissions Editor, the reviewer, and implementers: every substantive change
in `-07`, its trigger, what it costs a `-06` publisher or consumer to move, and what reversing it
would involve. Names below are `-07` section titles.

## Summary

`-07` has three sources. The first is the Editor's review of `-06` (E1 to E14 below). The second
is the commissioned review of `-05` (A1 to A19), where several points had been answered only in
part. The third is the reference implementation: the publisher, consumer and gateway were
rewritten against the `-07` text before it was finalized, and that found 37 specification
defects, four of them serious.

The largest structural change is that the detached signature resource of `-06` is withdrawn and
signing moved inside the declaration, so one registered well-known URI now yields one file. The
data model changed for the first time since `-04`: `version` is gone, the member set is closed,
and private extensions live under a URI-keyed member. Two capabilities were added, `upstream`
declarations and a stricter at-least-one rule; two provisions were removed, the server-side array
cap and the `X-Content-Type-Options` recommendation. The query parameters gained a grammar and a
numbered procedure with defined error outcomes. The body is about a quarter shorter: 9,803 words
against 13,010 in `-06`, measured the same way on both files.

## Change table

"Implementation" means the defect was found by building the reference software against the text.

| # | Change | Trigger | Draft section | Cost to move | Reversal |
|---|---|---|---|---|---|
| 1 | Signing moved inside the document | E4; owner; implementation | Signing | One file instead of two | Signing; one member row; one CDDL and one JTD line; one module per library |
| 1a | Precedence conditional on key trust | implementation | Verification | None | One paragraph; one consumer branch |
| 2 | `version` removed; member set closed | A10; E8; owner | Mandatory Members | Delete one member; `-06` documents still read | One member row; two schema lines; one constant per package |
| 3 | Extensions keyed by URI | E8; A11 | Extensions | Move extension members under a URI the definer controls, or a `urn:uuid:` name | Extensions; CDDL `ext-name` rule; JTD entry; one key validator per package |
| 4 | `upstream`, tenant declarations, bounded walk | E11; A5; A18; implementation | Upstream Declarations | None; the member is optional | Upstream Declarations; one member row; one schema entry; the chain walker |
| 5 | At-least-one rule replaces retrievability | E13; E12b; A8 | Value Constraints and Omitted Metrics | A metric-less publisher adds a figure or an evidence link | One paragraph; one branch per validator |
| 6 | Array cap and nosniff removed | E10; E6 | Denial of Service | None | One bullet each |
| 7 | Query parameters formalized | E7; implementation | Extended Query Parameters | A server answers 400 where it once had a choice | One numbered step per rule; one publisher function |
| 8 | Tolerance narrowed to optional members | implementation | Value Constraints and Omitted Metrics | None | One paragraph |
| 9 | Service-level rules re-cut | E5; A3; A5; implementation | Mandatory Minimum Supported Service | None | One bullet each |
| 10 | Noise disclosure raised to MUST | owner; implementation | Privacy Considerations | A publisher applying noise says so | One bullet |
| 11 | Text reduction, terminology, appendices | E1; E2; E3; E9; E12a; E14 | throughout | None | Editorial |

Each reversal is one edit site per package, because every path, media type, algorithm, `cty`
value, extension-key pattern and bound is a named constant in a single module, and the schemas
have one canonical copy that CI compares against the draft.

## 1. Signing moved inside the document

`-06` published a detached JWS at a second well-known resource, `sustainability-data.jws`, with
its own registry entry. `-07` withdraws that resource, that registration and the detached form,
with no legacy support. The declaration object instead carries an OPTIONAL `signed` member, a JWS
in Compact Serialization over the object minus `signed`, with `cty` naming the media type this
document already registers, in place of the `application/jose` type the detached form used.

Trigger: E4, that the use of `.well-known` was not economical, plus the Editor's concern about an
optional detached signature; the owner chose to go further than the two resources proposed.
Implementation supplied the evidence: within days of enabling the detached signature on the
reference deployment, the platform's edge cache served the document and its separate signature
resource independently, one cache entry per content coding with no purge, so a consumer could
receive a stale document with a fresh signature and report it unverified.

## 1a. Precedence is conditional on key trust

The first `-07` text followed RFC 8414's `signed_metadata` unconditionally: the verified payload
always won. Implementation showed this let a self-asserted payload override origin-authenticated
members, so anyone able to add one member could replace every figure and have the signature make
the substitution authoritative.

Precedence now depends on the key. Obtained out of band (the draft defines this as a source the
consumer selected independently of the declaration, never a URI the declaration or its JOSE
Header names), pinned from an earlier retrieval, or validated through an `x5c` chain to a trusted
anchor whose certificate identifies the publisher: the payload takes precedence, the RFC 8414
pattern. Pinning establishes continuity, not identity; the precedence rests on that continuity,
that the same holder signed the earlier declaration, and not on knowing who that holder is. In
every other case the key is trusted no further than the declaration carrying it: the members
served by the origin remain the ones the consumer uses, and the signature gives integrity and key
continuity only. A consumer that promotes an `x5c`-validated key MUST also require that the
certificate identify the publisher, since a chain to a widely trusted anchor otherwise
establishes only that some party holds a certificate. Either way a consumer MAY report a
difference as evidence of modification after signing, which is not a failure.

RFC 8725 moves to the normative references in `-07`. The verification rule under a MUST relies on
it for the algorithm policy, so a reader has to have it.

## 2. `version` removed; the member set closed

`-06` fixed `version` at the single value `"2.0"`. It carried no processing consequence, and A10
asked how a publisher would learn a new value. `-07` removes it: the media type identifies the
format, and an incompatible format would take a new media type. Mandatory members drop from eight
to seven. The top-level set is now closed, the other half of E8: a publisher MUST NOT add other
top-level members.

A `-07` consumer reads a `-06` document unchanged, ignoring `version` as it ignores any
unrecognized top-level member; that ignore rule is retained so a later revision can add members.

## 3. Extensions keyed by URI

`-06` allowed reverse-domain top-level names such as `com.example.pue`. E8 asked for a naming
model rather than a free-for-all; A11 asked what happens when the domain belongs to another
party, is lost, or diverges. `-07` withdraws reverse-domain top-level names and defines an
`extensions` object whose member names are extension names: absolute URIs (RFC 3986, Section
4.3), written in ASCII with the scheme in lowercase and carrying no fragment, whose values are
objects. Two forms are the ones used in practice: an "https" URI under the definer's control when the name was minted, which
SHOULD identify human-readable documentation of the extension, and a UUID URN, `urn:uuid:`
followed by the hyphenated form of a UUID (RFC 9562, Section 4; Nil and Max excluded) in
lowercase, which that section permits in either case and which this document fixes as lowercase
so that names compare octet for octet, for a definer that has no domain or wants a name
independent of any domain. A name is compared as
a string, octet for octet, and never normalized. A name is an identifier, not a locator: nothing
is fetched from it, no registry is defined, and a consumer that does not implement a name MUST
ignore its value and MUST NOT dereference the name or anything within the value. The methodology
document SHOULD list the extension names a publisher uses, each with its definition or a pointer
to it.

The model is not new: RFC 7519, Section 2 defines a Collision-Resistant Name as one taken from a
namespace the definer controls when it mints the name, naming domain names, object identifiers
and UUIDs as examples, and Section 4.2 keys public JWT claims that way, while RFC 7643 keys SCIM
extension schemas by URN. RFC 8288, Section 2.1.2 does the same for extension link relation
types, which are URIs compared as strings and need not be dereferenceable, and that is the shape
here too: a closed set of defined members plus URI-named extensions beside it.

That answers A11. A key is an identifier compared as a string, not a lookup, so a domain changing
hands, lapsing or diverging later does not change what an already published document means, and
`urn:uuid:` is there for a definer with no domain at all. Divergence is where a bare UUID fell
short: it carried no authority to settle whose meaning applies, whereas a URI names the party
that defined the members, and the https form leads a reader to the definition.

Bare UUID keys were the first `-07` text, never posted. They were dropped because a UUID is
opaque to a reader, locates no definition, and has no precedent as a member name in an IETF JSON
or HTTP document. The change cost nothing outside the repository: when it was made, `-07` was unposted and the
0.7.0 libraries unpublished.

## 4. Upstream declarations

E11 asked that the validation model implicit in `-06` be made explicit; A5 asked for an on-ramp
for an organization that buys most of its footprint; A18 asked about additional attestations.
`-07` adds an OPTIONAL `upstream` array, each entry an object with `declaration` (an absolute
"https" URI) and an OPTIONAL `role`. An upstream reporting what it delivers to one customer
publishes an ordinary declaration whose `target-type` is `tenant`, at any "https" URI it chooses,
for example a per-customer URI it gives that customer; it may also be the party that issues the
statement a subject links from `verifiable-attestation-uri`. A declaration carries at most one
`verifiable-attestation-uri`; a subject with more than one attestation links an index of them, or
the remaining ones, from `disclosure-uri`.

The chain walk carries three MUSTs: depth no greater than three declarations below the starting
one, refusal of any URI already retrieved during the walk, and a bound on the total retrievals.
Implementation found these had sat inside a MAY while Security Considerations asserted them as
fact, with breadth unbounded, which made a conforming document an amplifier.

The comparison is one-directional and defined only against a tenant-scoped upstream declaration:
for the same reporting period, after conversion to one unit, per entry, the subject cannot report
a smaller energy or carbon figure than the upstream states it delivered, allowing for rounding.
The draft states four ways the relation is loose. It is evidence of consistency between two
self-asserted claims, never proof.

## 5. At-least-one rule replaces the retrievability conditions

`-06` said a document reporting no metric was conformant only if its `methodology-uri` resource
was openly retrievable without authentication or payment. E12b said a specification does not get
to say who gains access; A8 said the same of "substantive", "free" and "without authentication".
`-07` deletes those conditions and replaces them with a rule about the document: a declaration
object MUST carry at least one numeric metric member, or `disclosure-uri`, or
`verifiable-attestation-uri`. That is stricter than the `-06` SHOULD it also replaces, and
testable without retrieving anything.

## 6. Array cap and nosniff removed

E10 called the 366-object cap arbitrary. The server obligation is gone; the calendar bound
remains as an observation about a response that names a granularity, `-07` says that nothing
bounds the size of a Basic response, and the rule that matters is on the consumer, which MUST
bound the bytes and objects it accepts and MUST NOT rely on any server bound. The truncation-signalling
guidance goes with it (A17).

E6 asked for the logic behind `X-Content-Type-Options: nosniff`. It was defence in depth against
MIME sniffing, not an interoperability rule, and a browser does not sniff a `+json` response in
any case. It is removed from the specification; the implementations still send the header as
ordinary hardening, which the document need not say.

## 7. Query parameters formalized

E7 said the section stated what, not how. `-07` gives the syntax as ABNF (RFC 5234, with the
case-sensitive string notation of RFC 7405, importing `date-fullyear`, `date-month` and
`date-mday` from RFC 3339 Appendix A and `unreserved` and `pct-encoded` from RFC 3986 Section 2)
and a seven-step procedure. Each error has one outcome: a repeated defined parameter and a
malformed or unreal period receive 400, an unusable granularity is ignored, an unmatched target
receives 404, and undefined parameters are ignored and kept out of the origin server's own
response cache key, a shared cache still keying on the request URI. A server that honors `target`
MUST publish the set of prefixes it honors in the document identified by `methodology-uri`, and
SHOULD make an unmatched value indistinguishable from a no-data response in body and in timing;
there is no in-band list, because one would disclose the paths the rule exists to protect.

Implementation found the real defects were in aggregation, now specified: contributing entries
are of one precision, the coarsest held inside the period; they MUST NOT overlap; they MUST cover
the period, or its completed portion; the unit is that of the last entry in ascending order of
`reporting-period`; `provider`, `measurement-method`, `methodology-uri`, `target` and
`target-type` MUST agree or no aggregate is served; another non-metric optional member is carried
only where every entry carries it identically, and `signed` only if the server signs the
aggregate; an aggregate carrying no metric is a 404.

## 8. Tolerance rules narrowed to optional members

`-06` applied its tolerance rules across the board. Implementation showed this destroyed
mandatory members: treating a defective mandatory value as not reported left an object the
document's own rules then declared non-conformant. In `-07` they apply to optional members only.
A defective `capabilities` value reads as `basic`; a defective value of any other mandatory
member leaves the object non-conformant; `signed`, `upstream` and `extensions` of the wrong JSON
type are disregarded and the object processed as though absent. The reviewer's own
schema-tolerance wording (A7) is retained.

## 9. Service-level rules re-cut

E5 said "clients MUST accept application/sustainability-data+json" was imprecise. `-07` splits
request from response: a consumer SHOULD send `Accept: application/sustainability-data+json,
application/json;q=0.9`; it MUST process a 200 typed with the registered media type and MAY so
process one typed `application/json`, under which older declarations exist; any other media type
is not a declaration. Media types are compared ignoring parameters, which implementation showed
would otherwise have broken the first interoperability test over `charset`.

Three further changes came from implementation. Access control is now out of scope and a server
MAY restrict access to the declaration, because the
unconditional `200` MUST the first `-07` text inherited contradicted the 400/404 rules and, by
omission, re-imposed the "served to everyone" requirement A3 and A5 objected to. A consumer
following a redirect to another origin MUST NOT record the result as a declaration of the origin it queried unless
`target` names it. And the Basic response need no longer be a single JSON object covering the
most recently completed period and the full declared subject; what remains is the Partial
Knowledge rule that part of a declared subject MUST NOT be presented as the whole.

## 10. Noise disclosure raised to MUST

`-06` let a server perturb published values and only SHOULD have disclosed it in the methodology
document, which left a document that promised actual values beside a licence to publish others.
In `-07` the methodology document MUST state that noise is applied and bound its magnitude, and
the noise MUST also be consistent across annualized and otherwise derived members.

## 11. Text reduction and presentation

E2 asked that text removable without changing meaning be removed. Deleted in full: the
voluntary-publication statements (E1); every reference to working and research groups (E3); the
rationale for calendar periods, the capabilities explanation, the `version` and RFC 6709
discussion, the alternatives considered for signing, the RFC 8615 essay inside IANA
Considerations, the lineage note, the sustainable-development paragraph, and the separate
Interoperability and Deployment sections. Security Considerations (E9) is a three-sentence
summary and four subsections that cite rather than restate. Privacy Considerations opens by
stating that everything in a declaration is available to any party including an adversary, and
what it can reveal (E12b). Acknowledgments thanks reviewers and names no one (E14). The document
is called a *declaration* throughout, replacing `-06`'s "Sustainability Metadata Document".
Internal cross-references are numbered rather than given by section title in running prose, so
they render as "Section N". Appendix A, a worked deployment from the figures to verified
retrieval, is new (E12a); Appendix B, marked for removal before publication, names the two npm
packages, the repository and the gateway deployment.

## Rules stated for the first time in `-07`

Five rules in `-07` answer nothing in either review directly and appear in no earlier revision.
A server that honors the `target` parameter MUST publish the set of prefixes it honors in the
document identified by `methodology-uri`, and SHOULD make an unmatched value indistinguishable
from a no-data response. A declaration carries at most one `verifiable-attestation-uri`. Where
scope members accompany `carbon-footprint` for the same period they SHOULD account for it, and a
publisher whose scopes cover only part of that figure says so in the methodology document; this
was implicit in every example and stated nowhere. Pinning a key establishes continuity of
authorship, not identity, which is what the precedence rule rests on. And `sci-score` is in grams
of CO2e per `functional-unit` regardless of `carbon-unit`.

## Defects found by implementing the text

Writing the publisher, consumer and gateway against the `-07` text found 37 specification
defects. None would have been caught by a test or a schema check: each was a defect in the text
rather than in an implementation of it. The four serious ones:

1. A verified payload could override the origin-authenticated members, so anyone able to add one
   member could replace every figure and have the signature make the substitution authoritative.
2. The upstream chain's depth and loop limits sat inside a MAY while Security Considerations
   asserted them as fact, and breadth was unbounded: depth three by a hundred entries is a
   million fetches.
3. An aggregate could sum a month and a day inside it, counting that day twice.
4. An aggregate could present part of a finished period as the whole of it.

The other 33 were of the same kind: a comparison direction that would have flagged every
realistic deployment as inconsistent; an ambiguous, case-insensitive grammar; tolerance rules
that destroyed mandatory members; the media-type `charset` parameter; ignored parameters keying
the cache while the text claimed a bounded key space; the promise of actual values beside the
licence to perturb them; the aggregate's unspecified unit and precision; and, from the final
audit of the finished libraries, a tolerance list that did not say it was exhaustive, no rule
for a number a receiver cannot represent, a duplicate-member rule that a hardened parser cannot
honour, an `x5c` path that let any publicly trusted certificate claim payload precedence, and a
`target` rule stated over the raw query but applied to the decoded value.

## What did not change, and why

* **Calendar periods.** A period names a whole calendar year, month or day in UTC; a publisher
  whose reporting year differs publishes its constituent months or the enclosing calendar years
  and describes the alignment in the methodology document. The rationale essay was cut under E2;
  the rule and the migration path are unchanged.
* **HTTPS is a MUST**, on publication, on retrieval, on every redirect hop, and for the
  URI-valued members. A4 questioned the level of trust required; the answer is that HTTPS gives
  integrity and origin authentication rather than confidentiality, and that retrieval establishes
  attribution, nothing more.
* **The whole-subject rule.** A publisher MUST NOT present figures covering part of the
  declared subject as though they covered the whole; `-07` puts the prohibition on the publisher
  rather than on the document. A5 said this blocks adoption; it is kept,
  compressed, and paired with the narrower-subject on-ramp and now with `upstream`.
* **The labelling rule.** A consumer MUST NOT represent the data as verified. A9 called this
  dictating epistemology; it is kept as a processing rule on conforming consumers, not a
  statement about what any party may conclude by other means.
* **Self-asserted framing.** The one sentence with protocol content, that the metrics are
  self-asserted claims of the publisher, survives the deletion of the voluntary-publication text:
  it defines the trust model.
* **The suffix `sustainability-data`.** The Editor called it too generic in an earlier round.
  `-07` keeps it and states in the IANA registration why the name is precise; the covering letter
  asks whether he considers the point closed, noting that his own review of `-06` used the suffix
  in an example path. Changing it would touch one paragraph, the IANA entry, and one route
  constant per package.
