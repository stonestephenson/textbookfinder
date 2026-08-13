# Design direction — "liquid glass" (owner-set, 2026-08-12)

The owner's reference is **apple.com with the Liquid Glass feel: minimalistic, but
purposeful.** This document replaces the previous receipt-metaphor direction entirely.
Correctness rules (claims sourcing, cart framing, confirmation gate) live in CLAUDE.md and
are untouched by any visual choice here.

## The feel

Calm, premium, confident. Few words, huge type, generous air. Content floats on frosted
glass above a softly tinted wash. Nothing looks like a form: controls read as objects
(pills, segments), not fields. One vibrant blue carries every interactive element; nothing
else competes with it.

## Tokens

- **Type:** the system stack (`-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI',
  Roboto, ...`). Headlines semibold with tight (−0.015em to −0.03em) tracking. Body ~17px.
  Numbers use `font-variant-numeric: tabular-nums`; no monospace anywhere.
- **Light:** page `#f5f5f7` under a barely-there radial wash of blue/violet; ink `#1d1d1f`;
  secondary `#6e6e73`; hairline `rgba(0,0,0,0.10)`.
- **Dark:** page `#000`–`#161617` with the same wash brightened; ink `#f5f5f7`; secondary
  `#a1a1a6`; hairline `rgba(255,255,255,0.16)`.
- **Accent (interactive only):** `#0071e3` light / `#2997ff` dark — buttons and links, nothing
  else.
- **Warning (access-code flags only):** Apple orange (`#c93400` light / `#ff9f0a` dark). Never
  used decoratively.
- **Glass:** cards and the drop zone are translucent surfaces —
  `backdrop-filter: blur(18px) saturate(1.8)`, background `rgba(255,255,255,0.62)` light /
  `rgba(28,28,30,0.55)` dark, a 1px inner light edge, soft wide shadow, radius 20–24px.
  Buttons and segmented controls are full pills.

## Structure

- Hero text and the landing flow are **centered**. The units control is a pill segment
  inside a sentence. One glass capture zone, one blue pill CTA. Tiny gray links for the
  alternates.
- The answer screen leads with the giant answer word (gradient ink, identical treatment for
  every state — the site never colors Yes differently from No). The cost summary is an
  Apple-bag-style list: hairline-separated rows, right-aligned tabular numbers, emphasized
  total. No dotted leaders.
- The deadline appears on every screen (slim line or action line).
- Motion glides: cards rise and fade on `cubic-bezier(0.32, 0.72, 0, 1)`, the answer word
  settles from a slight blur, list rows cascade a few tens of ms apart. Everything obeys
  `prefers-reduced-motion`.

## Still banned

- Color-coding the verdict states differently from one another (neutrality is a trust
  feature; all states share one treatment).
- The warning orange anywhere except access-code flags.
- Dense form scaffolding: visible steppers, numbered instructions, boxed fieldsets.
- Em dashes in copy; advocacy phrasing; anything CLAUDE.md's invariants forbid.

## Audit

`checks/design-audit.mjs` enforces this direction: glass materials on cards, pill CTAs, the
accent-discipline rules above, tabular right-aligned money, the answer word as the dominant
element, contrast/targets/labels/tab-order, deadline on every screen, and the
course-requirement grep. Recalibrations must be disclosed in the run output or notes.
