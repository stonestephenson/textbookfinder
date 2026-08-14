# CLAUDE.md — agent onboarding for istheseawolfbundleworthit.com

## Read first, in this order

1. **`SEAWOLF_BUNDLE_CONTEXT.md`** — the source of truth. Verified facts (§2–3), the
   **unverified-claims list (§5)**, and settled design decisions (§6). Do not relitigate settled
   decisions; do not let anything from §5 into user-visible copy.
   ⚠️ This file is **deliberately untracked** (see `.gitignore`): it contains unverified working
   analysis and pending-inquiry strategy that must not ship with the public site. It lives only
   in the maintainer's working copy — if it's missing from your checkout, ask the maintainer;
   never commit it without their explicit decision to publish.
2. `CLAIMS.md` — the audit trail. **Every factual assertion in the UI must have an entry here.**
   If you add or change UI copy containing a fact, update CLAIMS.md in the same commit. If a
   claim can't be sourced, it doesn't ship.
3. `METHODOLOGY.md` — the verdict specification. Code in `assets/verdict.js` must match it;
   change them together or not at all. It also specifies the price/resolve policy (offer
   selection, the no-ISBN matcher, courseware).
4. `ARCHITECTURE.md` — the pipeline and data model: the `input → confirm → resolve → price →
   verdict` flow, the canonical item shape, `priceSource` precedence, and the tuning constants
   that live **outside** `config.js`. Read this before touching `assets/app.js` or an `api/` file.
5. `design.md` — the visual direction (Apple "liquid glass"). `checks/design-audit.mjs` enforces
   it; a visual change that fails the audit is checked against this brief.

## Non-negotiable invariants (architectural, not style)

- **No SSU credentials, ever.** No login, no OAuth against SSU, no password fields.
- **No scraping** the Barnes & Noble / bookstore site.
- **Never assert a price the tool can't show a source for.** Exactly three price sources exist,
  each labeled in the UI (owner decision 2026-08-11, relaxing the original never-look-up rule):
  live fetched offers (`api/price.js` → BooksRun, plain non-affiliate links, policy in
  `api/_pick-offer.js` + METHODOLOGY.md), the price printed in the user's own capture (applied
  to **access-code items only**, never books), and the user's typed numbers, which always win.
  No estimate, average, or bookstore book price ever enters the math.
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
- **Test-first** for the four pure modules — `assets/verdict.js`, `assets/parse-text.js`,
  `api/_pick-offer.js`, `api/_resolve-match.js` — each fully covered in `tests/`. Never weaken a
  test to make it pass.
- **Beyond the done-gate:** `bash .claude/verify.sh` runs only the unit tests. Also run
  `node checks/e2e.mjs` (full browser flow + all three API contracts, no keys) and
  `node checks/design-audit.mjs` after UI changes, and `node --env-file=.env checks/parse-live.mjs`
  (real vision + BooksRun, ~2–5¢) after touching `api/parse.js` or the capture pipeline. See README.
- **Zero dependencies for the site.** No frameworks, no build step — survivability past the
  author's December 2026 graduation is a requirement. The one allowed dependency is
  `@anthropic-ai/sdk`, used only by `api/parse.js`; `api/price.js` and `api/resolve.js` use
  native `fetch`.
- **Semester-variable values live only in `assets/config.js`**; current-rate mentions in
  `index.html` are data-bound via `[data-config]` spans. Don't hardcode the rate anywhere else.
  (The "Why this tool exists" story keeps its 2026 numbers on purpose — it's a dated case.)
- **The model call is quarantined** in `api/parse.js` → `extractItems()`. The rest of the app
  must keep working when the endpoint is absent (`config.parseEndpoint = null`).
- **The price call is quarantined the same way** in `api/price.js` → `pickOffer()`
  (`api/_pick-offer.js`, pure and unit-tested). With `config.priceEndpoint = null` or the
  endpoint down, price fields stay manual and the search links carry the flow, silently.
- **The ISBN resolver is quarantined too** in `api/resolve.js` → `pickResolution()`
  (`api/_resolve-match.js`, pure and unit-tested). It fills a missing ISBN from title+author so
  the price lookup has something to search (the bundle portal prints no ISBNs). With
  `config.resolveEndpoint = null` or the endpoint down, ISBN-less items just stay manual.
- **After any substantive change to copy or verdict logic**, run a fresh-context adversarial
  check: spawn a subagent with no session context, give it only `SEAWOLF_BUNDLE_CONTEXT.md` +
  the built site, and ask it to find (a) unsourced claims, (b) §5 leakage, (c) wrong/overstated
  verdicts, (d) course-requirement framing. Fix, re-run once.

## Deploy & publish

- Static + **three Vercel serverless functions** (`api/parse.js`, `api/price.js`,
  `api/resolve.js`; `_pick-offer.js`/`_resolve-match.js` are imported helpers, not endpoints).
  Environment: `ANTHROPIC_API_KEY` (+ optional `PARSE_MODEL`) and `BOOKSRUN_API_KEY`; set a spend
  cap on the Anthropic account. `api/resolve.js` needs no key. See README "Deploying" for the
  full checklist and the GitHub-Pages / Netlify fallbacks.
- Remote: `https://github.com/stonestephenson/textbookfinder.git`, branch `main`. Commit and
  push are authorized for this project.

## Next up (open tasks)

- **Deploy to Vercel** — the whole local loop is proven; this is the only step between the site
  and users. Follow the README checklist (import repo, set both keys + spend cap, point domain).
- **Field test with 10–15 real student carts** before the Sept 4 add/drop deadline. This is the
  only reliable source of edge cases (every parser and pricing fix so far came from one) and
  cannot be skipped or compressed.
- **Pending decision:** the opt-out deadline conflict (official Sept 4 vs a student portal's
  Sept 13). The site shows the earlier, safe date; a written answer from the bookstore settles
  it (one-line `config.js` change). See `CLAIMS.md` #29.

## Roadmap context (don't build ahead of it)

- **v1 (now):** the single-flow calculator. No accounts, no DB. (The original "no price API"
  scope was amended 2026-08-11: `api/price.js` auto-fills offers, see invariants above.) Ship before Fall
  2026 add/drop (~early-to-mid September), then ~1 week of real testing with 10–15 students'
  actual carts — that testing step is the only reliable source of edge cases and cannot be
  skipped or compressed.
- **v2 (only if v1 survives the term):** browsable course→materials database. Rules already
  settled in context §6: only artifact-backed (screenshot) submissions write to the shared DB;
  typed input stays personal; records stamped with term + capture date; mappings never carried
  across terms; stale entries downgrade to *unconfirmed*; DB prices are never user-supplied.
  The v1 exception (users typing prices for their own calculation) does NOT extend to v2's
  shared data.
