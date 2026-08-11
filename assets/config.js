// ── SEMESTER CONFIG ──────────────────────────────────────────────────────────
// This is the ONLY file that needs editing each semester. See README.md
// ("How to update this each semester") for the checklist.
//
// RULE: every number and date in this file must have a source you could show
// a skeptic. When you update a value, update its entry in CLAIMS.md too.
// If you can't source a value, leave it null — the UI degrades honestly.

export const config = {
  // The term this deployment is configured for. Shown throughout the UI.
  term: 'Fall 2026',

  // Student-facing Seawolf Bundle price per unit, in dollars.
  // Source: SSU's official bundle site, seawolfbundle.sonoma.edu ("$21.00 per
  // credit hour", verified 2026-08-05); independently confirmed in writing by
  // bookstore staff (July 2026). See CLAIMS.md #1.
  pricePerUnit: 21.0,

  // "It's close" band for the verdict, in dollars: if bundle cost and
  // buy-it-yourself total are within this of each other, the tool refuses to
  // call a winner. Default = one unit's bundle price. See METHODOLOGY.md.
  closeThreshold: 21.0,

  // Verified opt-out deadline for `term`, as 'YYYY-MM-DD', or null.
  // While null the UI says "the add/drop deadline" and tells students to
  // check their bookstore portal for the exact date.
  // NEVER enter a date you haven't verified for the current term, and record
  // where it came from in optOutDeadlineSource + CLAIMS.md.
  optOutDeadline: '2026-09-04',
  optOutDeadlineSource: 'seawolfbundle.sonoma.edu (Fall 2026 opt-out window closes Sept 4, 2026) and registrar.sonoma.edu/academic-calendar (Fall 2026 add/drop deadline Sept 4, 2026); both verified 2026-08-05',

  // Official outbound links, verified 2026-08-05. Re-verify each term — see
  // README. courseMaterialsUrl is the bookstore's "see your registered
  // courses" entry (routes through SSU's own sign-in, never this site).
  bookstoreUrl: 'https://sonoma.bncollege.com/',
  courseMaterialsUrl: 'https://sso.bncollege.com/bes-sp/bessso/saml/sonomaedu/aip/logon',
  courseFinderUrl: 'https://sonoma.bncollege.com/course-material/course-finder',
  optOutUrl: 'https://sso.bncollege.com/bes-sp/bessso/saml/sonomaedu/fdcopt/logon',
  bundleInfoUrl: 'https://seawolfbundle.sonoma.edu/',

  // Endpoint that parses screenshots (see api/parse.js). Set to null to
  // disable screenshot parsing entirely — pasted text and manual entry keep
  // working, entirely in the browser.
  parseEndpoint: '/api/parse',

  // Endpoint that fetches real purchase offers by ISBN (see api/price.js;
  // source and selection policy in METHODOLOGY.md). Set to null to disable —
  // price fields stay manual and the search links below still work. The
  // request carries ISBNs only, never anything else from the user's cart.
  priceEndpoint: '/api/price',

  // Sanity bound for the units input.
  maxUnits: 24,

  // Case-insensitive patterns that mark an item as a single-use access code /
  // courseware (can't be bought used). Extend as new platforms appear.
  accessCodePatterns: [
    'MyLab',
    'Mastering', // Pearson Mastering Biology/Chemistry/Physics…
    'MindTap',
    'WebAssign',
    'Cengage Unlimited',
    'Connect', // McGraw Hill
    'ALEKS',
    'Revel',
    'Achieve', // Macmillan
    'LaunchPad',
    'zyBooks',
    'Top Hat',
    'Sapling',
    'Knewton',
    'Hawkes',
    'access code',
    'access card',
    'courseware',
  ],

  // Where "find the real price" links point. {q} is replaced with the ISBN
  // when known, otherwise the title. The tool links out and shows YOUR
  // entered price — it never asserts prices itself (METHODOLOGY.md).
  retailers: [
    { name: 'Amazon', searchUrl: 'https://www.amazon.com/s?k={q}' },
    { name: 'AbeBooks', searchUrl: 'https://www.abebooks.com/servlet/SearchResults?kn={q}' },
    { name: 'eBay', searchUrl: 'https://www.ebay.com/sch/i.html?_nkw={q}' },
  ],

  // Repository, for the footer. The two doc links point at GitHub's rendered
  // views because most static hosts serve raw .md as plain text.
  repoUrl: 'https://github.com/stonestephenson/textbookfinder',
  methodologyUrl: 'https://github.com/stonestephenson/textbookfinder/blob/main/METHODOLOGY.md',
  claimsUrl: 'https://github.com/stonestephenson/textbookfinder/blob/main/CLAIMS.md',
};
