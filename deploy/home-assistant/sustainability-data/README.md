# Home Assistant add-on: Sustainability Data (skeleton, needs a real instance to confirm)

What it does: reads one total-increasing energy sensor (kWh) from the Core API, keeps a reading at
each month boundary in `/data`, and serves a signed declaration per completed month at
`:8099/.well-known/sustainability-data` — `hardware-metered`, because the figure is the meter's own
counter (smart meter, plug or CT-clamp integration). Carbon is derived from a configured grid intensity
or omitted. Expose only that path through your reverse proxy under your own domain.

Install: Settings → Add-ons → Add-on Store → ⋮ → Repositories → add
`https://github.com/andreibesleaga/rfc-sustainability-wellknown` (the root `repository.yaml` makes it an add-on
repository) → install "Sustainability Data" → set the options → start. The Supervisor clones the whole
repository; a separate, small add-on repository is planned once the add-on has run on a real instance.
Alternatively copy this folder into `/addons/` on the Home Assistant host (a local add-on).

Months: a month is published only when the meter was read on the 1st of that month and on the 1st of the
next (UTC; the add-on polls every ten minutes). The first published month is therefore the first full
calendar month after installation, and a month whose boundary reading was missed (Home Assistant down on
the 1st) is not published. The Energy dashboard counts days in the instance's local time zone, so its monthly
totals can differ from the add-on's by the hours between midnight local time and midnight UTC.

A request without parameters returns every published month as a JSON array in ascending order of `period.start`; each month
is an object whose `period` runs from midnight UTC on the 1st to midnight UTC on the 1st of the next month. The add-on
declares `capabilities` `extended` and honours `start`, `end` (UTC date-times with `Z`, for example
`?start=2026-01-01T00:00:00Z&end=2026-04-01T00:00:00Z`), `target` and `granularity`; a range that matches no month is answered
`200` with `[]`, and a value that is not in the allowed form is ignored.

Status: the logic is unit-tested against a fake Core API (`npm test`), the add-on manifest follows the
documented add-on format, **but it has not been run inside a real Home Assistant**. First real install:
a volunteer from the community, or the author's own instance. Known gaps to check there: the Supervisor
API path and token, the base image's Node availability, and the ingress/port exposure.

**Grid intensity:** the energy comes from your meter. For `grid_intensity_gco2e_per_kwh`, use your country's average (the EEA in the EU, Ember elsewhere), your region's in Great Britain (NESO), or your eGRID subregion's CO2e rate in the US (lb/MWh × 0.4536 = g/kWh); see [FIGURES.md](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/deploy/FIGURES.md#grid-intensity-for-kwh--carbon). Ember counts CO2 only: say so on your methodology page.

**Methodology, security and privacy:** point `methodology-uri` at a page that follows the [methodology template](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/deploy/METHODOLOGY-TEMPLATE.md) (what is measured and estimated, allocation, what counts as one unit, extension names, perturbation). Nobody but you should be able to write under `/.well-known/` on this origin (RFC 8615, Section 4); serve the file over HTTPS only; publish only figures you intend to be public, with a role address in `provider`, and omit, or report at a coarser level, anything linkable to individual users. A declaration does not protect against someone who controls your server, DNS zone, certificate or signing key, and it does not vouch for the accuracy of the figures. More: [kit README](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/deploy/README.md#https-and-the-well-known-path).
