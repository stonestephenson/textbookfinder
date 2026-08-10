# Step 3 (parse-confirmation screen), pass 1 critique

Audit: 16/16. The fixture parses cleanly, so the screen's defining behavior is invisible in the
standard shots; a staged variant (invalid ISBN checksum, missing format line, plus a MyLab
item) was captured to inspect it. Findings:

1. The uncertainty treatment works as designed: low-confidence fields get the heavy ink border
   and the "(check this, the tool wasn't sure)" hint, and focus lands on the first uncertain
   field on arrival, cursor ready. This is the "fields that visibly want correcting" behavior;
   confident fields stay quiet, boxed, clearly editable.
2. First live sighting of the accent: the amber access-code flag is the only color on the page,
   as the brief reserves. Its parenthetical explanation made it shout across two uppercase
   lines; split into a short accent flag plus a grey plain-text explanation, matching the
   verdict card's pattern.
3. "Item 1 of 2 / Item 2 of 2" mono eyebrows give the card list a form register and make the
   parse count auditable at a glance.
4. Kept: boxed inputs over paper-form underlines. DESIGN.md's "fields that visibly want
   correcting" could be read as underline-only fields; boxed fields with visible borders are
   the stronger editability affordance per the GOV.UK research, and usability findings
   outrank aesthetics in the stated precedence.
5. Kept: the uppercase h2 renders the confirm question as "DOES THIS MATCH YOUR LIST?" -
   slightly loud for a question, but consistent with the label-style h2 system across all
   three screens. Flagged for the owner rather than special-cased.
6. Staged-shot right-edge clipping is the headless minimum-window crop artifact from the
   harness, not a layout bug (the measured audit runs at 768 confirm this).
