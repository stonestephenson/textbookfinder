// Deterministic parser for text pasted from a bookstore course-materials page.
// Heuristic by necessity — every result goes through the user confirmation step,
// so the contract here is: never guess silently. Uncertain fields get
// confidence 'low' and the UI asks.
//
// Prices that appear in the paste are deliberately ignored. The tool never
// ingests a price it didn't source, and bookstore rental/new prices are not
// the prices a student would pay elsewhere.

// A course-code line must be the ENTIRE line (plus optional section number):
// "CS 454 01", "PHIL-120 01", "kin 312a". Anything embedded in prose is not one.
const COURSE_LINE_RE = /^([A-Za-z]{2,5})[\s-]?(\d{2,4}[A-Za-z]?)(\s+\d{1,3}[A-Za-z]?)?$/;

const LABELED_ISBN_RE = /isbn[^0-9x]*([0-9][0-9-\s]{7,20}[0-9Xx])/i;
const BARE_ISBN13_RE = /\b(97[89][\d-\s]{10,16}\d)\b/;

const PHYSICAL_RE = /\b(paperback|hardcover|hardback|loose-?leaf|spiral|rental|print(ed)?( book)?)\b/i;
const DIGITAL_RE = /\b(ebook|e-book|etext(book)?|digital|online access)\b/i;
const ACCESS_RE = /\b(access code|access card|courseware)\b/i;
const PRICE_LINE_RE = /\$\s?\d/;
const BYLINE_RE = /^by[:\s]/i;
const BUNDLE_LINE_RE = /\b(seawolf bundle|first day)\b/i;

export function normalizeIsbn(raw) {
  return raw.replace(/[^0-9Xx]/g, '').toUpperCase();
}

export function isValidIsbn(raw) {
  const s = normalizeIsbn(raw);
  if (s.length === 13 && /^\d{13}$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 13; i += 1) sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
    return sum % 10 === 0;
  }
  if (s.length === 10 && /^\d{9}[\dX]$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 10; i += 1) {
      const v = s[i] === 'X' ? 10 : Number(s[i]);
      sum += v * (10 - i);
    }
    return sum % 11 === 0;
  }
  return false;
}

function accessPatternRe(patterns) {
  const escaped = patterns.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(${escaped.join('|')})\\b`, 'i');
}

function classifyFormat(text, accessRe) {
  if (ACCESS_RE.test(text) || accessRe.test(text)) return 'access_code';
  if (DIGITAL_RE.test(text)) return 'digital';
  if (PHYSICAL_RE.test(text)) return 'physical';
  return null;
}

function findIsbn(line) {
  const labeled = line.match(LABELED_ISBN_RE);
  if (labeled) {
    const s = normalizeIsbn(labeled[1]);
    if (s.length === 10 || s.length === 13) return s;
  }
  const bare = line.match(BARE_ISBN13_RE);
  if (bare) {
    const s = normalizeIsbn(bare[1]);
    if (s.length === 13) return s;
  }
  return null;
}

function isTitleCandidate(line) {
  if (line.length < 4) return false;
  if (!/[a-zA-Z]{3}/.test(line)) return false;
  if (COURSE_LINE_RE.test(line)) return false;
  if (findIsbn(line)) return false;
  if (PRICE_LINE_RE.test(line)) return false;
  if (BYLINE_RE.test(line)) return false;
  if (BUNDLE_LINE_RE.test(line)) return false;
  if (/^(format|edition|publisher|author|required|optional|recommended)\b/i.test(line)) return false;
  return true;
}

let nextId = 1;

function makeItem({ courseCode, title, titleConfidence, format, formatConfidence, isbn }, accessRe) {
  const searchable = `${title ?? ''}`;
  const isAccessCode = format === 'access_code'
    || ACCESS_RE.test(searchable) || accessRe.test(searchable);
  return {
    id: `item-${nextId++}`,
    courseCode: courseCode ?? null,
    title: title ?? null,
    format: isAccessCode ? 'access_code' : (format ?? 'unknown'),
    isbn: isbn ?? null,
    isAccessCode,
    userPrice: null,
    skipped: false,
    confidence: {
      courseCode: courseCode ? 'high' : 'low',
      title: titleConfidence ?? 'low',
      format: isAccessCode ? 'high' : (format ? (formatConfidence ?? 'high') : 'low'),
      isbn: isbn && isValidIsbn(isbn) ? 'high' : 'low',
    },
  };
}

// One block (blank-line-separated chunk) can hold several items. A new item
// starts at a second ISBN, or at a title line that appears after the current
// item already has its ISBN. Format is tracked per item; a block-level format
// only carries to other items in the block as a LOW-confidence fallback —
// inheriting it silently at high confidence is how an access code gets
// mislabeled as a paperback.
function parseBlock(lines, accessRe) {
  let courseCode = null;
  let blockFormat = null;
  const segments = [{ titleLines: [], isbn: null, format: null }];
  const current = () => segments[segments.length - 1];

  for (const line of lines) {
    const courseMatch = line.match(COURSE_LINE_RE);
    if (courseMatch && !courseCode) {
      courseCode = `${courseMatch[1].toUpperCase()} ${courseMatch[2].toUpperCase()}`;
      continue;
    }
    const isbn = findIsbn(line);
    if (isbn) {
      if (current().isbn) segments.push({ titleLines: [], isbn, format: null });
      else current().isbn = isbn;
      continue;
    }
    const fmt = classifyFormat(line, accessRe);
    if (fmt && !isTitleCandidate(line)) {
      current().format = current().format ?? fmt;
      blockFormat = blockFormat ?? fmt;
      continue;
    }
    if (isTitleCandidate(line)) {
      if (current().isbn) segments.push({ titleLines: [line], isbn: null, format: null });
      else current().titleLines.push(line);
      if (fmt) {
        current().format = current().format ?? fmt;
        blockFormat = blockFormat ?? fmt;
      }
    }
  }

  // Trailing ISBN-less segments in a multi-item block are too ambiguous to
  // turn into items — surface their lines as a warning instead of guessing.
  const kept = segments.filter((seg, i) => seg.isbn
    || (i === 0 && courseCode && seg.titleLines.length > 0));
  const orphanedLines = segments
    .filter((seg) => !kept.includes(seg))
    .flatMap((seg) => seg.titleLines);

  const multi = kept.length > 1;
  const items = kept.map((seg) => makeItem({
    courseCode,
    title: seg.titleLines[0] ?? null,
    titleConfidence: seg.titleLines.length === 1 ? 'high' : 'low',
    format: seg.format ?? blockFormat,
    formatConfidence: seg.format ? 'high' : (blockFormat && !multi ? 'high' : 'low'),
    isbn: seg.isbn,
  }, accessRe));

  return { items, orphanedLines };
}

export function parseText(raw, config) {
  const accessRe = accessPatternRe(config.accessCodePatterns ?? []);
  const warnings = [];
  const text = (raw ?? '').replace(/\r\n/g, '\n');

  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.split('\n').map((l) => l.trim()).filter(Boolean))
    .filter((b) => b.length > 0);

  const parsed = blocks.map((block) => parseBlock(block, accessRe));
  const items = parsed.flatMap((p) => p.items);
  const orphaned = parsed.flatMap((p) => p.orphanedLines);
  if (items.length > 0 && orphaned.length > 0) {
    warnings.push(
      `Some pasted lines couldn't be attached to an item (e.g. “${orphaned[0]}”). `
      + 'Check the list below and add anything that’s missing.',
    );
  }

  if (items.length === 0 && text.trim().length > 0) {
    // The bundle portal's welcome screen carries only summary counts — the
    // item details render deeper in (per-course sections), so a select-all
    // copy of that screen has nothing extractable. Say so specifically:
    // the generic message sends people in circles. (Observed on a real
    // student portal capture, 2026-08-12.)
    const welcomePage = /welcome to seawolf bundle|included materials? available|estimated savings on/i.test(text);
    if (welcomePage) {
      const count = text.match(/have\s+(\d+)\s+included materials?/i);
      const mention = count && Number(count[1]) > 0
        ? `Your page says ${count[1]} included item${Number(count[1]) === 1 ? '' : 's'}, but the details didn’t come through in the copied text. `
        : '';
      warnings.push(
        `${mention}That looks like the bundle welcome screen, which only shows summary `
        + 'counts. Scroll to your courses and open each one so the actual materials show, '
        + 'then copy again. A screenshot of the expanded list works too.',
      );
    } else {
      warnings.push(
        "Couldn't find any course materials in that text. Try pasting the full "
        + 'course materials section from your bookstore page, or enter items manually below.',
      );
    }
  }
  return { items, warnings };
}
