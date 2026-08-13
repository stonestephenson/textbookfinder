// Binds semester-config values and verified links into static copy, on any
// page that includes it. config.js stays the single source for the rate and
// the term (see README, "How to update this each semester").
import { config } from './config.js';

const fmt = (n) => `$${n.toFixed(2)}`;

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
  'opt-out': config.optOutUrl,
};
Object.entries(LINKS).forEach(([key, url]) => {
  document.querySelectorAll(`[data-link="${key}"]`).forEach((el) => el.setAttribute('href', url));
});
document.querySelectorAll('#repo-link, [data-link="repo"]').forEach((el) => {
  el.setAttribute('href', config.repoUrl);
});
