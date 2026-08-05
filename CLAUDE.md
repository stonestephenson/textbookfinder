# CLAUDE.md — agent onboarding for istheseawolfbundleworthit.com

## Read first, in this order

1. **`SEAWOLF_BUNDLE_CONTEXT.md`** — the source of truth. Verified facts (§2–3), the
   **unverified-claims list (§5)**, and settled design decisions (§6). Do not relitigate settled
   decisions; do not let anything from §5 into user-visible copy.
2. `CLAIMS.md` — the audit trail. **Every factual assertion in the UI must have an entry here.**
   If you add or change UI copy containing a fact, update CLAIMS.md in the same commit. If a
   claim can't be sourced, it doesn't ship.
3. `METHODOLOGY.md` — the verdict specification. Code in `assets/verdict.js` must match it;
   change them together or not at all.

## Non-negotiable invariants (architectural, not style)

- **No SSU credentials, ever.** No login, no OAuth against SSU, no password fields.
- **No scraping** the Barnes & Noble / bookstore site.
- **Never assert a price the tool didn't source.** v1 links out; user-typed prices are always
  labeled as the user's own numbers. Parsers deliberately ignore prices in input.
- **Never claim what a course requires.** All copy speaks in the frame "your cart shows…".
- **Confirmation before computation.** The confirm step is never skipped or auto-accepted; low
  parse confidence highlights the field and asks instead of guessing.
- **The tool must be willing to recommend staying in.** If user numbers make the bundle cheaper
  (common with multiple access codes), it says so plainly. A calculator that always says
  "opt out" is advocacy and loses the audience that matters (advisors, faculty).
- **No analytics that identify users; no server-side storage of uploads** beyond the request.
- **Money math in integer cents** (`assets/verdict.js`). No floats in comparisons.

## Working on this repo

- **Done-gate:** `bash .claude/verify.sh` (syntax-checks all JS, runs `node --test`). Green
  before any commit.
- **Test-first** for changes to `assets/verdict.js` and `assets/parse-text.js` — both are pure
  and fully covered in `tests/`. Never weaken a test to make it pass.
- **Zero dependencies for the site.** No frameworks, no build step — survivability past the
  author's December 2026 graduation is a requirement. The one allowed dependency is
  `@anthropic-ai/sdk`, used only by `api/parse.js`.
- **Semester-variable values live only in `assets/config.js`**; current-rate mentions in
  `index.html` are data-bound via `[data-config]` spans. Don't hardcode the rate anywhere else.
  (The "Why this tool exists" story keeps its 2026 numbers on purpose — it's a dated case.)
- **The model call is quarantined** in `api/parse.js` → `extractItems()`. The rest of the app
  must keep working when the endpoint is absent (`config.parseEndpoint = null`).
- **After any substantive change to copy or verdict logic**, run a fresh-context adversarial
  check: spawn a subagent with no session context, give it only `SEAWOLF_BUNDLE_CONTEXT.md` +
  the built site, and ask it to find (a) unsourced claims, (b) §5 leakage, (c) wrong/overstated
  verdicts, (d) course-requirement framing. Fix, re-run once.

## Deploy & publish

- Static + one Vercel serverless function. `ANTHROPIC_API_KEY` (+ optional `PARSE_MODEL`) in the
  deployment environment. See README "Deploying".
- Remote: `https://github.com/stonestephenson/textbookfinder.git`, branch `main`. Commit and
  push are authorized for this project.

## Roadmap context (don't build ahead of it)

- **v1 (now):** the single-flow calculator. No accounts, no DB, no price API. Ship before Fall
  2026 add/drop (~early-to-mid September), then ~1 week of real testing with 10–15 students'
  actual carts — that testing step is the only reliable source of edge cases and cannot be
  skipped or compressed.
- **v2 (only if v1 survives the term):** browsable course→materials database. Rules already
  settled in context §6: only artifact-backed (screenshot) submissions write to the shared DB;
  typed input stays personal; records stamped with term + capture date; mappings never carried
  across terms; stale entries downgrade to *unconfirmed*; DB prices are never user-supplied.
  The v1 exception (users typing prices for their own calculation) does NOT extend to v2's
  shared data.
