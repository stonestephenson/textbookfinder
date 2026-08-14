// Pure: the student's parsed course list + the course→units table → an estimated
// total unit load, used only to seed the units field (the user always overrides).
// No fetch, no DOM. app.js gates WHEN this is applied (see below); this module
// just computes the number.
//
// Why this is a seed, not an assertion: the schedule tells us each course's
// offered units, but not which section/units a student picked for a truly
// variable course, and the capture can omit courses. So this is a better default
// than a flat 15 — nothing more. app.js only applies it when the capture looked
// complete (listCutOff false) and the table matches the deployed term, and the
// value stays editable on the confirm screen.

// Student-side course code → the join key used in course-units.js.
// "CS 454 001" / "cs454" / "MATH 161-02" → "CS 454" / "CS454"→"CS 454" / "MATH 161".
// The section number (and anything after the course number) is dropped.
export function normalizeStudentCourseCode(raw) {
  const m = /([A-Za-z]{2,5})\s*(\d{1,3}[A-Za-z]{0,2})/.exec(String(raw ?? ''));
  if (!m) return null;
  return `${m[1].toUpperCase()} ${m[2].toUpperCase()}`;
}

// courses: array of { code, title } (or bare code strings) — the registered
// courses read from the capture. table: the courseUnits map.
// Returns { units, matched, assumed, courseCount } or null when there is no
// usable course code to work from.
export function estimateUnits(courses, table, opts = {}) {
  const assumedUnitsPerCourse = opts.assumedUnitsPerCourse ?? 3;
  const maxUnits = opts.maxUnits ?? 24;
  const t = table ?? {};

  const codes = (Array.isArray(courses) ? courses : [])
    .map((c) => normalizeStudentCourseCode(typeof c === 'string' ? c : c?.code))
    .filter(Boolean);
  // Same course listed twice in a capture (e.g. a lecture + its lab under one
  // course code) must count once toward the unit load.
  const unique = [...new Set(codes)];
  if (unique.length === 0) return null;

  let units = 0;
  let matched = 0;
  let assumed = 0;
  for (const code of unique) {
    if (Object.prototype.hasOwnProperty.call(t, code)) {
      units += t[code];
      matched += 1;
    } else {
      units += assumedUnitsPerCourse; // rare: a code the schedule table didn't carry
      assumed += 1;
    }
  }

  return {
    units: Math.min(Math.round(units), maxUnits),
    matched,
    assumed,
    courseCount: unique.length,
  };
}
