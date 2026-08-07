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

// The last valid hero units value. Falls back to 15, the default full load.
let heroUnits = 15;

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

const STEP_ORDER = ['input', 'confirm', 'verdict'];

function showStep(step) {
  state.step = step;
  $('step-input').hidden = step !== 'input';
  $('step-confirm').hidden = step !== 'confirm';
  $('step-verdict').hidden = step !== 'verdict';
  document.querySelectorAll('.stepper .snode').forEach((n) => {
    const i = STEP_ORDER.indexOf(n.dataset.step);
    n.classList.toggle('active', n.dataset.step === step);
    n.classList.toggle('done', i > -1 && i < STEP_ORDER.indexOf(step));
  });
  // Off the verdict step, the figure returns to its honest unmeasured state.
  if (step !== 'verdict') renderCompareFigure(null);
  if (step !== 'input') $('tool').scrollIntoView?.({ behavior: 'smooth' });
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
  el.textContent = busy ? 'Reading your capture…' : msg;
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
    const crop = (sy, sh) => {
      const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, sh));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(sh * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, sy, bitmap.width, sh, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.85);
    };

    // A scrolling/full-page capture downscaled whole becomes unreadable —
    // slice very tall images into overlapping segments at full legibility.
    const sliceH = bitmap.width * 2;
    if (bitmap.height > sliceH * 1.4 && bitmap.height > 2200) {
      const n = Math.min(4, Math.ceil(bitmap.height / sliceH));
      const h = Math.ceil(bitmap.height / n);
      const overlap = Math.round(h * 0.06); // items cut at a seam appear in both
      const parts = [];
      for (let i = 0; i < n; i += 1) {
        const sy = Math.max(0, i * h - overlap);
        parts.push(crop(sy, Math.min(h + overlap, bitmap.height - sy)));
      }
      bitmap.close?.();
      return parts;
    }

    if (file.size <= MAX_BYTES && Math.max(bitmap.width, bitmap.height) <= MAX_EDGE) {
      bitmap.close?.();
      return [await readAsDataUrl(file)];
    }
    const part = crop(0, bitmap.height);
    bitmap.close?.();
    return [part];
  } catch {
    return [await readAsDataUrl(file)];
  }
}

const MAX_PARTS = 4;

async function handleCaptureFiles(fileList) {
  $('input-errors').hidden = true;
  if (!config.parseEndpoint) {
    showInputError('Screenshot parsing isn’t enabled on this deployment. '
      + 'Paste the page text instead, or enter your items by hand. Both work fully in your browser.');
    return;
  }

  const files = [...fileList];
  const pdf = files.find((f) => f.type === 'application/pdf');
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (!pdf && images.length === 0) {
    showInputError('Those files aren’t screenshots. Drop images (PNG or JPG) or a full-page PDF capture, or paste text instead.');
    return;
  }
  if (files.some((f) => f.size > 8 * 1024 * 1024)) {
    showInputError('One of those files is over 8 MB. Try normal screenshots rather than photos, or paste the text instead.');
    return;
  }

  setParseBusy(true);
  try {
    let payload;
    if (pdf) {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(pdf);
      });
      payload = { pdf: dataUrl.split(',')[1] };
    } else {
      const parts = (await Promise.all(images.map(prepareImage))).flat();
      if (parts.length > MAX_PARTS) {
        showInputError(`That’s more than ${MAX_PARTS} screenshots’ worth of image. `
          + 'For a list that long, select everything on the page, copy it, and use “Paste the page text” below. It captures everything at once.');
        return;
      }
      payload = {
        images: parts.map((dataUrl) => {
          const [, mediaType, data] = dataUrl.match(/^data:([^;]+);base64,(.+)$/) ?? [];
          return { data, mediaType };
        }),
      };
      if (payload.images.some((p) => !p.data)) throw new Error('encode failed');
    }

    const res = await fetch(config.parseEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);

    if (!res.ok || !body) {
      showInputError(body?.error
        ?? 'The screenshot reader is unavailable right now. Paste the page text instead. That works entirely in your browser.');
      return;
    }
    if (body.wrongPage) {
      showInputError('That capture doesn’t look like a course materials page. '
        + 'Open your bookstore’s My Course Materials page (the list of what’s included for your classes) and capture that.');
      return;
    }
    const items = adoptItems(body.items);
    if (items.length === 0) {
      showInputError('Couldn’t find any course materials in that capture. '
        + 'Try a tighter screenshot of the materials list, paste the text, or enter items by hand.');
      return;
    }
    state.items = items;
    state.warnings = body.warnings ?? [];
    state.units = readUnits() ?? state.units;
    renderConfirm();
    showStep('confirm');
  } catch {
    showInputError('Couldn’t read that capture. Paste the page text instead. That works entirely in your browser.');
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
    if (fileInput.files.length > 0) handleCaptureFiles(fileInput.files);
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
    const files = e.dataTransfer?.files;
    if (files?.length) handleCaptureFiles(files);
  });

  document.addEventListener('paste', (e) => {
    if (state.step !== 'input') return;
    if (e.target === $('text-input')) return;
    const file = [...(e.clipboardData?.items ?? [])]
      .find((it) => it.type.startsWith('image/'))?.getAsFile();
    if (file) handleCaptureFiles([file]);
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
      <label>${label}${low ? ' <span class="check-hint">(check this, the tool wasn’t sure)</span>' : ''}</label>
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
      That’s a real result. Confirm below to see what the bundle costs anyway.</div>`;
  } else {
    list.innerHTML = state.items.map((item, idx) => {
      const lowFormat = item.confidence.format === 'low';
      return `
      <div class="item-card" data-item-id="${esc(item.id)}">
        ${item.isAccessCode ? '<span class="badge">Single-use access code (usually can’t be bought used)</span>' : ''}
        ${fieldHtml(item, idx, 'title', 'Title', item.title)}
        ${fieldHtml(item, idx, 'courseCode', 'Course (optional)', item.courseCode, 'placeholder="e.g. CS 454"')}
        <div class="field ${lowFormat ? 'low-confidence' : ''}">
          <label>Format${lowFormat ? ' <span class="check-hint">(check this, the tool wasn’t sure)</span>' : ''}</label>
          <select data-idx="${idx}" data-field="format">
            ${Object.entries(FORMAT_LABELS).map(([v, l]) => `<option value="${v}" ${item.format === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        ${fieldHtml(item, idx, 'isbn', 'ISBN (optional, makes price links exact)', item.isbn)}
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

  // Keep the pinned figure agreeing with the confirm-step units field live.
  $('confirm-units-row').addEventListener('input', (e) => {
    if (e.target.id === 'confirm-units-input') renderCompareFigure(null);
  });

  $('back-btn').addEventListener('click', () => showStep('input'));

  $('confirm-btn').addEventListener('click', () => {
    const errEl = $('confirm-errors');
    errEl.hidden = true;

    const unitsVal = Number($('confirm-units-input')?.value);
    if (!Number.isFinite(unitsVal) || unitsVal < 1 || unitsVal > config.maxUnits) {
      errEl.textContent = `Enter your registered units, between 1 and ${config.maxUnits}. The bundle is billed per unit.`;
      errEl.hidden = false;
      return;
    }
    const incomplete = state.items.filter((it) => !(it.title ?? '').trim() && !(it.isbn ?? '').trim());
    if (incomplete.length > 0) {
      errEl.textContent = 'Every item needs at least a title or an ISBN. Or remove the ones you don’t need.';
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

const ICONS = {
  good: '<svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="8.25"/><path d="M6.5 10.5l2.4 2.4 4.6-5.2"/></svg>',
  info: '<svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10" cy="10" r="8.25"/><path d="M10 9.25v4.5"/><path d="M10 6.1v.1"/></svg>',
  warn: '<svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 3.2L18 16.8H2z"/><path d="M10 8.4v3.4"/><path d="M10 14.4v.1"/></svg>',
};

function formatDeadline(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

// Whatever units value the user can currently see and edit: the confirm-step
// field while confirming, otherwise the hero stepper. Keeps the pinned figure
// agreeing with the input next to it instead of a stale snapshot.
function liveUnits() {
  if (state.step === 'confirm') {
    const v = Number($('confirm-units-input')?.value);
    if (Number.isFinite(v) && v >= 1 && v <= config.maxUnits) return v;
  }
  return readUnits() ?? state.units ?? heroUnits;
}

// The pinned instrument. Pass a verdict for live totals; pass null before the
// user has confirmed anything and it shows the bundle bar with the buying bar
// honestly unmeasured.
function renderCompareFigure(v) {
  const el = $('compare-figure');
  const units = v ? state.units : liveUnits();
  const bundleCost = v ? v.bundleCost : Math.round(units * config.pricePerUnit * 100) / 100;

  let buyLabel = 'Buying it yourself';
  let buyVal;
  let buyTrack;
  if (!v) {
    buyVal = 'not measured yet';
    buyTrack = '<div class="compare-track t-empty"></div>';
  } else if (state.items.length === 0) {
    buyLabel = 'Buying nothing (your list shows no items)';
    buyVal = fmt(0);
    buyTrack = '<div class="compare-track t-buy" style="width:2%"></div>';
  } else if (v.pricedCount === 0) {
    buyVal = v.complete ? 'nothing to compare yet' : 'type prices below';
    buyTrack = '<div class="compare-track t-empty"></div>';
  } else {
    if (!v.complete || v.skippedCount > 0) buyLabel += ` (${v.pricedCount} of ${v.totalCount} priced)`;
    buyVal = fmt(v.knownBuyTotal);
  }

  const maxVal = Math.max(bundleCost, v?.knownBuyTotal ?? 0, 1);
  const w = (x) => Math.max(2, Math.round((x / maxVal) * 100));
  if (buyTrack === undefined) {
    buyTrack = `<div class="compare-track t-buy" style="width:${w(v.knownBuyTotal)}%"></div>`;
  }

  el.innerHTML = `
    <div class="compare-row">
      <div class="compare-label"><span>Seawolf Bundle, ${units} units</span>
        <span class="val">${fmt(bundleCost)}</span></div>
      <div class="compare-track t-bundle" style="width:${w(bundleCost)}%"></div>
    </div>
    <div class="compare-row">
      <div class="compare-label"><span>${esc(buyLabel)}</span><span class="val">${buyVal}</span></div>
      ${buyTrack}
    </div>
    <p class="compare-caption">Using ${esc(config.term)}&rsquo;s published rate of
      ${fmt(config.pricePerUnit)} per unit (<a href="${esc(config.claimsUrl)}">sources</a>).
      The buying bar comes from prices you enter, not a quote.</p>`;
}

function updatePriceProgress(v) {
  const el = $('price-progress');
  if (!el) return;
  if (!v || state.items.length === 0) {
    el.textContent = '';
    return;
  }
  const done = v.pricedCount + v.skippedCount;
  el.textContent = done >= v.totalCount
    ? `All ${v.totalCount} item${v.totalCount === 1 ? '' : 's'} accounted for.`
    : `${v.pricedCount} of ${v.totalCount} priced. Each price you add sharpens the answer.`;
}

function renderVerdict() {
  const container = $('verdict-items');
  if (state.items.length === 0) {
    container.innerHTML = '';
  } else {
    container.innerHTML = `<p class="muted small">Tap a store, find your edition&rsquo;s best
      price, type it in. Links search by ISBN when your list showed one, otherwise by title.</p>`
      + state.items.map((item, idx) => `
      <div class="v-item${item.userPrice != null && !item.skipped ? ' priced' : ''}${item.skipped ? ' skipped' : ''}" data-item-idx="${idx}">
        <span class="item-state">${ICONS.good} priced</span>
        <div class="v-title">${esc(item.title || item.isbn || 'Untitled item')}</div>
        <div class="v-meta">${esc([item.courseCode, FORMAT_LABELS[item.format], item.isbn ? `ISBN ${item.isbn}` : null].filter(Boolean).join(' · '))}</div>
        ${item.isAccessCode ? `<div class="badge">Single-use access code</div>
          <div class="v-meta">Access codes usually can&rsquo;t be bought used. Check the
          publisher&rsquo;s own price for new access and enter that.</div>` : ''}
        <div class="retailer-links">${retailerLinks(item)}</div>
        <div class="price-row">
          <label for="price-${idx}">Best price you found</label>
          <input type="number" id="price-${idx}" data-price-idx="${idx}" min="0" max="99999" step="0.01"
            inputmode="decimal" placeholder="0.00" value="${item.userPrice ?? ''}" ${item.skipped ? 'disabled' : ''}>
          <label class="skip-label"><input type="checkbox" data-skip-idx="${idx}" ${item.skipped ? 'checked' : ''}>
            couldn&rsquo;t find it</label>
        </div>
      </div>`).join('');
  }

  const deadlineEl = $('deadline-note');
  if (config.optOutDeadline) {
    deadlineEl.innerHTML = `<strong>Opt-out deadline for ${esc(config.term)}:
      ${esc(formatDeadline(config.optOutDeadline))}</strong>, the last day of add/drop.
      Whichever way your numbers point, decide before then. The switch lives on the
      <a href="${esc(config.optOutUrl)}" target="_blank" rel="noopener noreferrer">official
      opt-out page&nbsp;&#8599;</a>. One more thing: your list can change after you decide
      (the contract permits late faculty adoptions), so check it again near the deadline.
      Opting out is not a lockout. If a course later needs something, you buy just that
      item, then.`;
  } else {
    deadlineEl.innerHTML = `<strong>Mind the deadline.</strong> Opting out closes at SSU&rsquo;s
      add/drop deadline for ${esc(config.term)}. Check your bookstore portal or the academic
      calendar for the exact date. Your list can change after you decide (the contract permits
      late faculty adoptions), so check it again near the deadline. Opting out is not a
      lockout. If a course later needs something, you buy just that item, then.`;
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
    headline = `Your list shows nothing included. The bundle would cost you ${fmt(v.bundleCost)} for it.`;
    detail = `<p class="verdict-detail">Buying nothing costs $0.00. Based on what your list shows
      today, opting out saves you <strong>${fmt(v.difference)}</strong>. Materials can still be
      added later, see below.</p>`;
  } else if (v.recommendation === 'incomplete' && v.complete && v.pricedCount === 0) {
    headline = 'Every item is marked “couldn’t find it”, so there’s nothing to compare yet.';
    detail = `<p class="verdict-detail">The bundle costs ${fmt(v.bundleCost)} for your units,
      but without at least one price you found, the tool has no basis for a verdict and won’t
      invent one. Try the search links again, or ask a librarian or classmate for help finding
      a price.</p>`;
  } else if (v.recommendation === 'incomplete') {
    headline = 'Enter the prices you find and the verdict appears here.';
    detail = `<p class="verdict-detail">So far: bundle ${fmt(v.bundleCost)} vs
      <strong>${fmt(v.knownBuyTotal)}</strong> ${basis}. The tool won’t call it until every
      item has a price or is marked “couldn’t find it”.</p>`;
  } else if (v.recommendation === 'opt_out') {
    cls = 'v-optout';
    headline = `Buying on your own looks cheaper. You’d keep ${fmt(v.difference)}.`;
    detail = `<p class="verdict-detail">${fmt(v.knownBuyTotal)} to buy the items on your list,
      vs ${fmt(v.bundleCost)} for the bundle, ${basis}.</p>
      ${v.skippedCount > 0 ? `<p class="verdict-detail"><strong>Caveat:</strong> ${v.skippedCount}
      item(s) you couldn’t price aren’t counted. If they turn out to be expensive,
      this could flip. Price them before deciding if you can.</p>` : ''}`;
  } else if (v.recommendation === 'stay_in') {
    cls = 'v-stayin';
    headline = `The bundle looks like the better deal. It saves you ${fmt(Math.abs(v.difference))}.`;
    detail = `<p class="verdict-detail">${fmt(v.knownBuyTotal)} to buy the items on your list,
      vs ${fmt(v.bundleCost)} for the bundle, ${basis}. Staying in means doing nothing.
      You’re enrolled by default.</p>`;
  } else {
    cls = 'v-close';
    headline = `It’s close: within ${fmt(config.closeThreshold)} either way.`;
    detail = `<p class="verdict-detail">${fmt(v.knownBuyTotal)} to buy vs ${fmt(v.bundleCost)}
      for the bundle, ${basis}. At this margin, think about the non-price factors: most physical
      bundle items are rentals you return; books you buy are yours to keep or resell; and materials
      can be added to a course after you decide.</p>`;
  }

  const accessNote = v.accessCodeCount > 0 && state.items.length > 0
    ? `<p class="verdict-detail">${v.accessCodeCount} of your items ${v.accessCodeCount === 1 ? 'is' : 'are'}
      a single-use access code, which usually can’t be bought used. If new codes are expensive,
      the bundle can genuinely be the better deal, and this tool will say so when your numbers show it.</p>`
    : '';

  // Both decisive answers get the same check mark. The tool doesn't treat
  // opting out as the "success" state; panel color alone distinguishes them.
  const icon = cls === 'v-optout' || cls === 'v-stayin' ? ICONS.good
    : cls === 'v-close' ? ICONS.warn : ICONS.info;
  panel.className = `verdict-panel ${cls}`;
  panel.innerHTML = `<p class="verdict-headline">${icon}<span>${headline}</span></p>${detail}${accessNote}
    <p class="muted small">Prices you type are your findings from the linked stores. The tool
    doesn’t verify them, and the verdict is only as good as your numbers.
    <a href="${esc(config.methodologyUrl)}">How this is computed</a>.</p>`;
  renderCompareFigure(v);
  updatePriceProgress(v);
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
    const row = e.target.closest('.v-item');
    if (row) {
      const it = state.items[Number(row.dataset.itemIdx)];
      row.classList.toggle('priced', it.userPrice != null && !it.skipped);
      row.classList.toggle('skipped', Boolean(it.skipped));
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
document.querySelectorAll('[data-config="term"]').forEach((el) => {
  el.textContent = config.term;
});
document.querySelectorAll('[data-config="fullLoad15"]').forEach((el) => {
  el.textContent = `$${(15 * config.pricePerUnit).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
});
// Doc links point at GitHub's rendered views (raw .md serves as plain text
// on most static hosts); bookstore links come from config so each term's
// re-verification touches one file.
const LINKS = {
  methodology: config.methodologyUrl,
  claims: config.claimsUrl,
  'course-materials': config.courseMaterialsUrl,
  'course-finder': config.courseFinderUrl,
};
Object.entries(LINKS).forEach(([key, url]) => {
  document.querySelectorAll(`[data-link="${key}"]`).forEach((el) => el.setAttribute('href', url));
});
// Hero bill fragment: units in, bundle bill out, instantly. This is the
// first working piece of the calculator a visitor touches. An out-of-range
// or empty field never fakes a dollar figure; it asks instead.
function updateBill() {
  const units = readUnits();
  const out = $('bill-out');
  if (out) {
    if (units == null) {
      out.innerHTML = `Enter units between 1 and ${config.maxUnits} to see your bill.`;
    } else {
      heroUnits = units;
      const amount = fmt(Math.round(units * config.pricePerUnit * 100) / 100);
      out.innerHTML = `Unless you opt out, SSU bills you
        <strong id="bill-amount">${amount}</strong> for it this semester.`;
    }
  }
  if (state.step !== 'verdict') renderCompareFigure(null);
}
function nudgeUnits(delta) {
  const input = $('units-input');
  const next = Math.min(config.maxUnits, Math.max(1, (Number(input.value) || heroUnits) + delta));
  input.value = next;
  updateBill();
}
$('units-input')?.addEventListener('input', updateBill);
$('units-minus')?.addEventListener('click', () => nudgeUnits(-1));
$('units-plus')?.addEventListener('click', () => nudgeUnits(1));
updateBill();

// Tailor the capture instruction to this device so nobody reads three sets of
// steps. Detection is read locally from the browser and never transmitted.
// iPads masquerade as Macs in Safari's default desktop mode — touch points
// tell them apart. Unknown devices keep the generic instruction.
function detectDevice() {
  const ua = navigator.userAgent;
  if (/iPhone|iPod|iPad/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (navigator.maxTouchPoints > 1 || /Mobile/.test(ua)) return null;
  return 'desktop';
}

const DEVICE_CAPTURE = {
  ios: 'Take a screenshot, tap its preview, choose <strong>Full&nbsp;Page</strong>, and save it '
    + 'as a PDF (it lands in your Files app). One capture gets your whole list.',
  android: 'Take a scrolling screenshot (<strong>Capture&nbsp;more</strong>) so the whole list '
    + 'fits in one long image.',
  desktop: 'Easiest on a computer: select the whole page (<strong>Ctrl/Cmd&#8209;A</strong>), '
    + 'copy, and use <strong>Paste the page text</strong> below. It captures everything. '
    + 'Screenshots work too.',
};

const device = detectDevice();
if (device && DEVICE_CAPTURE[device]) {
  const instr = $('capture-instruction');
  if (instr) instr.innerHTML = DEVICE_CAPTURE[device];
  const summary = $('capture-alternatives-summary');
  if (summary) summary.textContent = 'On a different device?';
}
