// Flow state machine: input → confirm → verdict.
// Confirmation is mandatory — nothing is computed until the user says the
// parsed list matches their cart. All copy speaks about "your cart" and
// "prices you entered"; the tool never claims to know what a course requires.

import { config } from './config.js';
import { parseText } from './parse-text.js';
import { computeVerdict } from './verdict.js';

const state = {
  step: 'input',
  items: [],
  units: null,
  warnings: [],
};

let nextManualId = 1;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const fmt = (n) => `$${n.toFixed(2)}`;

const FORMAT_LABELS = {
  physical: 'Physical book',
  digital: 'Digital / eText',
  access_code: 'Access code / courseware',
  unknown: 'Not sure',
};

function accessRe() {
  const escaped = (config.accessCodePatterns ?? [])
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(${escaped.join('|')})\\b`, 'i');
}

function recomputeAccessFlag(item) {
  item.isAccessCode = item.format === 'access_code' || accessRe().test(item.title ?? '');
}

function emptyItem() {
  return {
    id: `manual-${nextManualId++}`,
    courseCode: null,
    title: '',
    format: 'unknown',
    isbn: null,
    isAccessCode: false,
    userPrice: null,
    skipped: false,
    confidence: { courseCode: 'high', title: 'high', format: 'high', isbn: 'high' },
  };
}

// Normalize items from any parse source (server vision, client text parser)
// into the one shape the rest of the app trusts.
function adoptItems(rawItems) {
  return (rawItems ?? []).map((r, i) => {
    const item = {
      id: r.id ?? `parsed-${i}`,
      courseCode: r.courseCode ?? null,
      title: r.title ?? '',
      format: ['physical', 'digital', 'access_code', 'unknown'].includes(r.format) ? r.format : 'unknown',
      isbn: r.isbn ?? null,
      isAccessCode: false,
      userPrice: null,
      skipped: false,
      confidence: {
        courseCode: r.confidence?.courseCode === 'high' ? 'high' : 'low',
        title: r.confidence?.title === 'high' ? 'high' : 'low',
        format: r.confidence?.format === 'high' ? 'high' : 'low',
        isbn: r.confidence?.isbn === 'high' ? 'high' : 'low',
      },
    };
    recomputeAccessFlag(item);
    return item;
  });
}

function showStep(step) {
  state.step = step;
  $('step-input').hidden = step !== 'input';
  $('step-confirm').hidden = step !== 'confirm';
  $('step-verdict').hidden = step !== 'verdict';
  if (step !== 'input') $('step-confirm').scrollIntoView?.({ behavior: 'smooth' });
}

function showInputError(msg) {
  const el = $('input-errors');
  el.textContent = msg;
  el.hidden = false;
}

function readUnits() {
  const v = Number($('units-input').value);
  if (Number.isFinite(v) && v >= 1 && v <= config.maxUnits) return v;
  return null;
}

// ── Input step ──────────────────────────────────────────────────────────────

function setParseBusy(busy, msg = '') {
  const el = $('parse-status');
  el.hidden = !busy && !msg;
  el.textContent = busy ? 'Reading your screenshot…' : msg;
}

// Downscale/re-encode large images before upload: the parse endpoint accepts
// ~3MB, and detail beyond ~2000px on the long edge doesn't improve parsing.
async function prepareImage(file) {
  const readAsDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(blob);
  });

  const MAX_EDGE = 2000;
  const MAX_BYTES = 2_500_000;
  try {
    const bitmap = await createImageBitmap(file);
    const longEdge = Math.max(bitmap.width, bitmap.height);
    if (file.size <= MAX_BYTES && longEdge <= MAX_EDGE) {
      bitmap.close?.();
      return await readAsDataUrl(file);
    }
    const scale = Math.min(1, MAX_EDGE / longEdge);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    return readAsDataUrl(file);
  }
}

async function handleImageFile(file) {
  $('input-errors').hidden = true;
  if (!config.parseEndpoint) {
    showInputError('Screenshot parsing isn’t enabled on this deployment. '
      + 'Paste the page text instead, or enter your items by hand — both work fully in your browser.');
    return;
  }
  if (!file.type.startsWith('image/')) {
    showInputError('That file isn’t an image. Drop a screenshot (PNG or JPG), or paste text instead.');
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    showInputError('That image is over 8 MB. Try a normal screenshot rather than a photo, or paste the text instead.');
    return;
  }

  setParseBusy(true);
  try {
    const dataUrl = await prepareImage(file);
    const [, mediaType, base64] = dataUrl.match(/^data:([^;]+);base64,(.+)$/) ?? [];
    if (!base64) throw new Error('encode failed');

    const res = await fetch(config.parseEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64, mediaType }),
    });
    const body = await res.json().catch(() => null);

    if (!res.ok || !body) {
      showInputError(body?.error
        ?? 'The screenshot reader is unavailable right now. Paste the page text instead — that works entirely in your browser.');
      return;
    }
    if (body.wrongPage) {
      showInputError('That screenshot doesn’t look like a course materials page. '
        + 'Open your bookstore’s My Course Materials page (the list of what’s included for your classes) and screenshot that.');
      return;
    }
    const items = adoptItems(body.items);
    if (items.length === 0) {
      showInputError('Couldn’t find any course materials in that screenshot. '
        + 'Try a tighter screenshot of the materials list, paste the text, or enter items by hand.');
      return;
    }
    state.items = items;
    state.warnings = body.warnings ?? [];
    state.units = readUnits() ?? state.units;
    renderConfirm();
    showStep('confirm');
  } catch {
    showInputError('Couldn’t read that screenshot. Paste the page text instead — that works entirely in your browser.');
  } finally {
    setParseBusy(false);
  }
}

function handlePastedText() {
  $('input-errors').hidden = true;
  const raw = $('text-input').value;
  const { items, warnings } = parseText(raw, config);
  if (items.length === 0) {
    showInputError(warnings[0] ?? 'Couldn’t read anything from that text. You can enter your items by hand instead.');
    return;
  }
  state.items = adoptItems(items);
  state.warnings = warnings;
  state.units = readUnits() ?? state.units;
  renderConfirm();
  showStep('confirm');
}

function wireInputStep() {
  const dropZone = $('drop-zone');
  const fileInput = $('file-input');

  $('file-btn').addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleImageFile(fileInput.files[0]);
    fileInput.value = '';
  });

  ['dragover', 'dragenter'].forEach((t) => dropZone.addEventListener(t, (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach((t) => dropZone.addEventListener(t, (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
  }));
  dropZone.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) handleImageFile(file);
  });

  document.addEventListener('paste', (e) => {
    if (state.step !== 'input') return;
    if (e.target === $('text-input')) return;
    const file = [...(e.clipboardData?.items ?? [])]
      .find((it) => it.type.startsWith('image/'))?.getAsFile();
    if (file) handleImageFile(file);
  });

  $('parse-text-btn').addEventListener('click', handlePastedText);

  $('manual-entry-link').addEventListener('click', (e) => {
    e.preventDefault();
    state.items = [emptyItem()];
    state.warnings = [];
    state.units = readUnits() ?? state.units;
    renderConfirm();
    showStep('confirm');
  });
}

// ── Confirm step ────────────────────────────────────────────────────────────

function fieldHtml(item, idx, field, label, value, extra = '') {
  const low = item.confidence[field] === 'low';
  return `
    <div class="field ${low ? 'low-confidence' : ''}">
      <label>${label}${low ? ' <span class="check-hint">— check this, the tool wasn’t sure</span>' : ''}</label>
      <input type="text" data-idx="${idx}" data-field="${field}" value="${esc(value ?? '')}" ${extra}>
    </div>`;
}

function renderConfirm() {
  const list = $('items-list');

  const warningsHtml = state.warnings
    .map((w) => `<div class="notice notice-warn">${esc(w)}</div>`).join('');
  $('confirm-warnings').innerHTML = warningsHtml;

  if (state.items.length === 0) {
    list.innerHTML = `<div class="notice">Your cart shows <strong>no included materials</strong>.
      That’s a real result — confirm below to see what the bundle costs anyway.</div>`;
  } else {
    list.innerHTML = state.items.map((item, idx) => {
      const lowFormat = item.confidence.format === 'low';
      return `
      <div class="item-card" data-item-id="${esc(item.id)}">
        ${item.isAccessCode ? '<span class="badge">Single-use access code — usually can’t be bought used</span>' : ''}
        ${fieldHtml(item, idx, 'title', 'Title', item.title)}
        ${fieldHtml(item, idx, 'courseCode', 'Course (optional)', item.courseCode, 'placeholder="e.g. CS 454"')}
        <div class="field ${lowFormat ? 'low-confidence' : ''}">
          <label>Format${lowFormat ? ' <span class="check-hint">— check this, the tool wasn’t sure</span>' : ''}</label>
          <select data-idx="${idx}" data-field="format">
            ${Object.entries(FORMAT_LABELS).map(([v, l]) => `<option value="${v}" ${item.format === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        ${fieldHtml(item, idx, 'isbn', 'ISBN (optional — makes price links exact)', item.isbn)}
        <button type="button" class="btn-danger-text" data-remove="${idx}">Remove this item</button>
      </div>`;
    }).join('');
  }

  const units = state.units ?? readUnits();
  $('confirm-units-row').innerHTML = `
    <label for="confirm-units-input"><strong>Units registered:</strong></label>
    <input type="number" id="confirm-units-input" inputmode="numeric" min="1" max="${config.maxUnits}"
      value="${units ?? ''}" placeholder="e.g. 15">
    <span class="muted small">The bundle bills per unit, so this sets its price.</span>`;
}

function wireConfirmStep() {
  $('items-list').addEventListener('input', (e) => {
    const idx = Number(e.target.dataset.idx);
    const { field } = e.target.dataset;
    if (!Number.isInteger(idx) || !field || !state.items[idx]) return;
    const item = state.items[idx];
    item[field] = e.target.value.trim() === '' && field !== 'title' ? null : e.target.value;
    item.confidence[field] = 'high'; // the user looked at it — it's theirs now
    if (field === 'format' || field === 'title') {
      recomputeAccessFlag(item);
      if (field === 'format') renderConfirm(); // badge + select state
    }
  });

  $('items-list').addEventListener('click', (e) => {
    const removeIdx = e.target.dataset?.remove;
    if (removeIdx !== undefined) {
      state.items.splice(Number(removeIdx), 1);
      renderConfirm();
    }
  });

  $('add-item-btn').addEventListener('click', () => {
    state.items.push(emptyItem());
    renderConfirm();
  });

  $('back-btn').addEventListener('click', () => showStep('input'));

  $('confirm-btn').addEventListener('click', () => {
    const errEl = $('confirm-errors');
    errEl.hidden = true;

    const unitsVal = Number($('confirm-units-input')?.value);
    if (!Number.isFinite(unitsVal) || unitsVal < 1 || unitsVal > config.maxUnits) {
      errEl.textContent = `Enter your registered units, between 1 and ${config.maxUnits} — the bundle is billed per unit.`;
      errEl.hidden = false;
      return;
    }
    const incomplete = state.items.filter((it) => !(it.title ?? '').trim() && !(it.isbn ?? '').trim());
    if (incomplete.length > 0) {
      errEl.textContent = 'Every item needs at least a title or an ISBN — or remove the ones you don’t need.';
      errEl.hidden = false;
      return;
    }
    state.units = unitsVal;
    renderVerdict();
    showStep('verdict');
  });
}

// ── Verdict step ────────────────────────────────────────────────────────────

function retailerLinks(item) {
  const q = encodeURIComponent((item.isbn ?? '').trim() || item.title);
  return config.retailers
    .map((r) => `<a href="${esc(r.searchUrl.replace('{q}', q))}" target="_blank" rel="noopener noreferrer">${esc(r.name)}</a>`)
    .join('');
}

function renderVerdict() {
  const units = state.units;
  const bundleCost = Math.round(units * config.pricePerUnit * 100) / 100;
  $('bundle-line').innerHTML = `The Seawolf Bundle for your <strong>${units} units</strong>:
    ${units} × ${fmt(config.pricePerUnit)} = <strong>${fmt(bundleCost)}</strong>
    <span class="muted small">(current rate, confirmed in writing by the bookstore, July 2026 —
    see <a href="${esc(config.claimsUrl)}">sources</a>)</span>`;

  const container = $('verdict-items');
  if (state.items.length === 0) {
    container.innerHTML = '';
  } else {
    container.innerHTML = `<p><strong>Find the real price of each item</strong> — each link searches
      by ISBN when your cart showed one, otherwise by title. Type in the best price you find and the
      totals update. Your numbers, your verdict.</p>`
      + state.items.map((item, idx) => `
      <div class="v-item">
        <div class="v-title">${esc(item.title || item.isbn || 'Untitled item')}</div>
        <div class="v-meta">${esc([item.courseCode, FORMAT_LABELS[item.format], item.isbn ? `ISBN ${item.isbn}` : null].filter(Boolean).join(' · '))}</div>
        ${item.isAccessCode ? `<div class="badge">Single-use access code</div>
          <div class="v-meta">Access codes usually can’t be bought used — check the publisher’s
          own price for new access and enter that.</div>` : ''}
        <div class="retailer-links">${retailerLinks(item)}</div>
        <div class="price-row">
          <label for="price-${idx}">Best price you found</label>
          <input type="number" id="price-${idx}" data-price-idx="${idx}" min="0" max="99999" step="0.01"
            inputmode="decimal" placeholder="0.00" value="${item.userPrice ?? ''}" ${item.skipped ? 'disabled' : ''}>
          <label class="skip-label"><input type="checkbox" data-skip-idx="${idx}" ${item.skipped ? 'checked' : ''}>
            couldn’t find it</label>
        </div>
      </div>`).join('');
  }

  const deadlineEl = $('deadline-note');
  if (config.optOutDeadline) {
    deadlineEl.innerHTML = `<strong>Opt-out deadline for ${esc(config.term)}:
      ${esc(config.optOutDeadline)}.</strong> The opt-out button is in your bookstore portal.`;
  } else {
    deadlineEl.innerHTML = `<strong>Mind the deadline.</strong> Opting out closes at SSU’s
      add/drop deadline for ${esc(config.term)} — check your bookstore portal or the academic
      calendar for the exact date. The opt-out button is in your bookstore portal.`;
  }

  updateVerdictPanel();
}

function updateVerdictPanel() {
  const v = computeVerdict(state.items, state.units, config);
  const panel = $('verdict-panel');
  const basis = v.basedOnAll
    ? 'based on the prices you entered for every item'
    : `based on the prices you entered for ${v.pricedCount} of ${v.totalCount} items`;

  let cls = '';
  let headline = '';
  let detail = '';

  if (state.items.length === 0) {
    cls = 'v-optout';
    headline = `Your cart shows nothing included — the bundle would cost you ${fmt(v.bundleCost)} for it.`;
    detail = `<p class="verdict-detail">Buying nothing costs $0.00. Based on what your cart shows
      today, opting out saves you <strong>${fmt(v.difference)}</strong>. Materials can still be
      added later — see below.</p>`;
  } else if (v.recommendation === 'incomplete' && v.complete && v.pricedCount === 0) {
    headline = 'Every item is marked “couldn’t find it” — there’s nothing to compare yet.';
    detail = `<p class="verdict-detail">The bundle costs ${fmt(v.bundleCost)} for your units,
      but without at least one price you found, the tool has no basis for a verdict and won’t
      invent one. Try the search links again, or ask a librarian or classmate for help finding
      a price.</p>`;
  } else if (v.recommendation === 'incomplete') {
    headline = 'Enter the prices you find and the verdict appears here.';
    detail = `<p class="verdict-detail">So far: bundle ${fmt(v.bundleCost)} vs
      <strong>${fmt(v.knownBuyTotal)}</strong> ${basis}. The tool won’t call it until every
      item has a price (or is marked “couldn’t find it”).</p>`;
  } else if (v.recommendation === 'opt_out') {
    cls = 'v-optout';
    headline = `Buying on your own looks cheaper — by ${fmt(v.difference)}.`;
    detail = `<p class="verdict-detail">${fmt(v.knownBuyTotal)} to buy the items your cart shows,
      vs ${fmt(v.bundleCost)} for the bundle, ${basis}.</p>
      ${v.skippedCount > 0 ? `<p class="verdict-detail"><strong>Caveat:</strong> ${v.skippedCount}
      item(s) you couldn’t price aren’t counted — if they turn out to be expensive,
      this could flip. Price them before deciding if you can.</p>` : ''}`;
  } else if (v.recommendation === 'stay_in') {
    cls = 'v-stayin';
    headline = `The bundle looks like the better deal — by ${fmt(Math.abs(v.difference))}.`;
    detail = `<p class="verdict-detail">${fmt(v.knownBuyTotal)} to buy the items your cart shows,
      vs ${fmt(v.bundleCost)} for the bundle, ${basis}. Staying in means doing nothing —
      you’re enrolled by default.</p>`;
  } else {
    cls = 'v-close';
    headline = `It’s close — within ${fmt(config.closeThreshold)} either way.`;
    detail = `<p class="verdict-detail">${fmt(v.knownBuyTotal)} to buy vs ${fmt(v.bundleCost)}
      for the bundle, ${basis}. At this margin, think about the non-price factors: bundle items are
      mostly rentals you return; books you buy are yours to keep or resell; and materials can be
      added to a course after you decide.</p>`;
  }

  const accessNote = v.accessCodeCount > 0 && state.items.length > 0
    ? `<p class="verdict-detail">${v.accessCodeCount} of your items ${v.accessCodeCount === 1 ? 'is' : 'are'}
      a single-use access code, which usually can’t be bought used. If new codes are expensive,
      the bundle can genuinely be the better deal — this tool will say so when your numbers show it.</p>`
    : '';

  panel.className = `verdict-panel ${cls}`;
  panel.innerHTML = `<p class="verdict-headline">${headline}</p>${detail}${accessNote}
    <p class="muted small">Prices you type are your findings from the linked stores — the tool
    doesn’t verify them, and the verdict is only as good as your numbers.
    <a href="${esc(config.methodologyUrl)}">How this is computed</a>.</p>`;
}

function wireVerdictStep() {
  $('verdict-items').addEventListener('input', (e) => {
    const priceIdx = e.target.dataset?.priceIdx;
    const skipIdx = e.target.dataset?.skipIdx;
    if (priceIdx !== undefined) {
      const val = e.target.value === '' ? null : Number(e.target.value);
      const valid = Number.isFinite(val) && val >= 0 && val <= 99999;
      if (val !== null && !valid) e.target.value = ''; // don't display a number the math ignores
      state.items[Number(priceIdx)].userPrice = valid ? val : null;
    } else if (skipIdx !== undefined) {
      const item = state.items[Number(skipIdx)];
      item.skipped = e.target.checked;
      const priceInput = e.target.closest('.v-item')?.querySelector('input[type="number"]');
      if (priceInput) priceInput.disabled = e.target.checked; // skipped ⇒ its price is excluded
    } else {
      return;
    }
    updateVerdictPanel();
  });

  $('edit-items-btn').addEventListener('click', () => {
    renderConfirm();
    showStep('confirm');
  });
  $('restart-btn').addEventListener('click', () => {
    state.items = [];
    state.units = null;
    state.warnings = [];
    $('text-input').value = '';
    $('input-errors').hidden = true;
    showStep('input');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// ── Boot ────────────────────────────────────────────────────────────────────

wireInputStep();
wireConfirmStep();
wireVerdictStep();
$('repo-link')?.setAttribute('href', config.repoUrl);
// Static copy that must track the semester config — see README, "How to
// update this each semester". config.js is the single source for the rate.
document.querySelectorAll('[data-config="pricePerUnit"]').forEach((el) => {
  el.textContent = fmt(config.pricePerUnit);
});
// Doc links point at GitHub's rendered views (raw .md serves as plain text
// on most static hosts).
document.querySelectorAll('[data-link="methodology"]').forEach((el) => el.setAttribute('href', config.methodologyUrl));
document.querySelectorAll('[data-link="claims"]').forEach((el) => el.setAttribute('href', config.claimsUrl));
