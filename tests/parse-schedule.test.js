import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSchedule, normalizeCourseCode } from '../scripts/parse-schedule.js';

// Rows are verbatim in the layout of SSU's F26 Schedule of Classes (the docx/pdf
// textutil/pdftotext output): class#, requisite codes, subject, number, section,
// optional GE code, title, units, component, grading, days, time, room, staff.
const FIXTURE = [
  'Computer Science',
  '------------------------------------------------------------------------------',
  '1920   1,84      CS   115   001        Programming I                   4.0 DIS GRD MW      10:00A-11:50A DARW0025   STAFF',
  '1925   1,84      CS   252   001        Intro to Computer Organization  4.0 DIS GRD MW      01:00P-02:15P DARW0031   M Gondree',
  '       30,84     CS   252   002        Intro to Computer Organization      LAB     R       03:00P-05:50P DARW0028   M Gondree',
  '1932   84        CS   390   001        Computer Science Colloquium     1.0 LEC CNC M       12:00P-12:50P STEV1300   S Rivoire',
  '2178   84        CS   454   001  2 U   Theory of Computation           4.0 LEC GRD TR      03:00P-04:50P STEV1206   B Ravikumar',
  '2228             CS   496   001        Senior Research Project         3.0 SUP GRD         ARRANGE                  G Gill',
  '2504             CS   485   001        Robotics                       ***  DIS OPT TR      11:00A-12:15P STEV1003   R Salek',
  '',
  'American Multicultural Studies',
  '------------------------------------------------------------------------------',
  '2567   84        AMCS 165A  001        Humanities Learning Community   4.0 LEC GRD M       01:00P-02:50P DARW0030   STAFF',
  '',
  'Business',
  '------------------------------------------------------------------------------',
  '1000   84        BUS  399A  001        Internship                      3.0 SUP GRD         ARRANGE                  STAFF',
  '1001   84        BUS  399A  002        Internship                      4.0 SUP GRD         ARRANGE                  STAFF',
].join('\n');

test('extracts fixed-unit courses by code', () => {
  const { units } = parseSchedule(FIXTURE);
  assert.equal(units['CS 115'], 4);
  assert.equal(units['CS 454'], 4);
  assert.equal(units['CS 390'], 1); // colloquium — 1 unit, the schedule pins it
  assert.equal(units['CS 496'], 3); // SUP (research) component still captured
});

test('secondary section rows (lab/discussion, no units) do not clobber the course', () => {
  const { units } = parseSchedule(FIXTURE);
  assert.equal(units['CS 252'], 4); // from the primary row; the LAB row is skipped
});

test('course numbers with a letter suffix keep the suffix', () => {
  const { units } = parseSchedule(FIXTURE);
  assert.equal(units['AMCS 165A'], 4);
  assert.equal(units['CS 165'], undefined); // not conflated with a bare number
});

test('"***" units (not set) leaves the course out entirely', () => {
  const { units, stats } = parseSchedule(FIXTURE);
  assert.equal(units['CS 485'], undefined);
  // Two rows carry a course code but no units: the CS 252 LAB and CS 485 "***".
  assert.equal(stats.noUnitsRows, 2);
});

test('variable-unit course resolves to the rounded median of its offerings', () => {
  const { units, stats } = parseSchedule(FIXTURE);
  assert.equal(units['BUS 399A'], 4); // median of {3,4} = 3.5, rounds up to 4
  assert.equal(stats.variableCourses, 1);
});

test('department headers and rule lines are ignored', () => {
  const { stats } = parseSchedule(FIXTURE);
  // 10 course-code rows in the fixture (incl. the CS 252 lab and CS 485 ***).
  assert.equal(stats.rows, 10);
  assert.equal(stats.courses, 7); // CS 485 has no units → not a course in the table
});

test('empty / nullish input is safe', () => {
  assert.deepEqual(parseSchedule('').units, {});
  assert.deepEqual(parseSchedule(null).units, {});
});

test('normalizeCourseCode canonicalizes spacing and case', () => {
  assert.equal(normalizeCourseCode('cs', '454'), 'CS 454');
  assert.equal(normalizeCourseCode('AMCS', '165a'), 'AMCS 165A');
});
