#!/usr/bin/env node
// Automated design audit for istheseawolfbundleworthit.com.
//
// Renders the real site in headless Chrome (driven over CDP via Node's native
// WebSocket, no dependencies), walks it into each screen and verdict state
// with a hardcoded fixture (10 units, one ~$11 paperback), and reports
// PASS/FAIL with measured values for every item in the design brief's
// checklist. Run it repeatedly:
//
//   node checks/design-audit.mjs             # audit, table to stdout
//   node checks/design-audit.mjs --shots     # also save 390/768/1440 screenshots
//                                            #   per screen to checks/shots/
//
// Exit code 0 = all checks pass, 1 = failures present, 2 = harness error.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  CHROME, startServer, launchChrome, Cdp, newPage, setScheme, evalIn, screenshot,
} from './lib/cdp.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const WANT_SHOTS = process.argv.includes('--shots');
const WIDTHS = [390, 768, 1440];

const FIXTURE_TEXT = 'CS 454 01\\nIntroduction to the Theory of Computation\\nISBN: 9781133187790\\nFormat: Paperback Rental';
const FIXTURE_UNITS = 10;
const FIXTURE_PRICES = { opt_out: 11.08, stay_in: 250, close: 200, incomplete: null };

// ── In-page drivers ─────────────────────────────────────────────────────────

const sleep = (ms) => `await new Promise(r => setTimeout(r, ${ms}));`;

function driveTo(screen, price) {
  if (screen === 'input') return `(async () => { ${sleep(250)} return true; })()`;
  const toConfirm = `
    document.getElementById('units-input').value = '${FIXTURE_UNITS}';
    document.getElementById('units-input').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('text-input').value = "${FIXTURE_TEXT}";
    document.getElementById('go-btn').click();
    ${sleep(300)}`;
  if (screen === 'confirm') return `(async () => { ${toConfirm} return true; })()`;
  return `(async () => {
    ${toConfirm}
    document.getElementById('confirm-btn').click();
    ${sleep(300)}
    ${price == null ? '' : `{
      const p = document.querySelector('[data-price-idx="0"]');
      p.value = '${price}';
      p.dispatchEvent(new Event('input', { bubbles: true }));
    }`}
    ${sleep(250)}
    return true;
  })()`;
}

// The measuring code that runs inside the page. Returns raw observations;
// pass/fail judgment happens in Node so thresholds live in one place.
const AUDIT_FN = `
(() => {
  const vis = (el) => {
    if (!el.getClientRects().length) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  };
  const hasText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const rgb = (str) => {
    const m = str.match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/);
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : null;
  };
  const effectiveBg = (el) => {
    let node = el;
    let acc = null;
    while (node && node !== document.documentElement.parentNode) {
      const c = rgb(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0) {
        if (!acc) acc = { ...c };
        else acc = { r: acc.r + (c.r - acc.r) * (1 - acc.a), g: acc.g + (c.g - acc.g) * (1 - acc.a), b: acc.b + (c.b - acc.b) * (1 - acc.a), a: 1 };
        if (acc.a >= 1) return acc;
        acc.a = Math.min(1, acc.a + c.a * (1 - acc.a));
      }
      node = node.parentElement;
    }
    return acc ?? { r: 255, g: 255, b: 255, a: 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const contrast = (a, b) => {
    const l1 = lum(a); const l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const hsl = ({ r, g, b }) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b); const mn = Math.min(r, g, b); const d = mx - mn;
    let h = 0;
    if (d) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    const l = (mx + mn) / 2;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    return { h, s: s * 100, l: l * 100 };
  };

  const all = [...document.querySelectorAll('body *')].filter(vis);
  const out = {};

  // Type sizes: the biggest text on the page and the designated verdict figure.
  const textEls = all.filter(hasText);
  const sized = textEls.map((el) => ({
    px: parseFloat(getComputedStyle(el).fontSize),
    tag: el.tagName, cls: String(el.className).slice(0, 40),
    audit: el.closest('[data-audit="verdict-figure"]') ? 'figure' : null,
  }));
  const figureEls = sized.filter((s) => s.audit === 'figure');
  const others = sized.filter((s) => s.audit !== 'figure');
  out.verdictFigurePx = figureEls.length ? Math.max(...figureEls.map((s) => s.px)) : null;
  const sortedOthers = others.sort((a, b) => b.px - a.px);
  out.nextLargestPx = sortedOthers[0]?.px ?? null;
  out.nextLargestWhat = sortedOthers[0] ? sortedOthers[0].tag + '.' + sortedOthers[0].cls : null;

  // Interface font.
  out.bodyFont = getComputedStyle(document.body).fontFamily;

  // Money elements: tabular/mono + right-edge alignment.
  const moneyEls = [...document.querySelectorAll('[data-audit="money"]')].filter(vis);
  out.money = moneyEls.map((el) => {
    const s = getComputedStyle(el);
    return {
      text: el.textContent.trim().slice(0, 20),
      right: el.getBoundingClientRect().right,
      tabular: s.fontVariantNumeric.includes('tabular-nums'),
      mono: /mono|menlo|consolas|courier/i.test(s.fontFamily),
      group: el.closest('[data-audit-money-group]')?.getAttribute('data-audit-money-group') ?? null,
    };
  });

  // Body measure in characters, for real paragraphs.
  const probe = document.createElement('span');
  probe.textContent = '0';
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
  out.measures = [...document.querySelectorAll('p, li')].filter(vis)
    .filter((el) => el.textContent.trim().length > 90)
    .slice(0, 20)
    .map((el) => {
      const s = getComputedStyle(el);
      probe.style.font = s.font;
      el.appendChild(probe);
      const ch = probe.getBoundingClientRect().width || 8;
      probe.remove();
      return { chars: Math.round(el.getBoundingClientRect().width / ch), what: el.tagName + '.' + String(el.className).slice(0, 30) };
    });

  // Liquid-glass direction: primary surfaces must carry a backdrop blur.
  out.glassMissing = [...document.querySelectorAll('.card:not(.card-capture), .drop-zone, .v-item, .notice')]
    .filter(vis)
    .filter((el) => {
      const s = getComputedStyle(el);
      const bf = s.backdropFilter || s.webkitBackdropFilter || 'none';
      return bf === 'none';
    })
    .map((el) => el.tagName + '.' + String(el.className).slice(0, 40));

  // Verdict panel treatment (for cross-state identity).
  const panel = document.querySelector('.verdict-panel, [data-audit="verdict-panel"]');
  out.verdictTreatment = panel ? (() => {
    const s = getComputedStyle(panel);
    return { bg: s.backgroundColor, border: s.borderColor, color: s.color, cls: panel.className };
  })() : null;

  // Color discipline: the blue accent belongs to interactive elements only;
  // the warning orange belongs to access-code flags and uncertainty hints only.
  const norm = (c) => { const v = rgb(c); return v ? [v.r, v.g, v.b].join(',') : null; };
  const keyOf = (raw) => {
    const probe2 = document.createElement('div');
    probe2.style.color = raw;
    document.body.appendChild(probe2);
    const k = norm(getComputedStyle(probe2).color);
    probe2.remove();
    return k;
  };
  const accentRaw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const warnRaw = getComputedStyle(document.documentElement).getPropertyValue('--warn').trim();
  const accentKey = keyOf(accentRaw);
  const warnKey = keyOf(warnRaw);
  out.accent = accentRaw;
  out.accentUses = [];
  for (const el of all) {
    const s = getComputedStyle(el);
    const colors = [s.color, s.backgroundColor, s.borderTopColor];
    if (colors.some((c) => norm(c) === accentKey)) {
      out.accentUses.push({
        what: 'accent:' + el.tagName + '.' + String(el.className).slice(0, 40),
        allowed: Boolean(el.closest('a, button, .linkish, input, select, [role="button"]')),
      });
    }
    if (colors.some((c) => norm(c) === warnKey)) {
      out.accentUses.push({
        what: 'warn:' + el.tagName + '.' + String(el.className).slice(0, 40),
        allowed: Boolean(el.closest('[data-audit="access-flag"], .badge, .r-flag, .check-hint, .field.low-confidence')),
      });
    }
  }

  // Branding-resembling colors (navy / gold bands) in computed styles.
  out.brandingColors = [];
  const seen = new Set();
  for (const el of all) {
    const s = getComputedStyle(el);
    for (const c of [s.color, s.backgroundColor, s.borderTopColor]) {
      const v = rgb(c);
      if (!v || v.a === 0) continue;
      const key = norm(c);
      if (seen.has(key)) continue;
      seen.add(key);
      const { h, s: sat, l } = hsl(v);
      const navy = h >= 210 && h <= 240 && sat > 35 && l < 35 && l > 8;
      const gold = h >= 44 && h <= 56 && sat > 50 && l > 40 && l < 68;
      if (navy || gold) out.brandingColors.push({ color: c, band: navy ? 'navy' : 'gold', example: el.tagName + '.' + String(el.className).slice(0, 30) });
    }
  }

  // Contrast for text-bearing elements.
  out.contrast = [];
  for (const el of textEls.slice(0, 400)) {
    const s = getComputedStyle(el);
    // Gradient-clipped display text computes as transparent; its endpoint
    // colors are verified manually against both schemes (disclosed
    // calibration in design.md).
    if ((s.webkitBackgroundClip === 'text' || s.backgroundClip === 'text') && /gradient/.test(s.backgroundImage)) continue;
    const fg = rgb(s.color);
    if (!fg) continue;
    const bg = effectiveBg(el);
    const ratio = contrast(fg, bg);
    const px = parseFloat(s.fontSize);
    const bold = parseInt(s.fontWeight, 10) >= 700;
    const large = px >= 24 || (px >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    if (ratio < need) {
      out.contrast.push({
        what: el.tagName + '.' + String(el.className).slice(0, 40),
        text: el.textContent.trim().slice(0, 30),
        ratio: Math.round(ratio * 100) / 100, need, px,
      });
    }
  }

  // Interactive target sizes.
  // WCAG 2.5.8 exempts links that sit inline in a sentence; block-styled
  // anchors (buttons, CTAs, retailer links) are still held to 44px.
  const targets = [...document.querySelectorAll('a[href], button, input, select, summary, [role="button"]')]
    .filter(vis)
    .filter((el) => !(el.type === 'checkbox' && el.closest('label')))
    .filter((el) => !(el.tagName === 'A' && getComputedStyle(el).display === 'inline'));
  out.smallTargets = targets.map((el) => {
    const r = el.getBoundingClientRect();
    return { what: el.tagName + '.' + String(el.className).slice(0, 30) + (el.id ? '#' + el.id : ''), w: Math.round(r.width), h: Math.round(r.height) };
  }).filter((t) => t.w < 44 || t.h < 44);

  // Tab order vs visual order. Inline links inside flowing text are in
  // reading order by construction; the check covers block-level controls.
  const focusables = [...document.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex]')]
    .filter(vis)
    .filter((el) => el.tabIndex >= 0)
    .filter((el) => !(el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.closest('p, li, blockquote, figcaption')));
  let orderOk = true;
  let orderBreak = null;
  for (let i = 1; i < focusables.length; i += 1) {
    const a = focusables[i - 1].getBoundingClientRect();
    const b = focusables[i].getBoundingClientRect();
    const rowA = Math.round(a.top / 24);
    const rowB = Math.round(b.top / 24);
    if (rowB < rowA || (rowB === rowA && b.left < a.left - 4)) {
      orderOk = false;
      orderBreak = focusables[i - 1].id || focusables[i - 1].className + ' -> ' + (focusables[i].id || focusables[i].className);
      break;
    }
  }
  out.tabOrderOk = orderOk;
  out.tabOrderBreak = orderBreak;

  // Inputs without labels.
  out.unlabeled = [...document.querySelectorAll('input, select, textarea')].filter(vis)
    .filter((el) => !(el.labels && el.labels.length) && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby'))
    .map((el) => el.tagName + (el.id ? '#' + el.id : '.' + el.className));

  // Deadline visibility: must appear in the working screen area, not merely
  // in the below-the-fold explainer or footer.
  const deadlineRe = /(opt-?out deadline|add\\/drop|September 4, 2026)/i;
  out.deadlineVisible = all.some((el) => hasText(el) && deadlineRe.test(el.textContent)
    && !el.closest('#receipts, footer, .site-footer'));

  // Confirm-screen editability.
  const cards = [...document.querySelectorAll('#items-list .item-card')];
  out.confirmItems = cards.length;
  out.confirmEditable = cards.every((card) => {
    const inputs = card.querySelectorAll('input[type="text"], select');
    return inputs.length >= 4 && [...inputs].every((i) => !i.disabled && !i.readOnly);
  });

  return out;
})()
`;

// ── Judgment ────────────────────────────────────────────────────────────────

function judge(obs) {
  const checks = [];
  const add = (id, pass, measured) => checks.push({ id, pass, measured });
  const v = obs.verdict_states;
  const vd = v.opt_out; // representative verdict screen at 768

  add('L1 verdict figure ≥2× next-largest text',
    vd.verdictFigurePx != null && vd.verdictFigurePx >= 2 * vd.nextLargestPx,
    `figure=${vd.verdictFigurePx}px next=${vd.nextLargestPx}px (${vd.nextLargestWhat})`);

  const primaryFont = vd.bodyFont.split(',')[0].replace(/["']/g, '').trim();
  add('L2 interface font not Inter/Roboto',
    !/^(inter|roboto)$/i.test(primaryFont),
    `primary family: ${primaryFont}`);

  const moneyBad = vd.money.filter((m) => !(m.tabular || m.mono));
  add('L3a currency uses tabular/mono figures',
    vd.money.length > 0 && moneyBad.length === 0,
    vd.money.length ? `${vd.money.length} money els, ${moneyBad.length} not tabular/mono` : 'no [data-audit="money"] elements tagged');

  const groups = {};
  vd.money.forEach((m) => { if (m.group) (groups[m.group] ??= []).push(m.right); });
  const misaligned = Object.entries(groups).filter(([, rights]) => Math.max(...rights) - Math.min(...rights) > 1);
  add('L3b money right edges align within 1px',
    Object.keys(groups).length > 0 && misaligned.length === 0,
    Object.keys(groups).length ? misaligned.map(([g, r]) => `${g}: Δ${(Math.max(...r) - Math.min(...r)).toFixed(1)}px`).join('; ') || 'aligned' : 'no money groups tagged');

  const badMeasure = obs.screens.input.measures.filter((m) => m.chars < 45 || m.chars > 80);
  add('L4 body measure 45–80ch',
    obs.screens.input.measures.length > 0 && badMeasure.length === 0,
    badMeasure.length ? badMeasure.map((m) => `${m.what}=${m.chars}ch`).slice(0, 3).join('; ') : `${obs.screens.input.measures.length} paragraphs in range`);

  const glassBad = [...new Set([...obs.screens.input.glassMissing, ...vd.glassMissing])];
  add('C1 glass material on primary surfaces', glassBad.length === 0,
    glassBad.slice(0, 3).join('; ') || 'all surfaces frosted');

  const treatments = Object.entries(v).map(([k, o]) => [k, JSON.stringify(o.verdictTreatment && { bg: o.verdictTreatment.bg, border: o.verdictTreatment.border, color: o.verdictTreatment.color })]);
  const distinct = new Set(treatments.map(([, t]) => t));
  add('C2 verdict states identical color treatment', distinct.size === 1,
    distinct.size === 1 ? 'all four identical' : treatments.map(([k, t]) => `${k}=${t}`).join(' | ').slice(0, 220));

  const accentViolations = [...obs.screens.input.accentUses, ...vd.accentUses].filter((u) => !u.allowed);
  add('C3 color discipline (blue=interactive, orange=flags)', accentViolations.length === 0,
    accentViolations.length ? `${accentViolations.length} violations e.g. ${accentViolations.slice(0, 3).map((u) => u.what).join('; ')}` : `accent=${vd.accent || 'unset'}`);

  const branding = [...vd.brandingColors, ...obs.screens.input.brandingColors];
  add('C4 no SSU-navy/gold-band colors', branding.length === 0,
    branding.slice(0, 3).map((b) => `${b.band}:${b.color}`).join('; ') || 'none detected');

  const contrastFails = [...new Map([...obs.screens.input.contrast, ...obs.screens.confirm.contrast, ...vd.contrast].map((c) => [c.what + c.text, c])).values()];
  add('A1 contrast ≥4.5:1 (3:1 large)', contrastFails.length === 0,
    contrastFails.slice(0, 4).map((c) => `${c.what} "${c.text}" ${c.ratio}<${c.need}`).join('; ') || 'all pass');

  const small = [...new Map([...obs.screens.input.smallTargets, ...obs.screens.confirm.smallTargets, ...vd.smallTargets].map((t) => [t.what, t])).values()];
  add('A2 targets ≥44×44px', small.length === 0,
    small.slice(0, 5).map((t) => `${t.what} ${t.w}×${t.h}`).join('; ') || 'all pass');

  const tabScreens = [['input', obs.screens.input], ['confirm', obs.screens.confirm], ['verdict', vd]];
  const tabBad = tabScreens.filter(([, o]) => !o.tabOrderOk);
  add('A3 tab order matches visual order', tabBad.length === 0,
    tabBad.map(([k, o]) => `${k}: ${o.tabOrderBreak}`).join('; ') || 'all three screens ok');

  const unlabeled = [...new Set([...obs.screens.input.unlabeled, ...obs.screens.confirm.unlabeled, ...vd.unlabeled])];
  add('A4 every input labeled', unlabeled.length === 0, unlabeled.slice(0, 5).join('; ') || 'all labeled');

  const deadlineBad = tabScreens.filter(([, o]) => !o.deadlineVisible);
  add('S1 deadline visible on all three screens', deadlineBad.length === 0,
    deadlineBad.length ? `missing on: ${deadlineBad.map(([k]) => k).join(', ')}` : 'present on all three');

  add('S2 no course-requirement phrasing in source', obs.sourceGrep.length === 0,
    obs.sourceGrep.slice(0, 3).join('; ') || 'clean');

  add('S3 confirm screen fields all editable',
    obs.screens.confirm.confirmItems > 0 && obs.screens.confirm.confirmEditable,
    `${obs.screens.confirm.confirmItems} item(s), editable=${obs.screens.confirm.confirmEditable}`);

  return checks;
}

async function grepSource() {
  const files = ['index.html', 'why.html', 'assets/app.js', 'assets/parse-text.js', 'api/parse.js'];
  const patterns = [/requires\b/i, /required for/i, /your course needs/i];
  const hits = [];
  for (const f of files) {
    const text = await readFile(path.join(ROOT, f), 'utf8');
    text.split('\n').forEach((line, i) => {
      // Only user-facing material: skip comment lines and the server-side model prompt.
      if (/^\s*(\/\/|\*|<!--)/.test(line)) return;
      if (f === 'api/parse.js' && /EXTRACTION_PROMPT|included\/required/.test(line)) return;
      for (const p of patterns) {
        if (p.test(line)) hits.push(`${f}:${i + 1} ${line.trim().slice(0, 60)}`);
      }
    });
  }
  return hits;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!CHROME) throw new Error('No Chrome/Chromium found');
  const server = await startServer(ROOT);
  const base = `http://127.0.0.1:${server.address().port}`;
  const { proc, wsUrl } = await launchChrome();
  const cdp = await Cdp.connect(wsUrl);

  const obs = { screens: {}, verdict_states: {}, sourceGrep: await grepSource() };
  try {
    for (const screen of ['input', 'confirm']) {
      const { sessionId } = await newPage(cdp, base, 768);
      await setScheme(cdp, sessionId, 'light');
      await evalIn(cdp, sessionId, driveTo(screen));
      obs.screens[screen] = await evalIn(cdp, sessionId, AUDIT_FN);
      await setScheme(cdp, sessionId, 'dark');
      const dark = await evalIn(cdp, sessionId, AUDIT_FN);
      obs.screens[screen].contrast.push(...dark.contrast.map((c) => ({ ...c, what: `[dark] ${c.what}` })));
      obs.screens[screen].glassMissing.push(...dark.glassMissing);
      obs.screens[screen].brandingColors.push(...dark.brandingColors);
      if (WANT_SHOTS) {
        for (const w of WIDTHS) {
          const { sessionId: s2 } = await newPage(cdp, base, w);
          await setScheme(cdp, s2, 'light');
          await evalIn(cdp, s2, driveTo(screen));
          await screenshot(cdp, s2, path.join(ROOT, 'checks/shots', `${screen}-${w}.png`));
        }
      }
    }
    for (const [state, price] of Object.entries(FIXTURE_PRICES)) {
      const { sessionId } = await newPage(cdp, base, 768);
      await setScheme(cdp, sessionId, 'light');
      await evalIn(cdp, sessionId, driveTo('verdict', price));
      obs.verdict_states[state] = await evalIn(cdp, sessionId, AUDIT_FN);
      if (state === 'opt_out') {
        await setScheme(cdp, sessionId, 'dark');
        const dark = await evalIn(cdp, sessionId, AUDIT_FN);
        obs.verdict_states[state].contrast.push(...dark.contrast.map((c) => ({ ...c, what: `[dark] ${c.what}` })));
        obs.verdict_states[state].glassMissing.push(...dark.glassMissing);
        obs.verdict_states[state].brandingColors.push(...dark.brandingColors);
        await setScheme(cdp, sessionId, 'light');
      }
      if (WANT_SHOTS) {
        for (const w of WIDTHS) {
          const { sessionId: s2 } = await newPage(cdp, base, w);
          await setScheme(cdp, s2, 'light');
          await evalIn(cdp, s2, driveTo('verdict', price));
          await screenshot(cdp, s2, path.join(ROOT, 'checks/shots', `verdict-${state}-${w}.png`));
        }
      }
    }
  } finally {
    proc.kill();
    server.close();
  }

  const checks = judge(obs);
  const passCount = checks.filter((c) => c.pass).length;
  console.log(`\nDesign audit — ${passCount}/${checks.length} passing\n`);
  for (const c of checks) {
    console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.id}`);
    console.log(`      ${c.measured}`);
  }
  await mkdir(path.join(ROOT, 'checks/results'), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await writeFile(path.join(ROOT, 'checks/results', `audit-${stamp}.json`),
    JSON.stringify({ checks, obs }, null, 2));
  process.exit(passCount === checks.length ? 0 : 1);
}

main().catch((err) => {
  console.error('audit harness error:', err.message);
  process.exit(2);
});
