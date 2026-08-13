DESIGN DIRECTION — istheseawolfbundleworthit

Core metaphor: a receipt, not a pricing page. The itemized comparison is the
emotional center of this tool and should read like something printed at a
register — line items, aligned decimals, a rule above the total.

Purpose: a single-purpose cost calculator that a skeptical student and a
skeptical faculty advisor both trust immediately. Closest reference points in
spirit: a tax bracket calculator, a utility bill estimator, a nutrition label.
NOT a startup landing page, NOT a campaign site.

Tone: plain, exact, unhurried, unbranded, auditable.

TYPOGRAPHY
- One workhorse sans for interface text. Not Inter, not Roboto.
- All currency, ISBNs, and unit counts in a mono or tabular-figure face so
  digits align vertically in the itemized list. This is functional, not stylistic.
- The verdict dollar difference is the largest element on the page by a wide
  margin. Everything else steps down sharply.

COLOR
- Near-neutral base. Paper, ink, one mid grey for secondary text.
- Exactly one accent color, reserved for a single role: the single-use access
  code warning flag (MyLab, MindTap, WebAssign, Cengage, Pearson, Connect, ALEKS).
- Verdict states get IDENTICAL color treatment. No green/red. No success or
  warning semantics on the recommendation itself.

LAYOUT
- Single column, generous measure. No hero section.
- Input is above the fold with at most two sentences above it.
- All explanation, methodology, and background lives BELOW the verdict.
- Three distinct screens, styled separately: input, parse-confirmation, verdict.
- The parse-confirmation screen must feel editable and inviting — fields that
  visibly want correcting, not a wall of read-only text. This is the trust surface.

MOTION
- Almost none. One exception: the verdict total settling into place after the
  user confirms. Anything more reads as marketing.

DO NOT USE
- Gradients of any kind, glassmorphism, three-card feature grids, testimonial
  sections, emoji verdicts, stock illustration, badge/pill clusters.
- SSU blue and gold, or anything resembling official university branding — this
  tool must never be mistakable for an SSU or bookstore product.
- Cream + serif + terracotta, or near-black + acid green. Both are current AI
  defaults.

COPY RULES (these are correctness rules, not style)
- Never phrase anything as what a course requires. Always "your cart shows."
- Never display a price the tool didn't source.
- Opt-out deadline is prominent on every screen.

---

## Addendum: the answer-first revision (2026-08-12, owner-approved)

The owner redirected the flow to answer-first ("most users just want the answer"), which
supersedes three lines above; everything else in this document still binds.

- **The one-word answer (No. / Yes. / Close. / Almost. / Can't say.) is now the largest
  element** on the verdict screen, not the difference figure. The figure stays on the
  receipt's Difference line at receipt scale. All answer states keep identical color
  treatment; the word carries `data-audit="verdict-figure"` so the audit's size check
  follows it.
- **A one-line hero exists on the landing step only** (title, one-sentence lede, the
  units-to-bill row). On later steps it collapses to a small brand line so the answer
  dominates.
- **Motion expanded, deliberately**: cards slide in on step changes, the answer word
  settles, receipt lines print in sequence. Everything remains disabled under
  prefers-reduced-motion.
- The long-form trust content lives on `why.html`; the deadline still appears on every
  screen (slim line on input/confirm, action line + full note on the verdict).
