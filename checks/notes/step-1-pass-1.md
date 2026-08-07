# Step 1 (verdict screen), pass 1 critique

Audit: 16/16 after the WCAG 2.5.8 inline-link calibration. What the audit can't see:

1. **Title truncation is too aggressive at 390px.** "Introduction to the Theory of C…" gives the
   line item almost no meaning. Cause: dot leaders eat ~30% of the row at narrow widths.
   Fix: below 480px, drop the dot leader and let the name/amount split the row; the leader is a
   wide-screen nicety, the name is the content.
2. **Deadline appears twice in one viewport on the verdict screen**: the figure panel's mono
   deadline line sits directly above the full deadline notice. Redundant, and the repetition
   reads as unintentional. Fix: hide the figure-panel line on the verdict step only (the notice
   carries it there); input/confirm keep it, which is what the every-screen rule is for.
3. **The double rule renders as a fat single line.** 3px total cannot draw two strokes and a
   gap. Fix: 4px double. The double rule is the receipt's "total" signal; it has to actually
   read as one.
4. **The fixture never exercises the access-code flag**, so the single accent role is untested
   visually (and C3 passes trivially with zero accent elements). Not fixable inside the given
   fixture; check visually in step 3 (confirm screen) where a MyLab item can be staged.
5. **Screenshots captured in dark scheme** because the shot paths didn't pin a scheme; the
   audit's measured checks did. Fix the script to shoot light (primary), and spot-check dark
   manually.
6. Accepted, not a defect: the hero is still the old layout above the new neutral tokens. It is
   step 4's surface; its presence in these shots makes the page top feel heavier than the final
   design will.

Hierarchy call: the $198.92 figure dominates correctly at all three widths; the headline
sentence under it reads as the label. Receipt metaphor: line items + rule + total land; the
figure panel above (bars) and receipt below (lines) don't fight because the bars carry no
numbers other than right-aligned mono values.
