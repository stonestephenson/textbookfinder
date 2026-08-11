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
| 1 | The Seawolf Bundle costs **$21.00 per unit** (used in all bundle-cost math and copy) | SSU's official bundle site, seawolfbundle.sonoma.edu — "$21.00 per credit hour" (verified 2026-08-05); independently confirmed by bookstore email: "The Seawolf bundle is $21 per unit, so $210 if you are taking 10 units." |
| 2 | The Seawolf Bundle is SSU's version of Barnes & Noble's **First Day® Complete** program | Contract, Amendment No. 1 (adds the First Day Complete program); program branding per SSU bookstore materials |
| 3 | **Every undergraduate is enrolled automatically** and must opt out | Contract, Amendment No. 1 §22 (opt-out program structure; §22(v)(2) invoices SSE for credits of students who have *not opted out*); SSU bookstore program description |
| 4 | The program is **rental-first — most physical items must be returned** at term's end | Contract, Amendment No. 1 §22 (rental-first program structure; §22(i)(4) sets fees for non-returned rentals) |
| 5 | Opting out **closes at the add/drop deadline** | SSU bookstore's published Seawolf Bundle program page (publicly checkable); no specific date is shown unless `config.optOutDeadline` carries a sourced one |
| 6 | The contract price is "**an average price across all courses**" applying "**regardless of how many or whether course materials are being used in a particular course**" (quoted) | Contract, Amendment No. 1 §22(v)(1), quoted verbatim |
| 7 | The contract is between **Sonoma State Enterprises (SSE)** and **Barnes & Noble**, and SSE is the SSU auxiliary that holds it | Contract: Operating Agreement (Oct 15, 2013) between SSE and B&N College Booksellers, LLC; SSE is a CSU-authorized auxiliary organization (response made under Educ. Code § 89914.5) |
| 8 | SSE receives a commission of **10% of gross course-material sales** | Contract, §11.1 as amended (Calculated Commission: 10% of Gross Sales of Course Materials) |
| 9 | That commission category **expressly includes bundle revenue** | Contract, §11.1 as amended ("Gross Sales of Course Materials" defined to include First Day and First Day Complete revenue) |
| 10 | The per-unit price is **set each year by agreement between SSE and B&N, no later than March**, effective the following fall | Contract, Amendment No. 1 §22(v)(5) |
| 11 | The agreement contains **no cap on price increases** | Contract — no escalation cap appears anywhere in the produced agreement (verified by full read of the 56-page production) |
| 12 | The agreement **excludes no programs or schools** | Contract, Amendment No. 1 §22(iii)(3): excluded programs — "None" |
| 13 | The student price **rose from $18.50/unit (2023) to $21.00 now** | 2023: the program's published student-facing launch rate of $18.50/unit (author's records of SSU bookstore pricing pages, retained); current: bookstore email (claim #1) |
| 14 | *(retired from UI 2026-08-10, the $67.15 story was removed; kept for reference)* The author's Fall 2026 cart showed **one included item across 10 registered units** | Portal screenshot |
| 15 | *(retired from UI 2026-08-10, the $67.15 story was removed; kept for reference)* That item was a paperback selling online for **about $11 new (July 2026)** | Author's price capture during the July 2026 bookstore correspondence (~$11.08 new online); retained with the email thread |
| 16 | *(retired from UI 2026-08-10, the $67.15 story was removed; kept for reference)* The bundle price for 10 units **is $210.00** | Arithmetic: 10 × $21.00 (claim #1); also stated verbatim in the bookstore email |
| 17 | *(retired from UI 2026-08-10, the $67.15 story was removed; kept for reference)* The portal displayed "**Your estimated savings on included materials is: $67.15**" (quoted) | Portal screenshot |
| 18 | *(retired from UI 2026-08-10, the $67.15 story was removed; kept for reference)* The bookstore said savings are "**calculated off publisher pricing, but there might be better deals out there**" and "**Since you only need 1 book for 10 units, the Seawolf Bundle might not be the best option for you.**" (quoted) | Bookstore email, quoted verbatim |
| 19 | **Materials can be added to a course after a student's opt-out decision** (the contract permits late faculty adoptions) | Contract, Amendment No. 1 §22(i)(2) (late adoptions permitted after the normal adoption deadlines; B&N "cannot guarantee delivery" but will use reasonable efforts) |
| 20 | **Opting out is not a lockout** — a student who opted out can buy any later-added item on their own | Structural: opting out removes a student from bundle billing only (§22(v)(2)); nothing in the produced agreement restricts an opted-out student's ability to buy materials anywhere |
| 21 | **Single-use access codes usually can't be bought used** (MyLab, MindTap, WebAssign, Connect, ALEKS, etc.) | Product characteristic of single-use licenses: codes are consumed on activation and publishers sell them as one-time use. Hedged as "usually" in all UI copy |
| 22 | The bundle **bills per unit**, so registered units set its price | Contract, Amendment No. 1 §22(v)(1) (price per credit per semester); bookstore email (claim #1) |
| 23 | All verdict figures ("$X to buy vs $Y for the bundle, difference $Z") | Arithmetic: bundle = units × $21.00; buy total = sum of prices the user typed in; difference = bundle − buy. Formulas in [`METHODOLOGY.md`](METHODOLOGY.md) |
| 24 | This site **never asks for SSU credentials**; pasted text is parsed **in the browser**; captures (screenshots or a full-page PDF) are sent once to **an automated reading service** and **this site never stores them**; **no analytics, no tracking, no accounts** | Code: `assets/parse-text.js` runs client-side; `api/parse.js` forwards the capture to the vision model provider (the Anthropic API — named here for auditability, generic in UI copy) and writes/logs nothing itself; no analytics scripts exist in this repository. (Handling by the provider is governed by its own data policies — this site only vouches for what it controls.) |
| 25 | This site is **not affiliated with SSU, Sonoma State Enterprises, or Barnes & Noble** and was **built by an SSU student** | Statement of authorship; this repository |
| 26 | The contract documents were **obtained through public records request PRA 2026-495** | The request and production themselves; `contract/PRA 2026-495.pdf` |
| 27 | The bundle costs **"$315 a semester at a full 15-unit load"** | Arithmetic: 15 × $21.00 (claim #1) = $315.00; SSU's bundle site states the same figure ("$315" for 15 credits, verified 2026-08-05) |
| 28 | *(retired from UI 2026-08-10, the $67.15 story was removed; kept for reference)* The documented case was **"a $198.92 overpayment, presented as a $67 gain"** | Arithmetic: $210.00 (claim #16) − $11.08 (claim #15) = $198.92; the "$67 gain" is the portal's $67.15 savings banner (claim #17) |
| 29 | **Opt-out deadline for Fall 2026: Friday, September 4, 2026 — the last day of add/drop** | seawolfbundle.sonoma.edu (Fall 2026 opt-out window closes September 4, 2026) and registrar.sonoma.edu/academic-calendar (Fall 2026 add/drop deadline September 4, 2026); both verified 2026-08-05. Stored in `assets/config.js` with this source noted |
| 30 | **"Nothing stored, no tracking, no ads … this site earns nothing either way"** | Code: this repository contains no advertising, affiliate, referral, analytics, or storage code of any kind; see also #24 |
| 31 | **"You sign in on SSU's own page. This site never sees your login."** | Code + link target: the My Course Materials button links to the bookstore's SSO endpoint, which redirects to login.sonoma.edu; no credential field exists anywhere on this site |
| 32 | **"If the answer is 'keep the bundle,' we'll say that, loud and clear"** | Code: `assets/verdict.js` returns `stay_in` whenever the user's numbers favor the bundle, and the UI gives it the same check-mark treatment as opting out; see METHODOLOGY.md (access codes) |
| 33 | The linked opt-out page is **"the official opt-out page"** | The URL in `assets/config.js` (`optOutUrl`) is identical to the opt-out link published on SSU's own bundle site, seawolfbundle.sonoma.edu (verified 2026-08-05) |
| 35 | **"Unless you opt out, SSU bills you $X for it this semester"** (the hero's live figure) | Automatic enrollment with opt-out: claim #3; the dollar figure is arithmetic, the units you set × $21.00 (claim #1) |
| 34 | *(retired from UI 2026-08-06 — kept for reference)* "Nobody shows you the math for your classes" | Portal screenshot: the enrollment screen displays a single "estimated savings" figure with no itemized calculation, no per-course comparison, and no method shown anywhere in the portal; bookstore email (claim #18): staff, asked for the calculation, could not provide it and referred to publisher pricing |

## What the site deliberately does not claim

- **Motive or intent.** The site describes the program's structure as documented; it makes no
  claim about why anyone set it up this way.
- **Anything it cannot source.** Open questions stay off the site entirely — including any
  interpretation of contract clauses beyond their quoted text, and any figure whose derivation
  is unknown.
- **What any course requires.** The site only ever describes what *the user's own cart shows*.
- **Prices.** The tool links out; every price in a verdict was typed in by the user and is
  labeled as theirs.
