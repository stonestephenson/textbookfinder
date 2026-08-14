# istheseawolfbundleworthit.com

A single-page calculator that tells a Sonoma State University student whether the **Seawolf
Bundle** — the $21/unit auto-enrolled course materials program — is cheaper than buying what
their own bookstore cart shows. Screenshot or paste your course materials page, confirm what was
read, and get the arithmetic: real offers are looked up for your items automatically (each one
linked and editable), and anything that can't be found you can price yourself at the links it
gives you.

Built by an SSU student. Not affiliated with SSU, Sonoma State Enterprises, or Barnes & Noble.

- **How the verdict is computed:** [METHODOLOGY.md](METHODOLOGY.md)
- **Every factual claim on the site, with its source:** [CLAIMS.md](CLAIMS.md)
- **The underlying contract** (public records request PRA 2026-495):
  [`contract/PRA 2026-495.pdf`](contract/PRA%202026-495.pdf)

## What it never does

These are design rules, not merely current facts:

- Never asks for SSU credentials of any kind. No login, no OAuth.
- Never scrapes the bookstore site.
- Never asserts a price it can't show a source for. Every price in the math is one of three
  labeled things: a live fetched offer (store named, offer linked, shipping included), the price
  printed in the student's own capture (access codes only), or a number the student typed —
  which always wins. Details in [METHODOLOGY.md](METHODOLOGY.md).
- Never earns from a link. The price source's affiliate parameters are stripped; links go to
  plain product pages.
- Never claims what a course *requires* — it reports what *the user's own cart shows*.
- Never computes anything before the user confirms the parsed list.
- Never stores screenshots, uses analytics, or identifies users.
- Every factual sentence in the UI has a source line in CLAIMS.md. If it can't be sourced, it
  comes out.

---

## How to update this each semester

**This is the section that matters.** Everything the site needs per semester lives in **one
file: [`assets/config.js`](assets/config.js)** — readable by a non-programmer, editable directly
in the GitHub web interface (open the file → pencil icon → commit). The deployment updates
automatically on commit if the repo is connected to Vercel/Netlify.

The checklist, once per term (~20 minutes):

1. **`term`** — set to the new term, e.g. `'Spring 2027'`.
2. **`pricePerUnit`** — the current student-facing bundle price. **Get it in writing** — email
   the bookstore and ask "what is the Seawolf Bundle price per unit this term?" and keep the
   reply. Do not use last term's number, a rumor, or the contract price (the contract price to
   SSE and the student price are different numbers).
3. **`optOutDeadline`** — the term's opt-out deadline as `'YYYY-MM-DD'` **only if you have a
   verified date** (bookstore page or academic calendar); record where it came from in
   `optOutDeadlineSource`. If unverified, leave both `null` — the site then tells students to
   check their portal, which is honest and safe.
4. **`accessCodePatterns`** — add any new courseware platform names students report.
   Also re-check the outbound links (`bookstoreUrl`, `courseMaterialsUrl`, `courseFinderUrl`,
   `optOutUrl`) still resolve — bookstore platforms move URLs without notice.
5. **Update [CLAIMS.md](CLAIMS.md)** — the entries for the price (claim #1) and any other value
   you changed, citing your new source. The site's credibility is this file.
6. **Sanity-check the flow** — open the site, paste a sample cart, confirm, type a price, and
   check that the bundle math uses the new rate.

If the price changed, the copy in `index.html` does **not** need editing — every current-rate
mention on the page is filled in from `config.js` at load. (The "Why this tool exists" story
deliberately keeps its 2026 numbers; it is a dated, documented case.)

Historical note for maintainers: the bundle was $18.50/unit in 2023 and $21.00 in 2026. The
contract has no cap on increases, so **verify the price every term**.

## Running it locally

No build step, no dependencies for the site itself:

```sh
python3 -m http.server 8000     # from the repo root
# open http://localhost:8000
```

Pasted-text parsing and the whole flow work locally. Screenshot parsing requires the API
function (below); without it the site degrades gracefully to paste/manual entry.

Tests and checks (requires Node 18+; the browser suites need Chrome installed):

```sh
npm test                 # unit tests: verdict math, text parser, offer selection,
                         #   ISBN-match logic (tests/*.test.js — currently 51)
bash .claude/verify.sh   # syntax-check all JS + run tests (the done-gate, sub-second)

node checks/e2e.mjs      # full user journey in headless Chrome: paste → confirm →
                         #   prices → all four verdict states, plus the /api/parse,
                         #   /api/price, and /api/resolve contracts (validation, error,
                         #   no-key responses). Makes no live calls; needs no API key.
node checks/design-audit.mjs   # the design-brief audit (glass, contrast, copy rules)

node --env-file=.env checks/parse-live.mjs
                         # the ONE test that calls real services: renders synthetic
                         #   course-materials fixtures, uploads them through the real UI
                         #   as a screenshot, a tall scrolling screenshot, and a
                         #   multi-page PDF, and drives them all the way to the verdict —
                         #   live Claude vision (ANTHROPIC_API_KEY) AND live BooksRun
                         #   pricing (BOOKSRUN_API_KEY). ~2–5 cents per run. Run before
                         #   deploying and after changing api/parse.js or the pipeline.
```

**Keys and `.env`.** The live commands need API keys. A gitignored `.env` in the repo root
(never committed — see `.gitignore`) is the convenient home for `ANTHROPIC_API_KEY` and
`BOOKSRUN_API_KEY`; the scripts do **not** auto-load it, so pass `node --env-file=.env …`
(as above). A fresh clone has no `.env` — create one, or export the vars inline. Without a
key a script degrades honestly (the parser answers 503, prices stay manual); it never crashes.

To click around the whole site locally with all three live endpoints (what Vercel runs in
production), use the dev server instead of `http.server`:

```sh
node --env-file=.env checks/dev-server.mjs
```

None of the real bookstore's pages are used in any test fixture. The live test's fixtures
are synthetic pages styled like a generic bookstore portal; testing against real carts is
what the pre-launch student test is for.

## Deploying

**Vercel (recommended — it's what makes screenshot parsing and price lookup work):**

1. Import the GitHub repo into Vercel. No framework, no build command — it's static files plus
   **three serverless functions**: `api/parse.js` (screenshot → items, Claude vision),
   `api/resolve.js` (title+author → ISBN when the page shows none, OpenLibrary), and
   `api/price.js` (ISBN → real offer, BooksRun). Every file under `api/` auto-deploys as a
   function; `api/pick-offer.js` and `api/resolve-match.js` are pure helpers the functions
   import, not endpoints of their own.
2. Set the environment variable `ANTHROPIC_API_KEY` (get one at console.anthropic.com).
   Optional: `PARSE_MODEL` to override the vision model — the default is `claude-haiku-4-5`
   (roughly half a cent per screenshot; a whole semester of campus use is a few dollars).
3. Set the environment variable `BOOKSRUN_API_KEY` (free, from booksrun.com's API signup) so
   price fields fill themselves in. Without it that endpoint answers 503 and students price
   items by hand at the links — the site keeps working. (`api/resolve.js` needs no key:
   OpenLibrary is a public catalog.)
4. **Set a spend cap** on the Anthropic account. The parse endpoint validates and size-limits
   input but is publicly callable; a monthly cap bounds worst-case abuse.
5. Point the domain at the deployment.

**Netlify** works the same way (each of the three functions needs the usual Netlify wrapper if
you migrate them). **GitHub Pages** serves the static site fine but cannot run the functions —
set `parseEndpoint: null`, `priceEndpoint: null`, **and** `resolveEndpoint: null` in
`config.js` and the site runs in paste/manual mode only.

Each provider is quarantined behind one function: the vision call in
[`api/parse.js`](api/parse.js) (`extractItems`), the price source in
[`api/price.js`](api/price.js) via the pure [`api/pick-offer.js`](api/pick-offer.js), and the
ISBN match in [`api/resolve.js`](api/resolve.js) via the pure
[`api/resolve-match.js`](api/resolve-match.js) — swapping any provider touches only its file.

## Handing this off

The author graduates in December 2026. Whoever adopts this — an Associated Students senator, OER
faculty, a student club — needs:

1. This repo (fork it or get transferred ownership).
2. A Vercel account with the repo connected, an Anthropic API key with a spend cap, and a free
   BooksRun API key for price lookup.
3. The semester checklist above.
4. The discipline that keeps it credible: **nothing goes in the UI without a CLAIMS.md source**,
   and the tool must stay willing to say "stay in" when the numbers say so. A calculator that
   always says "opt out" is advocacy, and gets dismissed as advocacy.

## Repository layout

```
index.html                assets/style.css        The main page (static, no build)
why.html                  The "Why trust this?" page (sources, contract, data handling)
assets/app.js             Flow state machine: input → confirm → verdict (orchestration)
assets/config.js          ★ Semester config — the only file that needs regular editing
assets/bind.js            Binds config values + verified links into the static HTML (both pages)
assets/parse-text.js      In-browser parser for pasted text (portal-dialect aware)
assets/verdict.js         The arithmetic + recommendation rules (pure, tested)
api/parse.js              Serverless screenshot parser (the only file that calls an AI model)
api/price.js              Serverless price lookup (ISBNs in, real offers out; BooksRun)
api/pick-offer.js         Offer selection policy (pure, tested)
api/resolve.js            Serverless ISBN resolver (title+author → ISBN; OpenLibrary)
api/resolve-match.js      Title+author match scoring (pure, tested)
tests/                    node --test suites: verdict, text parser, offer selection, ISBN match
checks/                   Browser harness: e2e.mjs, design-audit.mjs, parse-live.mjs, dev-server.mjs
ARCHITECTURE.md           The pipeline, the item shape, and the knobs outside config.js
METHODOLOGY.md            Exactly how the verdict is computed, and what the tool doesn't know
CLAIMS.md                 Audit trail: every UI claim → its source
design.md                 The visual direction the design audit enforces
contract/                 The public-records production backing the claims
.claude/verify.sh         Done-gate: JS syntax check + tests
```

## License

MIT — see [LICENSE](LICENSE).
