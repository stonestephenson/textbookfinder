# How the verdict is computed

This page documents exactly what istheseawolfbundleworthit.com calculates, where every number
comes from, and — just as important — what the tool does *not* know. If you think a number is
wrong, this is the specification to check it against. Every factual claim on the site is
separately sourced in [CLAIMS.md](CLAIMS.md).

## The two numbers being compared

**Bundle cost** — pure arithmetic:

```
bundle cost = (units you told us you're registered for) × $21.00
```

$21.00/unit is the bookstore's stated Seawolf Bundle rate, confirmed in writing
(CLAIMS.md #1). The tool does not add tax or fees to this number; your portal shows your exact
charge. All comparison math is done in whole cents — each entered price is rounded to the cent
when totals are computed — so totals never drift by a penny.

**Buy-it-yourself total** — the sum of one price per item:

```
buy total = sum over items of (fetched offer | capture-listed price | your number)
```

Each item's price comes from exactly one of three labeled sources, and you can override any of
them:

1. **A fetched offer.** For items with an ISBN, the tool asks its price source (below) for real,
   currently purchasable offers and fills in the cheapest one, shipping included. The line names
   the store, the condition or rental length, and links to the offer so you can check it.
2. **The price printed in your own capture** — access codes only. Stores don't usually sell
   single-use codes used, so when your uploaded screenshot shows a real listed price for one,
   that price is used and labeled "listed in your own capture." Guards: a printed "$0.00",
   "included", or struck-through figure is bundle framing, not a price, and is never recorded;
   an uncertain read is flagged instead of used; the value appears editable on the confirm
   screen before anything is computed. Bookstore prices are **never** used for books this way:
   a bookstore's book price is not a market price.
3. **A number you typed.** Tap "change" on any line, or use the search links (Amazon, AbeBooks,
   eBay — by ISBN when your cart showed one, otherwise by title) for items nothing was found for.
   Your number always wins over a fetched one.

The tool never estimates, averages, or invents a price. Every price in the math is one of the
three above, and each is labeled in the UI with which one it is.

## Where the fetched prices come from

The price source is **BooksRun** (booksrun.com), queried live by ISBN at the moment you confirm
your list — the only free, documented purchase-price API the author found that permits plain,
untagged links (`api/price.js`; selection logic in `api/pick-offer.js`, which is fully
unit-tested). Selection rules:

- Candidates are real purchasable offers: BooksRun's own used/new stock, its marketplace
  sellers' used/new stock, and rentals of **110 days or longer** (a fall or spring term,
  first day through finals). The bundle is rental-first, so a term-length rental is a fair
  comparable; a 90-day rental that ends before finals is not, and is excluded even when
  cheaper.
- Ebook offers are excluded: platform access isn't ownership and muddies the comparison.
- For **access-code items, only new offers count**: a used or rented access card is usually
  already consumed and worthless, so those offers are discarded even when cheapest.
- The compared number is always **price plus shipping**.
- Each offer links to the store's catalog page for that ISBN (an address built from the ISBN
  and title). The API's own offer links are session-bound cart actions carrying an affiliate
  tag, so they are never used: no link on this site carries a referral parameter of any kind
  (CLAIMS.md #30).

**What this source does not cover, and which way that errs:** Amazon and other large retailers
don't offer usable price APIs (Amazon's requires an active affiliate relationship and mandates
tagged links, both incompatible with this site's no-earnings rule). A cheaper copy may therefore
exist elsewhere — which means fetched totals are an **upper bound** on what a diligent shopper
pays. An "opt out" verdict can only get stronger with better shopping; the direction of error
runs toward "stay in," the conservative direction. The flip side is stated where it matters:
because a cheaper copy elsewhere is exactly what could overturn a "stay in" or "it's close"
call, those verdicts carry a visible reminder that prices came from one store and every item
keeps its search links so you can beat the found price and type in what you find.

Two limits on the upper-bound argument itself: it covers fetched **book** offers only — a
capture-listed access-code price is your bookstore's listing, which can differ from the
publisher's direct price (the UI says to check the publisher) — and it assumes a found offer is
a genuine substitute, which is why used or rental offers are never accepted for access codes
(a used code is usually already consumed).

Offers are live inventory and can change between lookup and purchase. The verdict page says so,
and no fetched price is stored anywhere.

## When your page shows no ISBN

The bundle portal prints no ISBNs at all (verified on a real student capture). For an item that
carries an author, the tool asks OpenLibrary's public catalog for a match and fills the ISBN in.
The rules are deliberately strict (`api/resolve-match.js`, fully unit-tested):

- **An author is required.** Title-only matching confidently picks wrong books (verified: a
  title-only search for a theory-of-computation text returned a different author's textbook).
  Items without an author simply stay on the manual path.
- The author's surname must appear among the match's authors, and the titles must substantially
  overlap after normalizing bookstore shorthand ("INTRO.TO", "(PB)").
- When the page shows an edition year ("3RD 13"), a match from that year is preferred.
- A weak match resolves to nothing rather than to a guess.
- **Every match is shown on the confirm screen** ("Matched to …, wrong book? edit") before any
  price is looked up against it, and the filled ISBN is editable like everything else.

## The recommendation rules

Let `difference = bundle cost − buy total`.

| Situation | Verdict |
|---|---|
| Every item priced, `difference > $21.00` | **Opt out** — buying on your own looks cheaper by `difference` |
| Every item priced, `difference < −$21.00` | **Stay in** — the bundle looks cheaper |
| Every item priced, within **$21.00** either way | **It's close** — the tool refuses to call a winner and lists the non-price factors instead (staying in is one flat charge with nothing to hunt down; bought books are yours to keep or resell; materials can be added later; opting out is not a lockout) |
| Some items not yet priced | **No verdict** — with one exception below |
| Some items not yet priced, but the priced ones *already* exceed bundle cost by more than $21.00 | **Stay in**, early — adding more prices can only make buying more expensive, so this conclusion is safe before all prices are in. The reverse is never true: the tool will not recommend opting out until every item is priced or explicitly skipped |
| Items marked "couldn't find it" | They are excluded from the buy total and the verdict says so ("based on N of M items"). A skipped item means the buy total is an **under**estimate, so any opt-out verdict is shown with an explicit caveat |
| **Every** item marked "couldn't find it" | **No verdict.** With zero entered prices there is no basis for a comparison, and the tool refuses to invent one |
| Cart shows no items | Buying nothing costs $0.00, so the verdict states the full bundle cost — with the reminder that materials can still be added later. (The close band does not apply here: it exists to absorb noise in entered prices, and an empty cart involves none) |

The **$21.00 "close" band** equals one unit's bundle price. It is a deliberate refusal to
over-claim precision: within that band, the price difference is smaller than the noise in the
inputs (shipping, condition, price movement between when you looked and when you buy).
It is set in `assets/config.js` (`closeThreshold`).

## Access codes

Items whose title or format indicates single-use courseware (MyLab, MindTap, WebAssign, Connect,
ALEKS, Revel, Achieve, zyBooks, and similar — full pattern list in `assets/config.js`) are
flagged, because they usually cannot be bought used and typically must be purchased new from the
publisher. They flow through the same arithmetic as everything else. **If new access codes make
buying more expensive than the bundle, the tool says to stay in.** This tool is a calculator,
not a campaign: whichever number is lower wins.

Courseware has **no automatic price source** — publishers (zyBooks, Pearson, Cengage, McGraw
Hill, Macmillan, and others) sell direct, and no catalog API exposes those prices, so the used-book
lookup and the ISBN matcher deliberately skip access codes. The one automatic price for a code is
the figure printed in your own capture (extracted like any other, used only for access codes). When
the capture shows no price, the item links to **its publisher** (from `assets/config.js`), not a book
marketplace: one tap to the only place that sells it, where you read the real price and enter it.

## What the tool parses, and why you confirm it

Input is your own bookstore course-materials page — one or more screenshots or a full-page PDF
capture (read by an automated reading service, which merges overlapping captures), or pasted
text (parsed entirely in your browser by deterministic rules). Parsing is imperfect by nature,
so:

- **Nothing is computed until you confirm the parsed list.** Every field is editable.
- Fields the parser wasn't sure about are highlighted for your attention rather than guessed at.
- Prices printed on the bookstore page are recorded only as what they are — the page's listed
  price — and used **only for access codes** (see above). Book prices from the bookstore never
  enter the math: bookstore rental prices aren't what you'd pay elsewhere.

A parse error therefore becomes a correction you make, never a silent wrong answer.

## What the tool does not know

- **Tomorrow's prices.** Fetched offers are real at the moment of lookup, with shipping
  included and condition shown when the seller states it — but they are live inventory. The
  tool cannot know about counterfeits, seller reliability, or a price that changed an hour
  later, which is why every offer is linked for you to check before buying.
- **What your courses require.** It only ever reads what *your cart showed when you captured it*.
  Materials can be added after your opt-out decision (late faculty adoptions are permitted by the
  contract — CLAIMS.md #19), which is why the site tells you to check your cart again near the
  deadline, and why opting out is not a lockout (CLAIMS.md #20).
- **Your opt-out deadline date.** Unless a verified date for the current term is configured, the
  site points you to your own portal for the exact date.
- **The value of ownership vs rental.** Most physical bundle items are rentals you return; books
  you buy are yours to keep or resell. The "it's close" verdict lists this; the arithmetic
  doesn't price it.
- **Financial aid interactions.** How bundle charges and out-of-pocket purchases interact with
  your aid package is between you and the financial aid office.

## Data handling

No accounts, no database, no analytics, no tracking. Pasted text never leaves your browser.
Captures (screenshots or a full-page PDF) are sent once to the parsing endpoint, which forwards
them to a third-party reading service to extract the item list — course code, title, format,
ISBN, and any printed per-item price — and nothing else; this site stores neither the capture
nor the result. Price lookups send **only the ISBNs** from your confirmed list to the price
source — never titles, courses, units, or anything that identifies you. (Handling by those
providers is governed by their own data policies; this site vouches only for what it controls.)
The site's full source, including this file's history, is public in
[the repository](https://github.com/stonestephenson/textbookfinder).
