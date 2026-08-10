# Step 3 (parse-confirmation screen), pass 2 — fresh-eyes response

The cold reviewer graded the screen "closer to editable-and-inviting than wall-of-fields" and
confirmed the trust behaviors work; its deviations, by number:

Fixed:
- (1) ISBN values now set in mono/tabular in the confirm fields — the one field the brief's
  typography rule names, and the core visual-diff act on this screen.
- (2) Fields sized to their content like receipt columns: course ~12rem, ISBN/format ~17rem,
  title full width. The uniform-rectangles wall is gone.
- (3) When a field is flagged uncertain, the flag now replaces the label's parenthetical, so
  "optional" never sits next to "check this", and the two-parenthetical pileup can't occur.
- (4) Uncertainty and focus no longer share a vocabulary: uncertain fields wear a proofreader's
  4px left-edge mark; the focus ring stays the all-around offset outline.
- (7) The hint dropped to regular weight; the label noun now outweighs its qualifier.
- (8) One border-level of padding returned to the inputs at 390.
- (9) "The buying bar" jargon replaced with the row's own on-screen label.
- (10) The deadline line bumped to semibold; still mono, still stamp-like.

Verified moot by measurement (documented, no change):
- (5) The pinned figure already tracks the confirm-step units field live via the input
  listener added in an earlier audit round; the two unit counts cannot diverge.
- (6) The accent measures hue ~32° in both schemes (burnt orange). The audit's gold-band
  detector polices 44–56°; athletic gold sits inside it, the accent does not.

Evidence-gap answer for the record: the interface face is Public Sans (self-hosted), the mono
is the system stack; the automated L2 check verifies the primary family every run.

Audit 16/16, tests 28/28. Stopping at two passes.
