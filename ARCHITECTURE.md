# ARCHITECTURE.md — the pipeline, the data model, and the knobs outside config.js

`METHODOLOGY.md` says *what* the tool computes and *why* (the policy). This file says *how the
code is wired* — read it before editing `assets/app.js` or any `api/` file. It is the map a cold
agent needs to change behavior without reverse-engineering the state machine.

## The flow

Three steps, one direction, confirmation in the middle (`assets/app.js` `showStep`):

```
input  ──▶  confirm  ──▶  verdict
(capture)   (edit + OK)   (answer)
```

Input arrives three ways, all normalized to one item shape by `adoptItems()`:

- **Screenshot / PDF** → `POST /api/parse` (Claude vision) → items. Client-side image prep
  (downscale, tall-image slicing) happens first in `prepareImage()`.
- **Pasted text** → `assets/parse-text.js` `parseText()`, entirely in-browser (no network).
- **Manual** → one `emptyItem()`.

On landing at **confirm**, and again when the user presses "Do the math", the pricing pipeline
runs over the confirmed items, in this exact order:

```
applyCapturePrices()   access-code items only: use the price printed in the capture
resolveMissingIsbns()  items with title+author but no ISBN: fill ISBN from OpenLibrary
fetchPrices()          items with an ISBN and no price yet: fetch the cheapest real offer
computeVerdict()       pure math over whatever prices now exist  (assets/verdict.js)
```

Each stage only fills a price when the item doesn't already have one (see precedence below), so
the stages compose without fighting. `computeVerdict()` runs continuously as prices land and as
the user edits, re-rendering the answer.

## The item shape (the data model)

Every item — from any input source — is this object (`emptyItem()` / `adoptItems()` in
`assets/app.js`). There is no schema file; this is it:

| Field | Meaning |
|---|---|
| `id` | stable key for rendering |
| `courseCode`, `title`, `format`, `isbn`, `author`, `edition` | parsed fields; `format` ∈ `physical`/`digital`/`access_code`/`unknown` |
| `isAccessCode` | derived: `format === 'access_code'` OR title matches `config.accessCodePatterns` |
| `listedPrice` | a price **printed in the user's own capture** (access codes only; strictly > 0) |
| `userPrice` | the number that enters the math (from any source below) |
| `priceSource` | **where `userPrice` came from** — `'auto'` (fetched offer), `'capture'` (listed in the upload), `'user'` (typed), or `null` |
| `offer` | metadata of a fetched offer: `kind`, `seller`, `rentDays`, `url`, `fetchedAt` |
| `resolved` | set when the ISBN was found by title+author match: `{ title, author, year }` (shown on confirm as "Matched to…") |
| `skipped` | user marked "couldn't find it"; excluded from the buy total |
| `confidence` | per-field `'high'`/`'low'`; `'low'` highlights the field on confirm |
| `expandedUi`, `resolving` | transient UI state (card open; resolution in flight) |

**`priceSource` precedence — the one rule that governs pricing:** a user-typed price always
wins. `applyCapturePrices()` and `fetchPrices()` fill `userPrice` **only when it is `null`**, and
editing the price field sets `priceSource = 'user'`, which nothing later overwrites. So the order
of the pipeline stages is a fallback chain, not a race.

**Cross-file contract:** `api/parse.js` `RESULT_SCHEMA` mirrors what the client reads. Items feed
`adoptItems()`; the two top-level fields `listCutOff` (boolean) and `courses` (`[{code, title}]`,
the full registered-course list including no-material courses) feed the confirm-screen note and
the units estimate directly. If you add or rename any parsed field, change **both** the schema
and the client that trusts it.

**The units estimate** (screenshot path only). After `adoptItems()`, `applyUnitsEstimate()` in
`assets/app.js` seeds the units field from `body.courses`: `estimateUnits()`
(`assets/estimate-units.js`, pure/tested) normalizes each code to the join key (`CS 454 001` →
`CS 454`) and sums units from `assets/course-units.js`. That table is **generated**, not
hand-edited — `scripts/build-course-units.mjs` builds it from the term's Schedule of Classes
(`data/`) via the pure `scripts/parse-schedule.js` (tested), resolving variable-unit courses to
the rounded median of their offerings and stamping the term. The seed is applied only when the
capture wasn't flagged cut off, the table's term matches `config.term`, and the user hasn't
touched units (`state.unitsTouched`). It is a better default, never an assertion — always
editable, nothing computed until confirmed. Regeneration is a per-semester step (README).

**Stale-lookup guard:** `fetchSeq` (a monotonic counter) invalidates an in-flight price fetch
when the user leaves the step or edits the list; `resolveInFlight` makes resolution single-flight.
Both exist so a slow network response can't clobber a newer user edit. Don't remove them.

## The endpoints (all under `api/`, all optional)

| Endpoint | Provider | Key | Pure core | Config toggle |
|---|---|---|---|---|
| `/api/parse` | Claude vision (`@anthropic-ai/sdk`) | `ANTHROPIC_API_KEY` | — (prompt + schema) | `parseEndpoint` |
| `/api/resolve` | OpenLibrary (public) | none | `api/_resolve-match.js` | `resolveEndpoint` |
| `/api/price` | BooksRun | `BOOKSRUN_API_KEY` | `api/_pick-offer.js` | `priceEndpoint` |

Every endpoint degrades to null-safe: set its `config.*Endpoint` to `null`, or let it 503, and
the flow keeps working with manual pricing. The pure cores hold the provider selection policy and
are unit-tested; the handler files are just validation + fetch + the pure call. (One pricing rule
lives outside them: the access-code "new offers only" filter is applied client-side in
`assets/app.js` `fetchPrices`, because `_pick-offer.js` matches by ISBN and never sees an item's
type.) Swapping a provider
touches one handler + its pure core, nothing else. Response shapes for BooksRun and OpenLibrary
are documented in the test headers (`tests/pick-offer.test.js`, `tests/resolve-match.test.js`).

## Tuning knobs that live OUTSIDE config.js

`assets/config.js` holds everything a semester maintainer touches (rate, deadline, patterns,
courseware map, endpoint toggles — see its comments and the README checklist). The constants
below are behavioral tuning, deliberately in code, and are the ones you'd reach for to change
precision/robustness:

**ISBN matcher** (`api/_resolve-match.js`) — governs false-match rate:
- `overlap < 0.6` (title-token overlap acceptance floor). Lower = more matches, more wrong ones;
  higher = fewer, safer. This is the single knob for match precision/recall.
- year pivot `<= 50` in `editionYear()` (two-digit year → 20xx vs 19xx; "13" → 2013).

**Offer selection** (`api/_pick-offer.js`):
- `MIN_RENT_DAYS = 110` (a rental shorter than a term isn't a fair comparable to the bundle).
  Rationale sourced in METHODOLOGY + CLAIMS #38.

**Units estimate**:
- `config.assumedUnitsPerCourse = 3` (units for a course the table doesn't carry — the one knob
  in `config.js`, since a maintainer might tune it per campus).
- Variable-unit resolution = rounded **median** of a course's offered values, in
  `scripts/parse-schedule.js` (build time). Median, not first-seen, so it's deterministic and
  representative; change it there if a better central estimate is wanted.

**Client capture pipeline** (`assets/app.js` `prepareImage`) — image prep before upload:
- `MAX_EDGE = 2000` (downscale long edge), `MAX_BYTES = 2_500_000`, JPEG quality `0.85`.
- `sliceH = bitmap.width * 2` and trigger `height > sliceH * 1.4 && height > 2200`: a tall
  full-page capture is sliced into overlapping segments because downscaling it whole makes text
  unreadable. Seam overlap 6% (an item cut at a seam appears in the next slice). `MAX_PARTS = 4`.

**Endpoint limits / timeouts** (each `api/*.js`):
- parse: `MAX_IMAGES = 4`, `MAX_BASE64_LENGTH = 4 MiB`.
- price: `MAX_ISBNS = 20`, `CONCURRENCY = 4`, `UPSTREAM_TIMEOUT_MS = 10_000`.
- resolve: `MAX_ITEMS = 10`, `CONCURRENCY = 3`, `UPSTREAM_TIMEOUT_MS = 12_000`; client retries
  once (`resolveMissingIsbns` internal, ~2s backoff) because a cold OpenLibrary query can be slow.
- price + resolve set `export const maxDuration = 30` so Vercel lets a slow upstream finish.

## The text parser, briefly

`assets/parse-text.js` turns pasted portal text into items. It splits on blank lines into blocks,
then each block into segments (a new segment starts at a second ISBN or a title after the current
item already has one). The B&N bundle portal prints **no ISBNs**, so segments are also rescued by
`cartMarker` (a bare INCLUDED/REQUIRED chip or "Physical Item"/"Digital Item" line) and
`hasByline` (a "by AUTHOR | Edition: …" line, which also fills `author`/`edition`). Items printed
twice (card + detail) are merged by normalized title. The bundle *welcome* screen (summary counts,
no item details) is detected and gets a specific "open each course" message. The comments in that
file are the spec; keep them current when a new portal layout is taught.
