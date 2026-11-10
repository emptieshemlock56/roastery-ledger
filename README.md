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

Each environment has its own database. Staging and dev can't touch production data. Each deployed
database also records which environment it belongs to: if staging's server is ever pointed at the
production database (or the reverse), it refuses to start and Render's logs say why.
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

## Hosting

**Now (prototype, $0/month):** each environment runs on a free [Render](https://render.com) web
service with a free [Neon](https://neon.tech) Postgres database. Free Render services sleep after 15
minutes without visitors, so the first visit after a quiet spell takes about a minute. Neon's free
databases are permanent (1 GB each).

**Later (self-hosted, e.g. AWS or an on-prem server):** the `Dockerfile` builds one container that
serves the whole app. Any machine that runs Docker can run it next to a Postgres 18 database. It needs
the same environment variables as `render.yaml`: `APP_ENV`, `DATABASE_URL`, `DATABASE_SSL`,
`JWT_SECRET`, plus `ADMIN_EMAIL`/`ADMIN_PASSWORD` for the first sign-in. Only the "trigger deploy" steps
in `.github/workflows/deploy.yml` are Render-specific. Moving means swapping those for the new host's
deploy command and restoring a backup into the new database. The tests, approval gate and backups
stay as they are.

## One-time setup (prototype hosting + GitHub)

1. **GitHub repo**: [emptieshemlock56/roastery-ledger](https://github.com/emptieshemlock56/roastery-ledger).
   It is **public** so GitHub Free enforces branch protection and the production approval gate.
   Only the code is public. Inventory data lives in the databases, and every password, key and
   database URL is a GitHub or Render secret. **Never commit secrets or real data files.**
2. **Neon**: create two projects, `ledger-staging` and `ledger-prod` (Postgres 18), and copy each
   project's **direct** (not pooled) connection string.
3. **Render**: New → Blueprint → public repo URL. `render.yaml` creates `ledger-staging` and
   `ledger-prod` on the free plan. When asked, paste each environment's Neon connection string as
   `DATABASE_URL`, and set `ADMIN_EMAIL` / `ADMIN_PASSWORD`. That becomes the first admin account
   (change the password after first sign-in).
4. **Render deploy hooks**: for each service, Settings → Deploy Hook → copy the URL.
5. **GitHub environments** (repo Settings → Environments):
   - `staging`: secret `RENDER_DEPLOY_HOOK` (staging hook), variable `STAGING_URL`
     (for example `https://ledger-staging.onrender.com`).
   - `production`: secret `RENDER_DEPLOY_HOOK` (prod hook), secret `DATABASE_URL` (prod Neon
     connection string, used for the pre-deploy backup), secret `BACKUP_PASSPHRASE` (a long random
     passphrase, also kept in your password manager), variable `PRODUCTION_URL`. "Required
     reviewers" is on and production only accepts deploys from `main`. That's the approval gate.
   - `refresh-staging` (optional): secrets `PROD_DATABASE_URL`, `STAGING_DATABASE_URL`. Also add
     required reviewers.
6. **Branch protection** on `main` (already set): pull request with 1 approval, the `test` check
   must pass, branch must be up to date, no force pushes. Tinkerers work on branches and open PRs, and
   nothing reaches staging or prod without passing tests and review.

### Restoring a backup

Before each production deploy, the workflow dumps the prod database, **encrypts it with
`BACKUP_PASSPHRASE`**, and keeps it as a workflow artifact for 30 days. Artifacts in a public repo can
be downloaded by anyone, which is why only the encrypted file is uploaded. To restore one, download it
from the Actions run, then:

```bash
gpg --decrypt prod-before-abc1234.dump.gpg > prod.dump
```

```bash
pg_restore --clean --if-exists --no-owner -d "<prod external database URL>" prod.dump
```

Neon also keeps a short restore history of each database.

Workflow logs are public too, so the workflows never print data or secrets (GitHub masks secrets
automatically).

**Deploying a specific commit:** the workflow calls the Render deploy hook with `&ref=<commit>` so
prod gets exactly the commit that was tested on staging. Check this against Render's current deploy
hook docs when you first set it up.

## Sign-in and two-factor

- **Two-factor sign-in is required in staging and production.** After entering their password, people
  enter a 6-digit code from an authenticator app (Google/Microsoft Authenticator, 1Password, Apple
  Passwords). Anyone without it set up is walked through setup at their next sign-in, and gets 10
  single-use **backup codes** for a lost phone. Local dev doesn't require it (set `REQUIRE_2FA=true`
  to try it locally). `REQUIRE_2FA=false` turns the requirement off in an environment.
- **Lost phone and backup codes:** an admin clicks **Reset 2FA** on the Users page. The person is
  signed out and sets it up again at their next sign-in. Admins can't reset their own, so **keep at
  least two admins**.
- **Only admin locked out?** Fix it directly in the database (Neon → the project → SQL Editor),
  replacing the email:
  ```sql
  DELETE FROM backup_codes WHERE user_id = (SELECT id FROM users WHERE email = 'you@example.com');
  UPDATE users SET totp_secret = NULL, totp_pending_secret = NULL, totp_enabled_at = NULL,
         totp_last_step = NULL, session_version = session_version + 1
   WHERE email = 'you@example.com';
  ```
- **Sessions** last 7 days. Changing a password, an admin password reset, a 2FA reset, or **Sign out
  everywhere else** (Account page) ends that person's other sessions. Deactivated users are blocked
  immediately.
- Repeated failed passwords or codes are blocked for 15 minutes. Every sign-in (and whether a backup
  code was used) is in the audit log.

## Helpers who change the app with Claude

Non-technical helpers can improve the app by talking to Claude on their own laptop. They work on
their own fork with sample data and send changes as pull requests, so nothing reaches staging or
production without your review and approval.

- `docs/TINKERER-SETUP-WINDOWS.md`: step-by-step checklist for setting up a helper's Windows laptop.
- `docs/START-HERE.md`: the one-page guide for the helper.
- `CLAUDE.md`: the rules Claude follows in this project (plain language, small changes, never touch
  the pipeline, secrets or old migrations).
- `.claude/settings.json` pre-approves routine commands for everyone. `.claude/tinkerer-settings.json`
  is copied to a helper's `.claude/settings.local.json` during setup and blocks the pipeline, secrets,
  merging and force-pushing.

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
