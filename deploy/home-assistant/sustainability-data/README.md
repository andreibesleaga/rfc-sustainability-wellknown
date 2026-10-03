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

Status: the logic is unit-tested against a fake Core API (`npm test`), the add-on manifest follows the
documented add-on format, **but it has not been run inside a real Home Assistant**. First real install:
a volunteer from the community, or the author's own instance. Known gaps to check there: the Supervisor
API path and token, the base image's Node availability, and the ingress/port exposure.
