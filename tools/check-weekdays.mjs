#!/usr/bin/env node
/**
 * Checks every "Weekday D Month YYYY" in the repository against a real calendar.
 *
 * WHY THIS EXISTS. The project rules have said "Check dates against a real calendar. Weekday
 * errors have nearly gone out twice" since the start of this engagement. On Thursday
 * 17 September 2026 it nearly went out a third time: an entire day of work was
 * recorded as Friday 18 September, including a client draft telling the client a
 * certificate expired "on Sunday" when it expired on a Monday, and two drafts
 * wishing him a good weekend on a Thursday.
 *
 * **The rule did not fail. Nobody ran it.** A rule that depends on remembering to
 * apply it fails on exactly the day you are too busy to remember. So it is a
 * command now. See "Decision log", D50.
 *
 * WHAT IT DOES NOT CHECK, and this is the important limitation. It verifies that a
 * weekday matches its date. **It cannot tell you that the date itself is the wrong
 * day**, because "Friday 18 September 2026" is internally perfect and was still
 * wrong. Only an external anchor catches that. **Check today's date against
 * something outside this repository before writing it down.**
 *
 *   node tools/check-weekdays.mjs
 *
 * Exit 0 if every weekday matches, 1 if any does not.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SKIP = new Set(['node_modules', '.git', 'dist', '.next', 'out', '.terraform', '.lambda-build']);
const EXT = /\.(md|ts|tsx|mjs|js|tf|json)$/;

const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const PATTERN =
  /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/g;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walk(full);
    else if (EXT.test(name)) yield full;
  }
}

const problems = [];
let checked = 0;

for (const file of walk(ROOT)) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (!text.includes('day ')) continue;

  for (const m of text.matchAll(PATTERN)) {
    const [whole, weekday, dayStr, monthName, yearStr] = m;
    const day = Number(dayStr);
    const year = Number(yearStr);
    const month = MONTHS[monthName.toLowerCase()];

    const date = new Date(Date.UTC(year, month, day));
    // Rejects 31 September and friends, which roll over silently otherwise.
    if (date.getUTCDate() !== day || date.getUTCMonth() !== month) {
      problems.push({ file, whole, actual: 'not a real date' });
      continue;
    }

    checked += 1;
    const actual = DAYS[date.getUTCDay()];
    if (actual !== weekday) {
      const line = text.slice(0, m.index).split('\n').length;
      problems.push({ file, line, whole, actual });
    }
  }
}

if (problems.length === 0) {
  console.log(`OK. ${checked} dated weekday(s) checked, all correct.`);
  process.exit(0);
}

console.error(`${problems.length} weekday error(s), out of ${checked} checked:\n`);
for (const p of problems) {
  const where = `${relative(ROOT, p.file).split(sep).join('/')}${p.line ? `:${p.line}` : ''}`;
  console.error(`  ${where}`);
  console.error(`    "${p.whole}" is actually ${p.actual}\n`);
}
console.error('Fix these before anything client facing goes out.');
process.exit(1);
