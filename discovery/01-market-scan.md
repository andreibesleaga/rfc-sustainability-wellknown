# 01 — Market Scan

*Discovery for the `/.well-known/sustainability` publisher/gateway. Non-normative.*

## 1. The landscape

Corporate environmental reporting has split into two layers that do not talk to each
other:

**A. Enterprise sustainability suites** — systems of record that ingest ERP/CRM/billing
data and compute audit-ready GHG inventories (metric tonnes CO2e, annual cadence).

| Platform | Architecture | Primary API surface | Native unit |
|---|---|---|---|
| **Salesforce Net Zero Cloud** | Standard Objects on the Salesforce metadata platform; Apex roll-ups | REST/SOAP/Tooling (SOQL), Change Data Capture, Pub/Sub | mtCO2e |
| **Microsoft Sustainability Manager** | Dataverse / Common Data Model | OData v4 REST (`$filter`, `$skiptoken` paging) | mtCO2e |
| **Watershed** | AI ingestion (IDI) + CEDA spend-based factor DB | REST footprint API; Workiva disclosure chains | kg/mtCO2e |
| **Persefoni** | "ERP of climate"; Integration Hub connectors | Connector/REST (SAP Concur, NetSuite, Coupa, AWS) | mtCO2e |
| **Sweep** | Supplier-collaboration tree | Surveys + REST dashboards | mtCO2e |

**B. Developer / observability tooling** — transactional, high-frequency, micro-scale
(joules, grams CO2e, per-request).

| Tool | Role | Output |
|---|---|---|
| **Climatiq** | Embedded emission-factor REST API (`/data/v1/estimate`) | kgCO2e + methodology |
| **Kepler** | eBPF/RAPL container energy exporter (CNCF) | Prometheus joules counters |
| **GSF Impact Framework** | Executable manifests; SCI score (ISO/IEC 21031:2024) | gCO2e / functional unit |

## 2. The common-denominator fields

Across both layers, the same handful of semantic fields recur (drawn from the two
architecture reports in the project brief):

| Common field | Salesforce NZC | MS Sustainability | Climatiq | Kepler |
|---|---|---|---|---|
| Temporal context | `AnnualEmssnInventory.Year` | OData `$filter` on time | `year`/`duration` | scrape window |
| Provider identity | `AccountId`/`OwnerId` | Tenant/Enrollment ID | Project ID | `pod`/`namespace` |
| Scope 1/2/3 | `TotalScope{1,2,3}*` | Dataverse scope tables | `scopes` array | estimated/embodied |
| Energy | `ActualEnergyConsumption` (MWh) | Energy activity data | `energy`+`energy_unit` | `kepler_*_joules_total` |
| Carbon | `TotalEmissions` (mtCO2e) | totals (mtCO2e) | `co2e` (kg) | J × grid intensity |
| Audit / lineage | `DisclosureDefinition.URL` | activity-data source | `emission_factor.id` | scrape timestamps |

This is exactly the field set the IETF draft normalizes to (energy-consumption / -unit,
carbon-footprint / -unit, scope-1/2/3, reporting-period, provider, measurement-method,
methodology-uri).

## 3. The gap

Every platform above can *calculate* a footprint. **None of them expose it at a
standardized, discoverable, machine-readable HTTP location.** Disclosure today is a PDF, a
Workiva export, or a per-vendor authenticated API. There is no equivalent of `robots.txt`
or `/.well-known/security.txt` for carbon — no single URL a client, load balancer,
aggregator, or regulator can GET to learn an origin's energy and carbon profile.

## 4. The wedge

`draft-besleaga-green-sustainability-wellknown` defines that missing surface:
`GET /.well-known/sustainability` → a small, validated JSON document. The **publisher/
gateway** in this repo is the missing middleware: it reads from any of the sources above
(or a static file) and publishes a conformant document, turning the fragmented calculation
layer into a uniform, public disclosure layer.

See [02-opportunity-assessment.md](02-opportunity-assessment.md).
