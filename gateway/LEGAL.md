# Legal notice and terms — Sustainability Data Reference Gateway

Version of 2026-10-03.

## 1. Who runs this service, and why

This service is run by Andrei Nicolae Besleaga, a private individual, as a
non-commercial demonstration of the Internet-Draft
draft-besleaga-sustainability-wellknown. It charges nothing, carries no
advertising and does no tracking. Contact: an issue at https://github.com/andreibesleaga/rfc-sustainability-wellknown/issues, or any
route listed at https://andreibesleaga.com/contact/.

## 2. What the documents about third parties are

Some documents served here describe real organizations. Each of them is an
ILLUSTRATIVE MAPPING prepared by the operator from figures the organization has
itself published. These documents:

- are NOT published, reviewed, authorized or endorsed by the organizations they
  describe;
- are NOT an authoritative source: the organization's own publication, named in
  each document's methodology-uri member, is the only authoritative record;
- say so themselves, in their provider member;
- are never cryptographically signed by the operator, so that nothing here can
  be mistaken for a statement made or vouched for by the organization.

Documents under a reserved name ending in .example are synthetic. Their figures
are invented and describe nothing real.

## 3. What is taken from the sources, and what is not

A document about a third party contains only: individual figures the
organization has published (for example an annual energy total or an emissions
total), the organization's name, the reporting period, and links to the
organization's own publication.

No text, table, chart, image, logo or layout of any source publication is
reproduced by this service, and no source publication is redistributed here.
Each source publication remains the property of its owner and subject to its
owner's terms; this service only links to it. The provenance record in the
repository quotes a few words from a source where that is needed to show
exactly which figure was read.

Nothing is estimated, interpolated or apportioned on an organization's behalf.
A figure the source does not state is left out.

A document about an organization is served only when that organization's
published terms do not prohibit reuse of the content it is taken from, or when
the organization has agreed in writing. Documents whose sources' terms prohibit
reuse, or whose terms could not be read, are not served. The terms found for
every source are recorded in the repository (gateway/data/README.md, "Rights in
the sources").

Where a source is published under an open licence, the document names the
licensor and the licence, states that the figures were extracted and
reformatted, and states that the licensor does not endorse this service. Where
that licence is a share-alike licence, the document is offered under the same
or a compatible licence.

## 4. Names and trademarks

Company, product and service names, and any trademarks, belong to their owners.
They are used here only to identify whose published report a document is mapped
from. Their use implies no affiliation with, sponsorship by or endorsement from
any of those owners.

## 5. Accuracy, and what these documents are not for

Figures were transcribed on the date recorded for each document and may since
have been restated, corrected or superseded by the organization. Transcription
errors are possible. Where this service and a source differ, the source is
right.

The documents exist to exercise a data format. They are not intended for, and should not be relied on for,
investment decisions, ratings, audits, assurance, regulatory or statutory
reporting, procurement decisions or any compliance purpose, and nothing here is
professional advice of any kind.

## 6. Corrections and removal

Anyone may report an error. A reporting subject may also ask for its document
to be changed or removed.

- Open an issue at https://github.com/andreibesleaga/rfc-sustainability-wellknown/issues, or, for a request you would rather not make in
  public, use any route listed at https://andreibesleaga.com/contact/.
- A correction is made once it has been checked against the source.
- A removal requested by the organization a document describes is carried out
  without the organization having to give a reason.
- The operator acts as soon as he can, and normally within seven days of
  receiving the request.

## 7. No warranty, and limits of liability

The service and everything it serves are provided "as is" and "as available",
without warranty of any kind, express or implied, including accuracy,
completeness, fitness for a particular purpose and non-infringement. To the
fullest extent the applicable law allows, the operator is not liable for any
loss or damage arising from the use of, or reliance on, the service or its
contents. Nothing in this notice excludes or limits a liability, or a right of
yours, that cannot be excluded or limited under the law that applies to you.

## 8. Checking a file

The index page and the routes `/validate` and `/badge/<host>.svg` let anyone
ask this service to fetch another origin's `/.well-known/sustainability-data`
once and report whether what came back is a schema-valid declaration, using
the published consumer library. A result describes the bytes that origin served
at that moment and nothing else: it is not an endorsement, says nothing about
the accuracy of any figure, and creates no listing. Results are kept in memory
for one hour so that an origin is fetched at most hourly, and are then
discarded. Only public `https` host names are fetched; addresses on private
networks are never contacted. An origin's operator who does not want it
fetched by this service can say so through any route in section 6; the operator
of this service then adds the name to its exclusion list at the next deployment,
normally within the seven days of section 6, and the name is refused from then on.

## 9. Privacy

The service sets no cookies, has no accounts and uses no analytics or tracking.
To limit abuse it counts requests per client address in memory; those counts
are not written to storage and disappear when the process restarts. The hosting
provider may process IP addresses in standard server logs for operation and
security; those logs record each request line, including the origin named in a
`/validate` or `/badge` request, together with the client address, for the
provider's retention period, and are then deleted. This service's own log does
not record the origin named in such a request. The index page keeps a theme preference in your browser's local
storage and nowhere else. Questions about personal data: any route listed at
https://andreibesleaga.com/contact/.

## 10. Licence

The software of this service and the operator's own documents are published
under the BSD 3-Clause License in the repository
https://github.com/andreibesleaga/rfc-sustainability-wellknown. That licence
covers the operator's own work only. It grants no rights in any third party's
name, trademark or source publication.

Figures taken from sources under a Creative Commons licence remain under that
licence, as each document states; the BSD licence does not apply to them.

## 11. Changes

This notice may be updated; the version date above shows the current text.
