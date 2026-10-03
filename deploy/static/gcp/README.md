# Google Cloud: Cloud Storage (+ load balancer) or Cloud Run

**Cloud Storage alone** can set the object's `Content-Type` and `Cache-Control` and a bucket CORS rule
(`Access-Control-Allow-Origin: *`), but it cannot add `X-Content-Type-Options: nosniff`. Serving the
bucket behind an external HTTP(S) load balancer adds custom response headers (and HTTPS on your own
name). `deploy.sh` does the bucket part; the load-balancer part is in the Google docs ("custom response
headers" on a backend bucket). Carbon data: Google's Carbon Footprint export (BigQuery, monthly, kgCO2e,
no public API) can feed a `cloud-billing` figure; it needs billing permissions and BigQuery.

**Cloud Run** (free tier, HTTPS, any headers): run the publisher's static server as a container
(`gcr.io`/Artifact Registry image built from `../../frameworks/node/`), set the four headers in code.
That is the same recipe as any Node framework; nothing GCP-specific beyond the deploy command:
`gcloud run deploy sustainability-data --source . --allow-unauthenticated --region europe-west1`.

**Figures:** this publishes what you give it. For the easiest real sources (your cloud's or host's report, a meter, or an estimate from monthly data transfer) see [FIGURES.md](https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/deploy/FIGURES.md).
