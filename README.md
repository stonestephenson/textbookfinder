# istheseawolfbundleworthit.com

A single-page calculator that tells a Sonoma State University student whether the **Seawolf
Bundle** — the $21/unit auto-enrolled course materials program — is cheaper than buying what
their own bookstore cart shows. Screenshot or paste your course materials page, confirm what was
read, find real prices at the links it gives you, and get the arithmetic.

Built by an SSU student. Not affiliated with SSU, Sonoma State Enterprises, or Barnes & Noble.

- **How the verdict is computed:** [METHODOLOGY.md](METHODOLOGY.md)
- **Every factual claim on the site, with its source:** [CLAIMS.md](CLAIMS.md)
- **The underlying contract** (public records request PRA 2026-495):
  [`contract/PRA 2026-495.pdf`](contract/PRA%202026-495.pdf)
- **Investigation background:** [SEAWOLF_BUNDLE_CONTEXT.md](SEAWOLF_BUNDLE_CONTEXT.md)

## What it never does

These are design rules, not merely current facts (see the context doc, §6):

- Never asks for SSU credentials of any kind. No login, no OAuth.
- Never scrapes the bookstore site.
- Never asserts a price it didn't source — v1 links out and the student types in what they found,
  always labeled as their own number.
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

Tests and checks (requires Node 18+):

```sh
npm test              # unit tests for the verdict math and text parser
bash .claude/verify.sh  # syntax-check all JS + run tests (the done-gate)
```

## Deploying

**Vercel (recommended — it's what makes screenshot parsing work):**

1. Import the GitHub repo into Vercel. No framework, no build command — it's static files plus
   one serverless function (`api/parse.js`).
2. Set the environment variable `ANTHROPIC_API_KEY` (get one at console.anthropic.com).
   Optional: `PARSE_MODEL` to override the vision model.
3. **Set a spend cap** on the Anthropic account. The parse endpoint validates and size-limits
   input but is publicly callable; a monthly cap bounds worst-case abuse.
4. Point the domain at the deployment.

**Netlify** works the same way (the function needs the usual Netlify function wrapper if you
migrate it). **GitHub Pages** serves the static site fine but cannot run the parse function —
set `parseEndpoint: null` in `config.js` and the site runs in paste/manual mode only.

The vision call lives entirely in [`api/parse.js`](api/parse.js) behind one function
(`extractItems`) — swapping the model or provider touches only that file.

## Handing this off

The author graduates in December 2026. Whoever adopts this — an Associated Students senator, OER
faculty, a student club — needs:

1. This repo (fork it or get transferred ownership).
2. A Vercel account with the repo connected and an Anthropic API key with a spend cap.
3. The semester checklist above.
4. The discipline that keeps it credible: **nothing goes in the UI without a CLAIMS.md source**,
   and the tool must stay willing to say "stay in" when the numbers say so. A calculator that
   always says "opt out" is advocacy, and gets dismissed as advocacy.

## Repository layout

```
index.html                assets/style.css        The page (static, no build)
assets/app.js             Flow: input → confirm → verdict
assets/config.js          ★ Semester config — the only file that needs regular editing
assets/parse-text.js      In-browser parser for pasted text
assets/verdict.js         The arithmetic + recommendation rules (pure, tested)
api/parse.js              Serverless screenshot parser (the only file that calls an AI model)
tests/                    node --test suites for verdict + text parser
METHODOLOGY.md            Exactly how the verdict is computed, and what the tool doesn't know
CLAIMS.md                 Audit trail: every UI claim → its source
SEAWOLF_BUNDLE_CONTEXT.md Investigation background and design decisions
contract/                 The public-records production backing the claims
.claude/verify.sh         Done-gate: JS syntax check + tests
```

## License

MIT — see [LICENSE](LICENSE).
