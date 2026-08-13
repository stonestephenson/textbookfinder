import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseText, normalizeIsbn, isValidIsbn } from '../assets/parse-text.js';

const config = {
  accessCodePatterns: [
    'MyLab', 'MindTap', 'WebAssign', 'Cengage Unlimited', 'Connect',
    'ALEKS', 'Revel', 'Achieve', 'zyBooks', 'Top Hat', 'LaunchPad',
    'access code', 'access card', 'courseware',
  ],
};

test('clean two-item paste: course codes, titles, ISBNs, formats', () => {
  const raw = `
CS 454 01
Introduction to the Theory of Computation
By: Sipser
ISBN: 9781133187790
Format: Paperback Rental
Included in Seawolf Bundle

MATH 161 02
Calculus: Early Transcendentals
ISBN: 9781319050740
Format: Hardcover
`;
  const { items, warnings } = parseText(raw, config);
  assert.equal(items.length, 2);
  assert.equal(items[0].courseCode, 'CS 454');
  assert.equal(items[0].isbn, '9781133187790');
  assert.equal(items[0].format, 'physical');
  assert.equal(items[0].title, 'Introduction to the Theory of Computation');
  assert.equal(items[0].isAccessCode, false);
  assert.equal(items[1].courseCode, 'MATH 161');
  assert.equal(items[1].format, 'physical');
  assert.equal(warnings.length, 0);
});

test('access-code item is detected and flagged', () => {
  const raw = `
BIOL 115 01
MyLab Biology with Pearson eText Access Code
ISBN: 9780135854860
Format: Digital
`;
  const { items } = parseText(raw, config);
  assert.equal(items.length, 1);
  assert.equal(items[0].isAccessCode, true);
  assert.equal(items[0].format, 'access_code');
});

test('bookstore prices in the paste are ignored, never ingested', () => {
  const raw = `
CS 454 01
Introduction to the Theory of Computation
ISBN: 9781133187790
Format: Paperback
Rental: $34.99
Buy New: $89.75
`;
  const { items } = parseText(raw, config);
  assert.equal(items.length, 1);
  const serialized = JSON.stringify(items);
  assert.ok(!serialized.includes('34.99'));
  assert.ok(!serialized.includes('89.75'));
});

test('ISBN-10 is normalized to digits, hyphens stripped', () => {
  assert.equal(normalizeIsbn('978-1-133-18779-0'), '9781133187790');
  assert.equal(normalizeIsbn('0-262-03384-4'), '0262033844');
});

test('ISBN-13 checksum validation', () => {
  assert.equal(isValidIsbn('9781133187790'), true);
  assert.equal(isValidIsbn('9781133187791'), false);
  assert.equal(isValidIsbn('0262033844'), true); // valid ISBN-10
  assert.equal(isValidIsbn('12345'), false);
});

test('invalid ISBN checksum → kept but low confidence', () => {
  const raw = `
CS 101 01
Some Book
ISBN: 9781133187791
Format: Paperback
`;
  const { items } = parseText(raw, config);
  assert.equal(items.length, 1);
  assert.equal(items[0].confidence.isbn, 'low');
});

test('garbage input → no items, a warning, no throw', () => {
  const { items, warnings } = parseText('lol random text\nnothing here', config);
  assert.equal(items.length, 0);
  assert.ok(warnings.length >= 1);
});

test('empty input → no items, no throw', () => {
  const { items } = parseText('', config);
  assert.equal(items.length, 0);
});

test('block with a title but no ISBN still becomes an item with low-confidence fields', () => {
  const raw = `
ENGL 210 03
Custom Course Reader (SSU Edition)
Format: Loose-leaf
`;
  const { items } = parseText(raw, config);
  assert.equal(items.length, 1);
  assert.equal(items[0].isbn, null);
  assert.equal(items[0].courseCode, 'ENGL 210');
});

test('single block containing two ISBNs splits into two items, each keeping its own title', () => {
  const raw = `
CHEM 115 01
Chemistry: The Central Science
ISBN: 9780134414232
Chemistry Lab Manual
ISBN: 9780134616452
Format: Paperback
`;
  const { items } = parseText(raw, config);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Chemistry: The Central Science');
  assert.equal(items[1].title, 'Chemistry Lab Manual');
  assert.equal(items[1].format, 'physical'); // its own Format line
  assert.equal(items[0].confidence.format, 'low'); // inherited block fallback in a multi-item block
});

test('per-item format wins over block fallback; access card is never mislabeled physical', () => {
  const raw = `
BIOL 115 01
Campbell Biology
ISBN: 9780134093413
Format: Hardcover
Mastering Biology Access Card
ISBN: 9780134446417
`;
  const { items } = parseText(raw, config);
  assert.equal(items.length, 2);
  assert.equal(items[0].format, 'physical');
  assert.equal(items[1].format, 'access_code');
  assert.equal(items[1].isAccessCode, true);
});

test('trailing unattachable lines produce a warning, not a ghost item', () => {
  const raw = `
CS 454 01
Introduction to the Theory of Computation
ISBN: 9781133187790
Supplemental notes packet for lab section
`;
  const { items, warnings } = parseText(raw, config);
  assert.equal(items.length, 1);
  assert.ok(warnings.some((w) => w.includes('couldn’t be attached') || w.includes("couldn't be attached")));
});

test('course code variants match', () => {
  const raws = ['PHIL-120 01\nLogic Primer\nISBN: 9780262533756\n', 'kin 312a 02\nMotor Learning\nISBN: 9781718210714\n'];
  const codes = raws.map((r) => parseText(r, config).items[0]?.courseCode);
  assert.equal(codes[0], 'PHIL 120');
  assert.equal(codes[1], 'KIN 312A');
});

test('the bundle welcome screen gets a targeted message, with its own count quoted back', () => {
  const raw = `
Welcome, Stone
Your estimated savings on
included materials is:
$13.15*
Hello Stone,
Welcome to Seawolf Bundle!
You are registered for 5 courses and have 1 included materials available.
Events Timeline
Opt Out End Date
 September 13, 2026
`;
  const { items, warnings } = parseText(raw, config);
  assert.equal(items.length, 0);
  assert.ok(warnings[0].includes('1 included item'), warnings[0]);
  assert.ok(warnings[0].includes('welcome screen'), warnings[0]);
  assert.ok(warnings[0].includes('open each one'), warnings[0]);
});

test('unrecognizable text still gets the generic no-items message', () => {
  const { warnings } = parseText('lol random text\nnothing here at all', config);
  assert.ok(warnings[0].includes("Couldn't find any course materials"), warnings[0]);
});

test('real B&N portal paste: expanded course reveals the one included item, deduped, no ISBN', () => {
  // Verbatim structure from a real student capture, 2026-08-12: markers
  // around an all-caps title, no ISBN anywhere, the title printed twice.
  const raw = `
Hello Stone,
Welcome to Seawolf Bundle!
You are registered for 5 courses and have 1 included materials available.

Be Ready For Your First Day Of Class
Additional Faculty Required or Recommended Items
Your instructor has added some materials you'll need that are not included in the Seawolf Bundle program.

This course does not require any course materials
INCLUDED
Physical Item
INTRO.TO THEORY OF COMPUTATION (PB)
REQUIRED

INTRO.TO THEORY OF COMPUTATION (PB)
by SIPSER | Edition: 3RD 13

Events Timeline
Opt Out End Date
 September 13, 2026
`;
  const { items, warnings } = parseText(raw, config);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'INTRO.TO THEORY OF COMPUTATION (PB)');
  assert.equal(items[0].format, 'physical');
  assert.equal(items[0].confidence.format, 'high');
  assert.equal(items[0].isbn, null);
  assert.equal(items[0].isAccessCode, false);
  assert.ok(!warnings.some((w) => w.includes('welcome screen')), 'welcome warning must not fire when an item parsed');
});

test('a digital item chip classifies the format without an ISBN', () => {
  const raw = `
INCLUDED
Digital Item
CHEMISTRY: ATOMS FIRST (EBOOK)
REQUIRED
`;
  const { items } = parseText(raw, config);
  assert.equal(items.length, 1);
  assert.equal(items[0].format, 'digital');
});

test('dedupe never merges distinct titles', () => {
  const raw = `
INCLUDED
Physical Item
CALCULUS: EARLY TRANSCENDENTALS (HC)
REQUIRED

INCLUDED
Physical Item
LINEAR ALGEBRA DONE RIGHT (PB)
REQUIRED
`;
  const { items } = parseText(raw, config);
  assert.equal(items.length, 2);
});
