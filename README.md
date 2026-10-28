# Cervical Screening Registry (prototype)

A small, working prototype of a population cervical screening registry built on
**HL7 FHIR R4**:

1. **Register** women (FHIR `Patient`).
2. **Record** HPV and cytology results (FHIR `Observation`, LOINC-coded) and
   colposcopy follow-up (FHIR `Procedure`, SNOMED CT-coded).
3. A **rules engine** works out who is up to date, due soon, overdue, never
   screened, or has an abnormal result that needs follow-up.
4. **Alerts** are raised and closed automatically as FHIR `Flag` resources.
5. A **public dashboard** shows anonymised totals only, with small-number
   suppression.

> ⚠️ **Demo only. No real patients.** Every record is synthetic, generated from
> a fixed random seed, and labelled with the HL7 `HTEST` ("test health data")
> security tag. The screening intervals are illustrative and are **not clinical
> guidance**. This is not a medical device and must not be used for patient care.

No dependencies: plain Node.js (20+), no database, no build step.

## Quick start

```bash
npm start
```

Then open:

| URL | What |
| --- | --- |
| http://localhost:3000/ | Public dashboard (anonymised totals) |
| http://localhost:3000/staff | Staff screens: register, record results, alerts, worklist |
| http://localhost:3000/fhir/metadata | FHIR CapabilityStatement |

On first start the server generates 600 synthetic women into `data/store.json`.
`npm run reset-demo` wipes and regenerates them. `npm test` runs the test suite.

### Settings

| Env var | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `DATA_FILE` | `data/store.json` | Where resources are stored |
| `REGISTRY_API_KEY` | unset | If set, all staff and FHIR endpoints need `Authorization: Bearer <key>`. The public stats endpoint stays open. |

## Screening rules

Defined in [`src/rules.js`](src/rules.js), parameters in [`src/config.js`](src/config.js).

| Situation | Outcome | Next due | Alert |
| --- | --- | --- | --- |
| Aged under 25 or over 64 | Not eligible | — | none |
| Eligible, no screen on record | Overdue | from 25th birthday | `never-screened` |
| HPV negative (or cytology NILM) | Routine recall | +3 years if 25–49, +5 years if 50–64 | — |
| HPV positive, cytology NILM | Early recall | +12 months | — |
| HPV invalid / cytology unsatisfactory | Repeat | +3 months | — |
| Abnormal cytology, or HPV positive with no triage | Abnormal | refer for colposcopy | `abnormal-result` |
| …still no colposcopy after 42 days | Abnormal | — | `follow-up-overdue` (high priority) |
| Colposcopy recorded after an abnormal result | Followed up | +12 months | alert closes |
| Past due date | Overdue | — | `overdue` |
| Due within 90 days | Due soon | — | none (invitation window) |

Abnormal results keep their alert even after a woman ages out of the programme.
Rules re-run whenever a resource is added, at start-up, daily, and on
`POST /api/rules/run`.

## FHIR model

| Concept | Resource | Coding |
| --- | --- | --- |
| Woman on the register | `Patient` | `gender = female`, registry identifier, `address.district` |
| HPV test | `Observation` | LOINC `21440-3`; value SNOMED `10828004` positive / `260385009` negative / `125154007` unsatisfactory |
| Cervical cytology | `Observation` | LOINC `10524-7`; value from a local Bethesda category code system (NILM, ASC-US, LSIL, ASC-H, HSIL, AGC, SCC, UNSAT) |
| Colposcopy | `Procedure` | SNOMED `392003006` |
| Alert | `Flag` | local `screening-alert` code system, `flag-priority` extension |

Local code systems live under `https://example.org/cervical-registry/fhir/…`.
A real deployment should replace these with its national profiles and verify
every terminology binding.

### API

FHIR (JSON, `application/fhir+json`):

- `GET /fhir/metadata`
- `GET /fhir/{Patient|Observation|Procedure|Flag}?patient=&status=&identifier=&_count=`
- `GET /fhir/{type}/{id}`
- `POST /fhir/{Patient|Observation|Procedure}`: validated, returns `201` with `Location`. Errors come back as `OperationOutcome`. `Flag` is read-only: the rules engine owns it.

Convenience endpoints used by the staff screens:

- `POST /api/register` `{given, family, birthDate, district}`
- `POST /api/results` `{patientId, date, hpv?, cytology?}`
- `POST /api/follow-up` `{patientId, date}`
- `GET /api/worklist?status=overdue`
- `GET /api/alerts`
- `POST /api/rules/run`
- `GET /api/public/stats` (public, anonymised)

## Anonymisation on the public dashboard

- Only aggregate counts by age band and district; no names, IDs, dates of birth or individual dates.
- Any count from 1 to 4 is shown as `<5`; a whole group with fewer than 5 eligible women is hidden, and a percentage is hidden whenever it would reveal a suppressed count.
- Limitation: this is simple cell suppression. Combining several tables can still allow some counts to be worked out (differencing). A production system needs a proper statistical disclosure control review.

A static copy of the dashboard can be built with `npm run build:pages` (writes
`site/`). The included GitHub Actions workflow runs the tests and publishes it to
GitHub Pages on every push to `main`.

## Layout

```
src/
  config.js     rule parameters and suppression threshold
  fhir.js       code systems, resource builders, validation
  rules.js      pure rules engine (status, due date, alerts)
  registry.js   ties rules to the store, syncs Flags, builds public stats
  store.js      in-memory FHIR store persisted to one JSON file
  synthetic.js  seeded synthetic population
  app.js        HTTP routes (FHIR, staff API, public stats, static files)
  server.js     entry point
public/         dashboard and staff screens (plain HTML/JS)
scripts/        reset-demo, build-pages
test/           node:test suites
```

## Not done (yet)

This is a prototype. Before anything real it would need: proper user accounts
and audit logging, a production FHIR server (e.g. HAPI FHIR), national FHIR
profiles and terminology, invitation/letter workflows, data-protection and
clinical-safety assessments, and a formal disclosure-control review of the
dashboard.

## Licence

[MIT](LICENSE)
