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
charge. All money math is done in integer cents — there is no floating-point rounding anywhere
in the comparison.

**Buy-it-yourself total** — the sum of prices **you** typed in:

```
buy total = sum of the "best price you found" you entered for each item
```

The tool never looks up, estimates, or asserts a price on its own. It gives you search links
(Amazon, AbeBooks, eBay — by ISBN when your cart showed one, otherwise by title) and you type in
what you actually found. The verdict is only as good as the prices you enter — the tool does not
verify them.

## The recommendation rules

Let `difference = bundle cost − buy total`.

| Situation | Verdict |
|---|---|
| Every item priced, `difference > $21.00` | **Opt out** — buying on your own looks cheaper by `difference` |
| Every item priced, `difference < −$21.00` | **Stay in** — the bundle looks cheaper |
| Every item priced, within **$21.00** either way | **It's close** — the tool refuses to call a winner and lists the non-price factors instead (rentals must be returned; bought books are yours; materials can be added later) |
| Some items not yet priced | **No verdict** — with one exception below |
| Some items not yet priced, but the priced ones *already* exceed bundle cost by more than $21.00 | **Stay in**, early — adding more prices can only make buying more expensive, so this conclusion is safe before all prices are in. The reverse is never true: the tool will not recommend opting out until every item is priced or explicitly skipped |
| Items marked "couldn't find it" | They are excluded from the buy total and the verdict says so ("based on N of M items"). A skipped item means the buy total is an **under**estimate, so any opt-out verdict is shown with an explicit caveat |
| Cart shows no items | Buying nothing costs $0.00, so the verdict is the full bundle cost — with the reminder that materials can still be added later in the term |

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

## What the tool parses, and why you confirm it

Input is your own bookstore course-materials page — a screenshot (read by a vision model on the
server) or pasted text (parsed entirely in your browser by deterministic rules). Parsing is
imperfect by nature, so:

- **Nothing is computed until you confirm the parsed list.** Every field is editable.
- Fields the parser wasn't sure about are highlighted for your attention rather than guessed at.
- Prices that appear on the bookstore page are deliberately **ignored** during parsing — the tool
  never ingests a price it didn't source, and bookstore rental prices aren't what you'd pay
  elsewhere anyway.

A parse error therefore becomes a correction you make, never a silent wrong answer.

## What the tool does not know

- **Real prices.** It links out; you supply what you found. It cannot know about shipping,
  condition, counterfeits, or a price that changed an hour later.
- **What your courses require.** It only ever reads what *your cart showed when you captured it*.
  Materials can be added after your opt-out decision (late faculty adoptions are permitted by the
  contract — CLAIMS.md #19), which is why the site tells you to check your cart again near the
  deadline, and why opting out is not a lockout (CLAIMS.md #20).
- **Your opt-out deadline date.** Unless a verified date for the current term is configured, the
  site points you to your own portal for the exact date.
- **The value of ownership vs rental.** Bundle items are mostly rentals you return; books you buy
  are yours to keep or resell. The "it's close" verdict lists this; the arithmetic doesn't price it.
- **Financial aid interactions.** How bundle charges and out-of-pocket purchases interact with
  your aid package is between you and the financial aid office.

## Data handling

No accounts, no database, no analytics, no tracking. Pasted text never leaves your browser.
Screenshots are sent once to the parsing endpoint, which forwards them to the Anthropic API to
extract item titles and nothing else; this site stores neither the image nor the result.
The site's full source, including this file's history, is public in
[the repository](https://github.com/stonestephenson/textbookfinder).
