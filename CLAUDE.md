# Instructions for Claude: Roastery Ledger

Read this before doing anything in this project.

## Who you're working with

This project is owned by **Zack** (GitHub: `emptieshemlock56`). It is the roastery's live inventory
and production app. Real staff use the production copy every day.

The person talking to you may be a **non-technical helper** ("the tinkerer") who wants to improve
the app by describing changes in plain English. They are not a programmer. That means:

- **Talk in plain, everyday language.** Short sentences. No jargon. If you must use a technical
  word, explain it in a few words the first time.
- **Do the technical work yourself.** Don't ask them to run commands, edit files or choose between
  technical options. Make the sensible choice and tell them what you did.
- **When something is unclear, ask about what they want the app to do**, never about how to code it.
  ("Should the new column show pounds or kilograms?" is fine. "Should I use a migration?" is not.)
- **Never say something works until you've checked it**: tests pass *and* you've looked at it in the
  running app.
- After each change, tell them **what changed, where to see it, and how to try it**, in two or three
  sentences.

### How to tell who you're talking to

Run `git remote -v`.
- `origin` points to `emptieshemlock56/roastery-ledger`: this is **Zack's** copy. Skip the "First-time
  setup" steps below and work normally, but still follow the safety rules.
- `origin` points to someone else's fork and `upstream` points to `emptieshemlock56/roastery-ledger`:
  this is **the tinkerer's** copy. Follow everything below.

## The three copies of the app (why the tinkerer can't break anything)

| Copy | Where | Who changes it |
|---|---|---|
| **This laptop** (dev) | `npm run dev`, http://localhost:5173 | You, freely. Fake sample data only. |
| **Staging** | online, practice copy | Only when Zack merges a pull request |
| **Production** | online, real inventory | Only after Zack approves a deploy in GitHub |

Work on **this laptop's copy only**. Changes reach the real app only by **sending them to Zack** as a
pull request that Zack reviews. Never try to reach staging or production any other way.

## First-time setup (when they say "set me up", or the app has never been run here)

Do these in order. Say in one line what each step is for. Stop and explain plainly if one fails.

1. **Check the tools.** `node --version` (needs 22 or newer), `git --version`, `gh auth status`. If one
   is missing or GitHub isn't signed in, tell them which step of
   `docs/TINKERER-SETUP-WINDOWS.md` Zack needs to redo. Don't try to install system software yourself.
2. **Check the copy.** `git remote -v` should show `origin` = their fork and `upstream` =
   `emptieshemlock56/roastery-ledger`. If `upstream` is missing, add it:
   `git remote add upstream https://github.com/emptieshemlock56/roastery-ledger.git`
3. **Check their name for saved changes.** `git config user.name` and `git config user.email` must
   both print something. If not, ask for their name, then set
   `git config --global user.name "<their name>"` and use their GitHub private email:
   `gh api user --jq '"\(.id)+\(.login)@users.noreply.github.com"'` →
   `git config --global user.email "<that>"`.
4. **Turn on the safety settings.** If `.claude/settings.local.json` doesn't exist, copy
   `.claude/tinkerer-settings.json` to `.claude/settings.local.json`. Tell them: "I've switched on the
   safety settings. Please start a new chat so they take effect."
5. **Install and start.** `npm install`, then start `npm run dev` in the background. Wait until
   http://localhost:3001/health answers, then open http://localhost:5173.
6. **Show them how to sign in** to their local copy: `admin@example.test`, password
   `dev-password-123`. This is fake data on their own laptop. These accounts don't exist in staging
   or production.
7. Finish by telling them the app is running and they can now describe a change they'd like.

## Every change (the tinkerer's workflow)

1. **Start from Zack's latest version**, on a new branch named after the change:
   `git fetch upstream` then `git switch -c <short-name> upstream/main`.
   If there are unsaved changes from earlier, ask whether to keep them (save them on their own
   branch) or throw them away. Never throw work away without asking.
2. **Keep each change small and about one thing.** If they ask for something big ("connect it to
   Sage", "add a whole new section"), suggest the smallest useful first piece and do that. Zack has
   to review every change, and small ones are easy to check.
3. **Make the change, then prove it works:**
   - `npm test` must pass. Add or update a test in `server/test/` for anything that changes what the
     server does or saves.
   - Make sure the app is running (`npm run dev`), open the page, and check it yourself.
4. **Explain the change** (what, where to see it, how to try it) and let them try it.
5. **When they're happy** ("send it to Zack", "submit it", "I'm done"):
   - Commit with a clear message, then `git push -u origin <branch>`.
   - Open the pull request on **Zack's** repo:
     `gh pr create --repo emptieshemlock56/roastery-ledger --base main --head <their-login>:<branch>`.
     Fill in the template in plain English: what changed, why they wanted it, how Zack can try it,
     and anything risky (database changes especially).
   - Give them the link, and tell them Zack will review it, and nothing reaches the real app until Zack
     does.
6. **If Zack asks for changes**, make them on the same branch and push again. The pull request
   updates by itself.
7. **"Get the latest version"**: `git fetch upstream`, then `git switch main` and
   `git merge --ff-only upstream/main` (and `git push origin main` to update their fork). If work is
   in progress on a branch, merge `upstream/main` into it. If there are conflicts, resolve them
   carefully, run the tests, and explain in one or two sentences what happened.

## Safety rules (for everyone, always)

- **This repository is public.** Never put real business data, passwords, keys, connection strings or
  customer/supplier details in any file, commit, pull request or issue. Fake sample data only.
- **Never touch the deployment machinery**: `.github/` (the pipeline), `render.yaml`, `Dockerfile`,
  `docker-compose.yml`, `scripts/`. These control how staging and production get updated. If a
  request needs one of them, stop and say "That needs Zack to change". Don't do it.
- **Don't edit `CLAUDE.md` or `.claude/`** unless Zack asks for it directly.
- **Never use or ask for** secrets, the staging/production web addresses' logins, or database links.
  Never run anything against a database other than the local one.
- **Database changes** (new tables, new columns):
  - Add a **new** numbered file in `server/migrations/` (`002_…sql`, `003_…sql`, …).
    **Never edit a migration file that already exists**; it has already run on the real database.
  - Only **add** things. Don't delete or rename columns or tables, and don't change data, without
    flagging it clearly in the pull request as risky. Those changes run on the real data when Zack
    approves a deploy.
  - It must work on both the local database (PGlite) and Postgres 18. The tests run on both in CI.
- **Don't add new npm packages** unless there's no reasonable way without one. If you do, say which
  and why in the pull request.
- **Sign-in and security code** (`server/src/auth.js`, the `X-Requested-With` check, user roles): don't
  change it unless that is exactly what was asked, and flag it in the pull request.
- **Never force-push, never push to `upstream`, never merge pull requests, never approve deployments.**
  Those are Zack's.

## How the app works (for making changes correctly)

- **Stock is a ledger.** Every change is a *movement* (receive, roast, blend, pack, ship, adjust) with
  signed *lines*. On-hand stock is the sum of non-voided lines. Mistakes are **voided**, never deleted.
  Keep it that way.
- `server/src/rules.js` defines what each movement type may do. `client/src/pages/Record.jsx` has a
  matching `KINDS` table for the forms. **Change both together.**
- Recipes (the `components` table) pre-fill inputs through `POST /api/movements/preview`.
- Server: Node + Express in `server/src/`, routes in `server/src/routes/`, every change is written to
  the audit log (`server/src/audit.js`). Mutating requests need the `X-Requested-With: ledger` header
  (`client/src/api.js` adds it).
- Web app: React + Vite + AG Grid in `client/src/`, one file per screen in `client/src/pages/`, shared
  bits in `client/src/lib.jsx`, styles in `client/src/styles.css`. Open screens refresh live when
  anyone saves (server-sent events).
- Commands: `npm run dev` (app at http://localhost:5173, API at :3001), `npm test`, `npm run build`.
  Starting over with fresh sample data: stop the app and delete `server/.data/`.

## Reviewing a pull request (when Zack asks)

Use `gh pr view <n> --repo emptieshemlock56/roastery-ledger` and `gh pr diff <n> --repo …`, and check
CI with `gh pr checks <n> --repo …`. Tell Zack in plain English:
1. what the change does for the people using the app,
2. anything risky, especially changes to `.github/`, `render.yaml`, `scripts/`, `server/migrations/`,
   sign-in or security code, new packages, or anything that deletes or rewrites data,
3. whether the tests passed, and
4. what to click on **staging** after merging to check it, before approving production.
