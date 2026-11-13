# Merging `dev` into `main`: HelloQueue

Context for whoever merges this repo's `dev` branch into `main`. Augy, give this file to Claude: "Read `.claude/merge-dev-into-main.md` and help me merge `dev` into `main`."

- **What's on `dev`:** the readable-refactor chain for help desk #21, one squash commit per job. All 9 jobs have landed.
- **What merging does:** Merging into `main` deploys the site and API on Vercel. The Telegram bot in `bot/` runs on the VPS and needs a pull and restart there.
- **Kept up to date:** the coordinator (Thomas's workspace) updates this file each time a job lands, and once more just before opening the pull request. Last updated 13 Nov, 20:07 SGT.

## Claude: how to run the merge

Work through these in order, and stop to ask Augy wherever a step says so.

1. **Read first:** this file, then `README.md`. Never read, print or copy a `.env` or `token.env` file; use the `.example` files.
2. **Check `dev` matches this file:** `git fetch origin`, then `git log --oneline origin/main..origin/dev`. Every commit in the Jobs table below should be there. Commits titled "Merge context" only update this file. Read the message of any other commit the table doesn't list (`git show <sha>`) and tell Augy what it is.
3. **Run the tests** on a checkout of `dev` (commands below). All must pass. If one fails, stop and tell Augy; don't fix it on `main`.
4. **Go through "Before merging"** with Augy. Steps marked as his (Vercel settings, the database) are his to do by hand; ask him to confirm each one.
5. **The pull request:** `gh pr list --base main --head dev`. Thomas's side opens it once the last job lands. If Augy wants to ship before that, open it yourself: `gh pr create --base main --head dev`, titled "Help desk #21: readable refactor", with the Jobs table as its body.
6. **Merge with a merge commit, never squash or rebase**: `gh pr merge <number> --merge`. Squashing would drop the one-commit-per-job history, and each commit's `Archived-As` line points to the job's full branch. Ask Augy before running it: **merging is deploying.**
7. **Go through "After merging"**, then the smoke test with Augy (unless this file says to run it before merging).
8. **If something breaks:** in Vercel, promote the previous production deployment to roll back at once. Then revert the merge on `main` through a pull request (`git revert -m 1 <merge sha>`), and tell Thomas. Never force-push.

## Jobs

| Job | What it does | On `dev` |
|---|---|---|
| 01 | Test harness | `6e2458c` |
| 02 | API isolation (H1, H2, M1–M3, M5, the registration filter, job 01's findings) | `a999f3b` |
| 03 | Field minimisation and the completed column | `65a0a8c` |
| 04 | Telegram bot and webhook (H4, M4, dotenv) | `a09d995` |
| 05 | Page fixes: XSS (H3) and analytics off staff pages (F1) | `e5c8b1a` |
| 06 | Readability: api/ | `e0f26ed` |
| 07 | Readability: views/ and script.js | `28e1435` |
| 08 | Readability: inline scripts, bot, service worker | `47d5d7f` |
| 09 | Lint rules, schema and the row-level-security script | `463a2cb` |

Each job's commit message lists what changed and how it was reviewed. The full branch is kept at `refs/archive/<job-id>`: `git fetch origin 'refs/archive/*:refs/archive/*'` to see them.

## Tests

```bash
npm install
npm test            # API handlers against a fake Supabase
npm run test:e2e    # Playwright; run `npx playwright install chromium` once on a new machine
```

They need no `.env`, network or real database.

## Before merging

- **Webhook or polling bot?** Telegram sends updates to one or the other, never both. Ask Augy which is live. The webhook (`api/telegram/webhook.js`) handles fewer commands and no buttons; the VPS bot in `bot/` handles everything.
- **If the webhook is live:** Augy sets `TELEGRAM_WEBHOOK_SECRET` in Vercel (1-256 characters of A-Z, a-z, 0-9, `_`, `-`) and re-registers the webhook with the same value as `secret_token` (README, Deployment §2; BotFather can't set it). Until both are done, the webhook answers 403 to every update.
- **Database check:** in Supabase, confirm `gftvqueue_attendee_login_codes.session_token` accepts NULL. Job 02's sign-in change relies on it, and that table isn't in `schema.sql` until job 09.

## After merging

- **Database:** run `sql/enable-row-level-security.sql` once in the Supabase SQL editor, after the deploy (job 09).
- If `git diff origin/main origin/dev -- bot/` shows changes (jobs 04 and 08 touch it): pull `main` on the VPS, run `npm install` in the bot's folder (job 04 adds `dotenv`), and restart the Telegram bot.

## Smoke test on the live site

The tests can't reach the real database, logins or messaging, so check these by hand after the deploy:

- Sign in as an operator: My Queues lists only your queues; Operate works (call next, mark missed, mark complete).
- Sign in as an event editor: the event page, its queues and its editor list load.
- Join a queue as an attendee, from the page and from the Telegram bot; the attendee sign-in code connects once.
- The display screen for a queue updates.
- The Telegram bot answers `/start` and `/status`.

## What users may notice

- Queues and events are shown only to people with a role on them; anyone else gets 403. Staff (operators, queue admins) see an empty Events view; My Queues works for them.
- Editors' emails are no longer sent to the browser.

Open questions and anything left for later are on help desk #21's review page, not here.
