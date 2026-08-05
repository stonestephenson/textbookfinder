# CLAIMS.md — every factual assertion in the UI, with its source

**Rule:** every factual claim that appears anywhere on istheseawolfbundleworthit.com must have an
entry here with a checkable source. A claim that can't be sourced comes out of the UI. When you
change site copy or `assets/config.js`, update this file in the same commit.

**Source key:**

- **Contract** — documents produced under public records request PRA 2026-495 (filed July 10, 2026
  under the California Public Records Act, Gov. Code § 7920.000 et seq., *and* the Richard McKee
  Transparency Act, Educ. Code § 89913 et seq.; Sonoma State Enterprises responded under Educ. Code
  § 89914.5 with 56 pages, no redactions). The full production is in
  [`contract/PRA 2026-495.pdf`](contract/PRA%202026-495.pdf). Section numbers refer to the
  Operating Agreement (Oct 15, 2013) as amended by Amendment No. 1 (effective July 1, 2023).
- **Bookstore email** — email thread between the author and SSU bookstore staff, July 2026.
  Retained by the author and available for inspection on request.
- **Portal screenshot** — screenshots of the author's own bookstore portal, Fall 2026 registration,
  July 2026. Retained by the author and available for inspection on request.
- **Arithmetic** — computed from other sourced values; the formula is stated.
- **Code** — a property of this site itself, verifiable by reading this repository.

| # | Claim (as it appears in the UI) | Source |
|---|---|---|
| 1 | The Seawolf Bundle costs **$21.00 per unit** (used in all bundle-cost math and copy) | Bookstore email: "The Seawolf bundle is $21 per unit, so $210 if you are taking 10 units." |
| 2 | The Seawolf Bundle is SSU's version of Barnes & Noble's **First Day® Complete** program | Contract, Amendment No. 1 (adds the First Day Complete program); program branding per SSU bookstore materials |
| 3 | **Every undergraduate is enrolled automatically** and must opt out | Contract, Amendment No. 1 §22 (opt-out program structure; §22(v)(2) invoices SSE for credits of students who have *not opted out*); SSU bookstore program description |
| 4 | Materials are provided **mostly as rentals** | Contract, Amendment No. 1 §22 (rental-first program; §22(i)(4) non-returned-rental fees) |
| 5 | Opting out **closes at the add/drop deadline** | SSU bookstore's published Seawolf Bundle program page (publicly checkable); no specific date is shown unless `config.optOutDeadline` carries a sourced one |
| 6 | The contract price is "**an average price across all courses**" applying "**regardless of how many or whether course materials are being used in a particular course**" (quoted) | Contract, Amendment No. 1 §22(v)(1), quoted verbatim |
| 7 | The contract is between **Sonoma State Enterprises (SSE)** and **Barnes & Noble**, and SSE is the SSU auxiliary that holds it | Contract: Operating Agreement (Oct 15, 2013) between SSE and B&N College Booksellers, LLC; SSE is a CSU-authorized auxiliary organization (response made under Educ. Code § 89914.5) |
| 8 | SSE receives a commission of **10% of gross course-material sales** | Contract, §11.1 as amended (Calculated Commission: 10% of Gross Sales of Course Materials) |
| 9 | That commission category **expressly includes bundle revenue** | Contract, §11.1 as amended ("Gross Sales of Course Materials" defined to include First Day and First Day Complete revenue) |
| 10 | The per-unit price is **set each year by agreement between SSE and B&N, no later than March**, effective the following fall | Contract, Amendment No. 1 §22(v)(5) |
| 11 | The agreement contains **no cap on price increases** | Contract — no escalation cap appears anywhere in the produced agreement (verified by full read of the 56-page production) |
| 12 | The agreement **excludes no programs or schools** | Contract, Amendment No. 1 §22(iii)(3): excluded programs — "None" |
| 13 | The student price **rose from $18.50/unit (2023) to $21.00 now** | 2023: the program's published student-facing launch rate of $18.50/unit (author's records of SSU bookstore pricing pages, retained); current: bookstore email (claim #1) |
| 14 | The author's Fall 2026 cart showed **one included item across 10 registered units** | Portal screenshot |
| 15 | That item was a paperback selling online for **about $11 new (July 2026)** | Author's price capture during the July 2026 bookstore correspondence (~$11.08 new online); retained with the email thread |
| 16 | The bundle price for 10 units **is $210.00** | Arithmetic: 10 × $21.00 (claim #1); also stated verbatim in the bookstore email |
| 17 | The portal displayed "**Your estimated savings on included materials is: $67.15**" (quoted) | Portal screenshot |
| 18 | The bookstore said savings are "**calculated off publisher pricing, but there might be better deals out there**" and "**Since you only need 1 book for 10 units, the Seawolf Bundle might not be the best option for you.**" (quoted) | Bookstore email, quoted verbatim |
| 19 | **Materials can be added to a course after a student's opt-out decision** (the contract permits late faculty adoptions) | Contract, Amendment No. 1 §22(i)(2) (late adoptions permitted after the normal adoption deadlines; B&N "cannot guarantee delivery" but will use reasonable efforts) |
| 20 | **Opting out is not a lockout** — a student who opted out can buy any later-added item on their own | Structural: opting out removes a student from bundle billing only (§22(v)(2)); nothing in the produced agreement restricts an opted-out student's ability to buy materials anywhere |
| 21 | **Single-use access codes usually can't be bought used** (MyLab, MindTap, WebAssign, Connect, ALEKS, etc.) | Product characteristic of single-use licenses: codes are consumed on activation and publishers sell them as one-time use. Hedged as "usually" in all UI copy |
| 22 | The bundle **bills per unit**, so registered units set its price | Contract, Amendment No. 1 §22(v)(1) (price per credit per semester); bookstore email (claim #1) |
| 23 | All verdict figures ("$X to buy vs $Y for the bundle, difference $Z") | Arithmetic: bundle = units × $21.00; buy total = sum of prices the user typed in; difference = bundle − buy. Formulas in [`METHODOLOGY.md`](METHODOLOGY.md) |
| 24 | This site **never asks for SSU credentials**; pasted text is parsed **in the browser**; screenshots are sent once to a parsing service (the Anthropic API) and **this site never stores them**; **no analytics, no tracking, no accounts** | Code: `assets/parse-text.js` runs client-side; `api/parse.js` forwards the image to the Anthropic API for extraction and writes/logs nothing itself; no analytics scripts exist in this repository. (Handling by the Anthropic API is governed by Anthropic's own data policies — this site only vouches for what it controls.) |
| 25 | This site is **not affiliated with SSU, Sonoma State Enterprises, or Barnes & Noble** and was **built by an SSU student** | Statement of authorship; this repository |
| 26 | The contract documents were **obtained through public records request PRA 2026-495** | The request and production themselves; `contract/PRA 2026-495.pdf` |

## What the site deliberately does not claim

- **Motive or intent.** The site describes the program's structure as documented; it makes no
  claim about why anyone set it up this way.
- **Anything it cannot source.** Open questions stay off the site entirely — including any
  interpretation of contract clauses beyond their quoted text, and any figure whose derivation
  is unknown (the site quotes the portal's $67.15 display and states adjacent facts only).
- **What any course requires.** The site only ever describes what *the user's own cart shows*.
- **Prices.** The tool links out; every price in a verdict was typed in by the user and is
  labeled as theirs.
