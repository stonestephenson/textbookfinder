import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateUnits, normalizeStudentCourseCode } from '../assets/estimate-units.js';

const TABLE = { 'CS 454': 4, 'CS 496': 3, 'CS 390': 1, 'MATH 161': 4 };

test('sums units for matched courses, dropping the section number', () => {
  const r = estimateUnits([{ code: 'CS 454 001' }, { code: 'CS 496 002' }], TABLE);
  assert.equal(r.units, 7);
  assert.equal(r.matched, 2);
  assert.equal(r.assumed, 0);
  assert.equal(r.courseCount, 2);
});

test('an unmatched course falls back to the assumed per-course units', () => {
  const r = estimateUnits([{ code: 'PHYS 210 001' }], TABLE, { assumedUnitsPerCourse: 3 });
  assert.equal(r.units, 3);
  assert.equal(r.matched, 0);
  assert.equal(r.assumed, 1);
});

test('a mixed cart sums matched + assumed', () => {
  const r = estimateUnits(
    [{ code: 'CS 454 001' }, { code: 'CS 390 001' }, { code: 'PHYS 210 001' }],
    TABLE,
    { assumedUnitsPerCourse: 3 },
  );
  assert.equal(r.units, 8); // 4 + 1 + 3
  assert.equal(r.matched, 2);
  assert.equal(r.assumed, 1);
});

test('the same course listed twice counts once', () => {
  const r = estimateUnits([{ code: 'CS 454 001' }, { code: 'CS 454 002' }], TABLE);
  assert.equal(r.units, 4);
  assert.equal(r.courseCount, 1);
});

test('accepts bare code strings as well as objects', () => {
  const r = estimateUnits(['CS 454', 'CS 390'], TABLE);
  assert.equal(r.units, 5);
});

test('no usable course code → null (caller keeps its baseline)', () => {
  assert.equal(estimateUnits([], TABLE), null);
  assert.equal(estimateUnits([{ code: null }, { title: 'no code here' }], TABLE), null);
  assert.equal(estimateUnits(null, TABLE), null);
});

test('the estimate is capped at maxUnits', () => {
  const seven = ['PHYS 101', 'CHEM 101', 'HIST 101', 'GEOG 101', 'MUSC 101', 'THEA 101', 'DANC 101']
    .map((code) => ({ code }));
  const r = estimateUnits(seven, TABLE, { assumedUnitsPerCourse: 4, maxUnits: 24 });
  assert.equal(r.courseCount, 7);
  assert.equal(r.units, 24); // 7 × 4 = 28, capped at 24
});

test('normalizeStudentCourseCode canonicalizes common formats', () => {
  assert.equal(normalizeStudentCourseCode('CS 454 001'), 'CS 454');
  assert.equal(normalizeStudentCourseCode('cs454'), 'CS 454');
  assert.equal(normalizeStudentCourseCode('MATH 161-02'), 'MATH 161');
  assert.equal(normalizeStudentCourseCode('AMCS 165A 001'), 'AMCS 165A');
  assert.equal(normalizeStudentCourseCode('no code'), null);
  assert.equal(normalizeStudentCourseCode(''), null);
  assert.equal(normalizeStudentCourseCode(null), null);
});
