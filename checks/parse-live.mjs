#!/usr/bin/env node
// Live vision-path test — the ONE check that calls the real Anthropic API.
//
//   ANTHROPIC_API_KEY=sk-ant-... node checks/parse-live.mjs
//
// Renders synthetic course-materials pages (our own fixture content styled
// like a generic bookstore portal — nothing is scraped), captures them the
// three ways students will, and pushes each through the REAL pipeline:
// the site's upload UI → client downscale/slice → api/parse.js → the model →
// the confirm screen. Verifies the parsed items against the fixture's ground
// truth and that no price leaks into any parsed field.
//
//   1. single screenshot (short list)
//   2. tall scrolling screenshot (client slices it into overlapping parts)
//   3. multi-page PDF (what iOS "Full Page" and print-to-PDF produce)
//
// Cost: 3 vision calls, roughly 2–5 cents total on the default Haiku model.
// Exit code 0 = all paths verified, 1 = failures, 2 = not runnable.

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { CHROME, launchChrome, Cdp, newPage, evalIn, screenshot } from './lib/cdp.mjs';
import { startDevServer } from './dev-server.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = path.join(ROOT, 'checks/results');

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is not set. This test drives the live parser and needs a real key:');
  console.error('  ANTHROPIC_API_KEY=sk-ant-... node checks/parse-live.mjs');
  console.error('Everything that does not need a key is covered by: node checks/e2e.mjs');
  process.exit(2);
}
if (!CHROME) {
  console.error('No Chrome/Chromium found.');
  process.exit(2);
}

// ── Fixture pages (synthetic ground truth) ──────────────────────────────────

const ITEMS_SHORT = [
  { course: 'BIOL 115 01', title: 'Campbell Biology (12th Edition)', isbn: '9780134093413', format: 'Hardcover Rental', price: '$187.50', access: false, word: 'campbell' },
  { course: 'BIOL 115 01', title: 'Mastering Biology with Pearson eText Access Card', isbn: '9780134446417', format: 'Digital Access', price: '$99.99', access: true, word: 'mastering' },
  { course: 'HIST 201 02', title: 'A People’s History of the United States', isbn: '9780062397348', format: 'Paperback', price: '$18.99', access: false, word: 'people' },
];

const ITEMS_TALL = [
  ...ITEMS_SHORT,
  { course: 'MATH 161 01', title: 'Calculus: Early Transcendentals', isbn: '9781285741550', format: 'Hardcover Rental', price: '$249.95', access: false, word: 'calculus' },
  { course: 'CHEM 115A 03', title: 'Chemistry: The Central Science, eText', isbn: '9780134414232', format: 'eBook', price: '$44.99', access: false, word: 'central science' },
  { course: 'CHEM 115A 03', title: 'ALEKS 360 Access Card for General Chemistry', isbn: '9781259665028', format: 'Courseware', price: '$130.00', access: true, word: 'aleks' },
  { course: 'ENGL 214 01', title: 'They Say / I Say: The Moves That Matter', isbn: '9780393538700', format: 'Paperback', price: '$32.50', access: false, word: 'they say' },
  { course: 'PSYC 250 02', title: 'Connect Access Card for Exploring Psychology', isbn: '9781260830767', format: 'Digital Access', price: '$110.25', access: true, word: 'exploring psychology' },
];

function fixtureHtml(items, spread) {
  const groups = new Map();
  for (const it of items) {
    if (!groups.has(it.course)) groups.set(it.course, []);
    groups.get(it.course).push(it);
  }
  const cards = [...groups].map(([course, list]) => `
    <section class="course">
      <h2>${course} — Fall 2026</h2>
      ${list.map((it) => `
        <div class="mat">
          <h3>${it.title}</h3>
          <p class="meta">ISBN: ${it.isbn}</p>
          <p class="meta">Format: ${it.format}</p>
          <p class="meta">Included price: ${it.price}</p>
        </div>`).join('')}
    </section>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: Arial, Helvetica, sans-serif; margin: 0; background: #f4f4f4; color: #222; }
    .page { width: 860px; margin: 0 auto; padding: 24px 20px; }
    h1 { font-size: 22px; } h2 { font-size: 16px; margin: 28px 0 8px; color: #333; }
    .course { background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 14px 18px; margin-bottom: ${spread ? 110 : 18}px; }
    .mat { border-top: 1px solid #eee; padding: ${spread ? 70 : 10}px 0; }
    .mat h3 { font-size: 15px; margin: 0 0 6px; }
    .meta { font-size: 13px; margin: 2px 0; color: #555; }
  </style></head><body><div class="page">
    <h1>My Course Materials</h1>
    <p>Materials for your registered Fall 2026 courses.</p>
    ${cards}
  </div></body></html>`;
}

// ── Verification ────────────────────────────────────────────────────────────

const digits = (s) => (s ?? '').replace(/\D/g, '');

function verify(name, expected, parsed) {
  const problems = [];
  if (parsed.titles.length < expected.length) {
    problems.push(`parsed ${parsed.titles.length} items, expected ${expected.length}`);
  }
  for (const it of expected) {
    const byIsbn = parsed.isbns.some((i) => digits(i) === it.isbn);
    const byTitle = parsed.titles.some((t) => t.toLowerCase().includes(it.word));
    if (!byIsbn && !byTitle) problems.push(`missing item: ${it.title}`);
    else if (!byIsbn) problems.push(`ISBN not read for: ${it.title}`);
  }
  const expectedFlags = expected.filter((i) => i.access).length;
  if (parsed.accessFlags < expectedFlags) {
    problems.push(`access-code flags: ${parsed.accessFlags} shown, expected ${expectedFlags}`);
  }
  if (parsed.allValues.some((v) => v.includes('$'))) {
    problems.push('a parsed field contains a price — parsing must ignore prices');
  }
  return problems;
}

// ── Drive one capture through the real site ─────────────────────────────────

const nap = (ms) => new Promise((r) => setTimeout(r, ms));

async function runPath(cdp, base, name, file, expected) {
  const { sessionId, targetId } = await newPage(cdp, `${base}/`, 1280);
  await cdp.send('DOM.enable', {}, sessionId);
  const { root } = await cdp.send('DOM.getDocument', {}, sessionId);
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#file-input' }, sessionId);
  await cdp.send('DOM.setFileInputFiles', { files: [file], nodeId }, sessionId);
  await evalIn(cdp, sessionId,
    `document.getElementById('file-input').dispatchEvent(new Event('change', { bubbles: true })); true`);

  // The model call takes a while; poll until the confirm screen or an error.
  let state = null;
  for (let i = 0; i < 120; i += 1) {
    await nap(1000);
    state = await evalIn(cdp, sessionId, `({
      confirm: !document.getElementById('step-confirm').hidden,
      err: document.getElementById('input-errors').hidden ? null : document.getElementById('input-errors').textContent,
    })`);
    if (state.confirm || state.err) break;
  }

  let problems;
  if (state?.confirm) {
    const parsed = await evalIn(cdp, sessionId, `({
      titles: [...document.querySelectorAll('#items-list input[data-field="title"]')].map((i) => i.value),
      isbns: [...document.querySelectorAll('#items-list input[data-field="isbn"]')].map((i) => i.value),
      formats: [...document.querySelectorAll('#items-list select[data-field="format"]')].map((s) => s.value),
      accessFlags: document.querySelectorAll('#items-list [data-audit="access-flag"]').length,
      allValues: [...document.querySelectorAll('#items-list input')].map((i) => i.value),
      warnings: document.getElementById('confirm-warnings').textContent.trim(),
    })`);
    console.log(`      parsed ${parsed.titles.length} item(s): ${parsed.titles.join(' | ')}`);
    if (parsed.warnings) console.log(`      warnings: ${parsed.warnings}`);
    problems = verify(name, expected, parsed);
  } else {
    problems = [state?.err ? `error surfaced: ${state.err}` : 'timed out waiting for parse'];
  }

  await cdp.send('Target.closeTarget', { targetId });
  if (problems.length === 0) {
    console.log(`PASS  ${name}`);
    return true;
  }
  for (const p of problems) console.log(`FAIL  ${name}\n      ${p}`);
  return false;
}

// ── Main ────────────────────────────────────────────────────────────────────

await mkdir(OUT, { recursive: true });
const server = await startDevServer();
const base = `http://127.0.0.1:${server.address().port}`;
const { proc, wsUrl } = await launchChrome();
const cdp = await Cdp.connect(wsUrl);

let ok = true;
try {
  // Render the fixtures and capture them the three ways students will.
  const shortHtml = path.join(OUT, 'parse-fixture-short.html');
  const tallHtml = path.join(OUT, 'parse-fixture-tall.html');
  await writeFile(shortHtml, fixtureHtml(ITEMS_SHORT, false));
  await writeFile(tallHtml, fixtureHtml(ITEMS_TALL, true));

  const shortPng = path.join(OUT, 'parse-fixture-short.png');
  const tallPng = path.join(OUT, 'parse-fixture-tall.png');
  const tallPdf = path.join(OUT, 'parse-fixture-tall.pdf');

  {
    const { sessionId, targetId } = await newPage(cdp, `file://${shortHtml}`, 900);
    await screenshot(cdp, sessionId, shortPng);
    await cdp.send('Target.closeTarget', { targetId });
  }
  {
    const { sessionId, targetId } = await newPage(cdp, `file://${tallHtml}`, 900);
    await screenshot(cdp, sessionId, tallPng);
    const { data } = await cdp.send('Page.printToPDF', { printBackground: true }, sessionId);
    await writeFile(tallPdf, Buffer.from(data, 'base64'));
    await cdp.send('Target.closeTarget', { targetId });
  }
  const tallHeight = await (async () => {
    const { sessionId, targetId } = await newPage(cdp, `file://${tallHtml}`, 900);
    const h = await evalIn(cdp, sessionId, 'document.documentElement.scrollHeight');
    await cdp.send('Target.closeTarget', { targetId });
    return h;
  })();
  if (tallHeight <= 2520) {
    console.log(`note: tall fixture is ${tallHeight}px — too short to trigger client slicing; treat path 2 as single-image`);
  }

  console.log('Driving three live parses (3 vision calls, ~2–5¢ total on Haiku)…\n');
  ok = (await runPath(cdp, base, 'live: single screenshot → confirm', shortPng, ITEMS_SHORT)) && ok;
  ok = (await runPath(cdp, base, 'live: tall scrolling screenshot (sliced) → confirm', tallPng, ITEMS_TALL)) && ok;
  ok = (await runPath(cdp, base, 'live: multi-page PDF → confirm', tallPdf, ITEMS_TALL)) && ok;
} finally {
  proc.kill();
  server.close();
}

console.log(ok
  ? '\nAll three capture paths verified against the live parser.'
  : '\nFailures above. Fixture captures are in checks/results/ for inspection.');
process.exit(ok ? 0 : 1);
