# Roastery Ledger

Shared inventory and production tracking for the roastery: green coffee, roasted coffee, blends,
packaging materials and finished goods, across roasters and packaging machines. It replaces the shared
spreadsheet with a spreadsheet-style web app that keeps a full history of every change.

## How it works

**Stock is never typed over.** Every change is a *movement*:

| Movement | Takes out | Puts in |
|---|---|---|
| Receive | — | anything delivered (green, packaging, …) |
| Roast | green coffee | roasted coffee |
| Blend | green/roasted coffees | a blend |
| Pack (per machine) | coffee + bags, labels, cases | finished units |
| Ship | finished goods (or anything) | — |
| Adjust | corrections, damage, samples, and stock counts | |

On-hand stock = the sum of all movements. Mistakes are **voided** (kept in the history with a
reason) instead of deleted. Lot codes are optional on every line, so you can trace what's left of each lot.

**Recipes** (Catalog → Recipes) say what one unit of something uses: lb of green per lb roasted, the
mix of a blend, and the coffee, bag, label and case for a packed unit. When someone records a roast,
blend or pack, the inputs fill in from the recipe and can be corrected to the real weights.

**Screens:** Stock (with lots, CSV export and a stock-count mode), Record, Activity (history + void),
Reports (production by machine, roast yield), Catalog (items, recipes, machines), Import (CSV from
the old spreadsheet) and Users (admins only, with audit log). Open screens refresh when anyone saves.

**Who can do what:** everyone with an account can record and edit inventory data. Admins also manage
user accounts. *Nobody* can change how the app works from the browser. That only happens through a
code change that goes through the pipeline below.

## The three environments

| | Where | Data | Who changes it |
|---|---|---|---|
| **Dev** | your laptop (`npm run dev`) | fake sample data | anyone tinkering, freely |
| **Staging** | Render, `ledger-staging` | practice copy (refreshable from prod) | automatically on merge to `main` |
| **Production** | Render, `ledger-prod` | the real inventory | only after someone approves in GitHub |

```
feature branch ──PR──▶ CI (tests on embedded + real Postgres, build)
                         │ review + green CI required to merge
                         ▼
                      main ──▶ deploy STAGING ──▶ ⏸ approval ──▶ back up prod DB ──▶ deploy PRODUCTION
```

Each environment has its own database. Staging and dev can't touch production data.
The top of the app shows a green **DEV** or orange **STAGING** banner, so nobody mistakes a practice
copy for the real thing.

## Local development

Needs Node 22+ only. No Docker or database install; dev uses an embedded Postgres (PGlite) stored in
`server/.data/`.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. Dev seeds sample data and two **local-only** accounts (see
`server/src/seed.js`): `admin@example.test` and `floor@example.test`, password `dev-password-123`.
To start over, stop the server and delete `server/.data/`.

```bash
npm test
```

Optional: `docker compose up --build` runs the production-style build against a real Postgres.

### Changing the database

Add a new file in `server/migrations/` (`002_add_something.sql`, …). Migrations run automatically
when the server starts in every environment. **Never edit a migration that has already run** in staging
or production; add another one instead.

## One-time setup (hosting + GitHub)

1. **GitHub repo**: create a *private* repo and push this folder.
2. **Render**: New → Blueprint → pick the repo. `render.yaml` creates `ledger-staging`,
   `ledger-prod` and a database for each. When asked, set `ADMIN_EMAIL` / `ADMIN_PASSWORD` for each
   service. That becomes the first admin account (change the password after first sign-in).
   About $7/month per web service plus about $6–7/month per database at current Render pricing.
3. **Render deploy hooks**: for each service, Settings → Deploy Hook → copy the URL.
4. **GitHub environments** (repo Settings → Environments):
   - `staging`: secret `RENDER_DEPLOY_HOOK` (staging hook), variable `STAGING_URL`
     (for example `https://ledger-staging.onrender.com`).
   - `production`: secret `RENDER_DEPLOY_HOOK` (prod hook), secret `DATABASE_URL` (prod database
     *external* URL from Render, used for the pre-deploy backup), variable `PRODUCTION_URL`.
     **Turn on "Required reviewers"** and add yourself or a trusted person. This is the approval gate.
   - `refresh-staging` (optional): secrets `PROD_DATABASE_URL`, `STAGING_DATABASE_URL`. Also add
     required reviewers.
5. **Branch protection** (Settings → Branches → `main`): require a pull request, require the
   `CI / test` check, and block force pushes. Tinkerers then work on branches and open PRs, and
   nothing reaches staging or prod without passing tests and review.

Prod backups taken before each deploy are kept as workflow artifacts for 30 days. That's another
reason the repo must be private. Render also takes daily database backups on paid plans.

**Deploying a specific commit:** the workflow calls the Render deploy hook with `&ref=<commit>` so
prod gets exactly the commit that was tested on staging. Check this against Render's current deploy
hook docs when you first set it up.

## Moving the spreadsheet in

Import → download the template, then save each tab of the current spreadsheet as CSV with those
headings. Required: `code`, `name`, `type`; `on_hand` sets the starting stock. Do it in **staging**
first and check the numbers, then repeat in production.

## Later: Sage

Each item has a `sage_item_code` field. How to connect depends on which Sage product they run:
Intacct has a REST API (direct sync is realistic), Sage 100/300 are usually on-premises (ODBC or an
import/export bridge), and Sage 50 is usually easiest via CSV import/export.

## Project layout

```
server/            Express API (Node)
  migrations/      numbered SQL schema changes
  src/rules.js     what each movement type may do
  src/inventory.js recording movements, recipes, counts
  src/routes/      HTTP endpoints
  test/            node:test suite
client/            React + Vite + AG Grid web app
.github/workflows/ CI, deploy (staging → approval → prod), refresh staging
render.yaml        hosting definition for both environments
```
