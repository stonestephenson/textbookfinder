# Step 1 (verdict screen), pass 3 — fresh-eyes response

The cold reviewer (design.md + screenshots + audit output only) found what I could not see
because I was anchored: the receipt was styled like a receipt but failed its own arithmetic.
Dispositions, by its finding numbers:

Fixed:
- (1,2,3,4) Receipt restructured as a true subtraction: bundle charge first, each item deducted
  with a signed "− $x" amount, double rule, then a labeled "Difference" total right-aligned in
  the money column. The label word comes from METHODOLOGY.md's own vocabulary.
- (5) Line-item names now wrap at every width; ellipsis removed. Dot leaders kept at all widths.
- (6) Bold asymmetry gone; only the total row is emphasized.
- (7,8,15) The bar figure panel is hidden on the verdict step: the receipt is the sole numeric
  surface there, nothing methodological sits above the answer, and each number appears once.
  Bars still serve input/confirm as progress feedback.
- (10) "All 1 item accounted for" → "Your item is accounted for."
- (11) "Tap a store" → "Open a store".
- (12) Mono pulled back to figures only: progress line, priced chip, and item meta are sans;
  ISBNs keep mono digits.
- (13) Price inputs now carry a "$" prefix.
- (9, first half) "One more thing:" removed from the deadline notice.
- (390 regression caught in my own pass-3 look) "Difference" wrapped mid-word beside the
  figure; the total row stacks on narrow screens.

Disagreed / held, with reasons for the owner:
- (16) Price inputs on the verdict screen: the flow requires entering prices after seeing the
  bundle context; removing them would be a flow change, out of scope for a visual pass. The
  receipt card itself contains no form fields; the working list is a separate card below.
- (14) The two bars use two neutral fills; on the two screens where they remain, two entities
  need distinguishing and labels carry identity. No rule violated.
- (18) Retailer links are rectangular 44px buttons, not pills; held.
- (19) A copy change to correctness copy — proposed to the owner, awaiting approval, not
  applied: "If a course later needs something, you buy just that item, then." →
  "If something new shows up on your list later, you buy just that item, then." (and the
  below-fold "if your courses require a few of them" → "if your list includes a few of them").

Audit stayed 16/16 through all changes. Stopping at three passes.
