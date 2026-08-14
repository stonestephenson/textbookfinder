// Pure parser: SSU "Schedule of Classes" plain text → { course code → units }.
// No fetch, no fs — build-course-units.mjs feeds it the extracted text; tests
// feed it fixture rows.
//
// Why the SCHEDULE and not the catalog: the schedule lists each section at the
// units it is actually offered this term, which RESOLVES variable-unit courses
// (research, colloquium, independent study) that the catalog only lists as a
// range. That is the whole reason this data source works. It is a per-SEMESTER
// grab (the offering changes every term), regenerated via the README checklist.
//
// The text layout (one row per section), from the real F26 file:
//
//   2178   84        CS   454   001  2 U   Theory of Computation     4.0 LEC GRD TR  ...
//   ^class ^req      ^subj ^num  ^sect ^GE ^title                    ^UNITS ^component
//
// Extraction rules, derived from the real file:
// - A course row carries a subject (2–5 uppercase letters), a course number
//   (digits + optional letter, e.g. "165A"), then a 3-digit section number.
// - Units is the ONLY decimal (X.Y) on the row, sitting just before the 3-letter
//   component code (LEC/DIS/LAB/ACT/SEM/SUP…). Class numbers, requisite codes,
//   times, and rooms carry no decimal point, so the decimal is unambiguous.
// - Secondary rows (a lab/discussion of the same course) repeat the code but
//   omit units — they are skipped; units come from the primary row.
// - A few courses print "***" for units (units not set); those rows carry no
//   decimal and are simply not recorded. A student holding such a course falls
//   back to the assumed-per-course default in estimate-units.js.

// Subject (2–5 uppercase) + number (digits, optional 1–2 letter suffix) + a
// 3-digit section. The section is the anchor that separates a real course code
// from incidental uppercase tokens (day codes, component codes, room prefixes).
const COURSE_RE = /\b([A-Z]{2,5})\s+(\d{1,3}[A-Z]{0,2})\s+\d{3}\b/;
// The lone decimal on a course row is the units value.
const UNITS_RE = /\b(\d{1,2}(?:\.\d)?)\s+(?:LEC|DIS|LAB|ACT|SEM|SUP|IND|FLD|WRK|CLN|TUT)\b/;

// "CS   454" / "cs 454 001" → "CS 454". The one join key, applied to both the
// schedule side (here) and the student's parsed course codes (estimate-units.js),
// so they compare identically.
export function normalizeCourseCode(subject, number) {
  return `${String(subject).toUpperCase()} ${String(number).toUpperCase()}`;
}

// Median of a list, rounding a .5 midpoint up to the nearest integer. Course
// units are integers, so this only matters for variable-unit courses offered at
// several values: it returns a representative middle (BUS 399 {3,4} → 4, COMS
// 470 {1,2,3,4} → 3), never an arbitrary first-seen section.
function medianRounded(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = (s.length - 1) / 2;
  const m = (s[Math.floor(mid)] + s[Math.ceil(mid)]) / 2;
  return Math.round(m);
}

export function parseSchedule(text) {
  const offered = new Map(); // code → [units seen across its sections]
  const stats = { rows: 0, noUnitsRows: 0 };

  for (const line of String(text ?? '').split(/\r?\n/)) {
    const course = COURSE_RE.exec(line);
    if (!course) continue;
    stats.rows += 1;

    const u = UNITS_RE.exec(line);
    if (!u) {
      stats.noUnitsRows += 1; // secondary section row, or "***" units — skip
      continue;
    }
    const value = Number(u[1]);
    if (!Number.isFinite(value) || value <= 0) continue;

    const code = normalizeCourseCode(course[1], course[2]);
    (offered.get(code) ?? offered.set(code, []).get(code)).push(value);
  }

  const units = {};
  let variableCourses = 0;
  for (const [code, values] of offered) {
    if (new Set(values).size > 1) variableCourses += 1;
    units[code] = medianRounded(values);
  }

  stats.courses = offered.size;
  stats.variableCourses = variableCourses; // resolved to the median of offerings
  return { units, stats };
}
