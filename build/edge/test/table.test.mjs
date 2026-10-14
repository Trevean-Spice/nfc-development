/**
 * The canonical table, checked against the contract documents rather than
 * against itself.
 *
 * EXPECTED_MAP below is transcribed by hand from Scope, section "Tag code map",
 * and from "M1 Deliverable 3: Redirect-Serving Decision and Apex Domain
 * Routing", section 5, "The table". It is deliberately not derived from
 * redirect-table.json. A test that reads its expectations out of the file it is
 * testing cannot catch a transposed entry, which is the failure that opens
 * Caribbean Sunset on a Persian Sunrise jar, passes every smoke test, and fails
 * SOW section 6.1 on correct destination regardless of how fast it was.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTable, summarise, KNOWN_BLEND_SLUGS } from '../lib/table.mjs';
import { validate } from '../lib/validate.mjs';
import { previousTable, repointGuardProblem } from '../lib/previous.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const table = loadTable();

/** code -> [blend slug, blend name, units on physical tags] */
export const EXPECTED_MAP = {
  ps: ['persian-sunrise', 'Persian Sunrise', 250],
  cs: ['caribbean-sunset', 'Caribbean Sunset', 250],
  sr: ['silk-road', 'The Silk Road', 250],
  nm: ['north-african-night-market', 'North African Night Market', 250],
  kg: ['kyoto-garden', 'Kyoto Garden', 0]
};

test('the table holds exactly the five codes and no others', () => {
  const codes = table.entries.map((e) => e.code).sort();
  assert.deepEqual(codes, Object.keys(EXPECTED_MAP).sort());
});

test('every code maps to the blend the tag code map says it does', () => {
  for (const [code, [slug]] of Object.entries(EXPECTED_MAP)) {
    const entry = table.entries.find((e) => e.code === code);
    assert.ok(entry, `code ${code} is missing from the table`);
    assert.equal(entry.blendSlug, slug, `code ${code} points at the wrong blend`);
  }
});

test('no two codes resolve to the same blend', () => {
  const slugs = table.entries.map((e) => e.blendSlug);
  assert.equal(new Set(slugs).size, slugs.length);
});

test('every blend slug is one of the five real blends', () => {
  for (const entry of table.entries) {
    assert.ok(KNOWN_BLEND_SLUGS.includes(entry.blendSlug), `${entry.blendSlug} is not a real blend`);
  }
});

test('the redirect status is 307, not 301, 302 or 308', () => {
  assert.equal(table.redirectStatus, 307);
});

test('four codes are on physical tags and kg is reserved', () => {
  const counts = summarise(table);
  assert.equal(counts.codes, 5, 'five codes exist');
  assert.equal(counts.physicalTags, 4, 'four of them are on physical tags');
  assert.deepEqual(counts.reservedCodes, ['kg']);
  const kg = table.entries.find((e) => e.code === 'kg');
  assert.equal(kg.unitsEncoded, 0);
  assert.equal(kg.ndefUri, null, 'no tag in this production run carries kg');
});

test('units encoded sum to the 1,000 tags shipped on 24 July 2026', () => {
  assert.equal(summarise(table).unitsEncoded, 1000);
  for (const [code, [, , units]] of Object.entries(EXPECTED_MAP)) {
    const entry = table.entries.find((e) => e.code === code);
    assert.equal(entry.unitsEncoded, units, `code ${code} has the wrong unit count`);
  }
});

test('the code appears consistently in requestPath, ndefUri and targetPath', () => {
  for (const entry of table.entries) {
    assert.equal(entry.requestPath, `/t/${entry.code}`);
    if (entry.ndefUri !== null) {
      assert.equal(entry.ndefUri, `https://treveanspice.com/t/${entry.code}`);
    }
    assert.equal(entry.targetPath, `/blend.html?blend=${entry.blendSlug}&via=nfc`);
  }
});

// ---------------------------------------------------------------------------
// The QR route, from "M1 Deliverable 14: QR attribution", section 4.
//
// EXPECTED_QR below is transcribed by hand from that section's table, for the
// same reason EXPECTED_MAP is: this is the string that goes into artwork nobody
// can recall once it is printed on 250 cartons.
// ---------------------------------------------------------------------------

export const EXPECTED_QR = {
  ps: 'https://treveanspice.com/q/ps',
  cs: 'https://treveanspice.com/q/cs',
  sr: 'https://treveanspice.com/q/sr',
  nm: 'https://treveanspice.com/q/nm',
  kg: 'https://treveanspice.com/q/kg'
};

test('every code carries the QR URL the artwork must encode', () => {
  for (const [code, url] of Object.entries(EXPECTED_QR)) {
    const entry = table.entries.find((e) => e.code === code);
    assert.equal(entry.qrUrl, url, `code ${code} would be printed pointing somewhere else`);
    assert.equal(entry.qrRequestPath, `/q/${code}`);
  }
});

test('the QR target is the tap target with via=qr and is otherwise identical', () => {
  for (const entry of table.entries) {
    assert.equal(entry.qrTargetPath, `/blend.html?blend=${entry.blendSlug}&via=qr`);
    assert.equal(
      entry.qrTargetPath,
      entry.targetPath.replace('via=nfc', 'via=qr'),
      'the two routes must differ in the via value and in nothing else'
    );
  }
});

test('the QR route is served for all five codes, including the reserved one', () => {
  // ndefUri is null for kg because no tag in this run carries it. qrUrl is not,
  // because a QR is print artwork rather than silicon and is not gated on the
  // SO4731 run. Whether Kyoto Garden packs are printed at all is Trevean's.
  const kg = table.entries.find((e) => e.code === 'kg');
  assert.equal(kg.ndefUri, null);
  assert.equal(kg.qrUrl, 'https://treveanspice.com/q/kg');
});

test('no code QR resolves to another blend page', () => {
  for (const entry of table.entries) {
    for (const other of table.entries) {
      if (other.blendSlug === entry.blendSlug) continue;
      assert.ok(!entry.qrTargetPath.includes(`blend=${other.blendSlug}`));
    }
  }
});

test('validator rejects a QR target that points at a different blend than the tap', () => {
  const bad = mutate((t) => {
    t.entries.find((e) => e.code === 'ps').qrTargetPath = '/blend.html?blend=silk-road&via=qr';
  });
  assert.ok(validate(bad).errors.some((e) => e.includes('not the same destination')));
});

test('validator rejects a QR target still carrying via=nfc', () => {
  // The exact state this replaced: every compiled target said nfc, so every QR
  // scan was counted as a tap and the split in Scope, in scope, item 6 could not
  // be produced from the data at all.
  const bad = mutate((t) => {
    const ps = t.entries.find((e) => e.code === 'ps');
    ps.qrTargetPath = ps.targetPath;
  });
  assert.ok(validate(bad).errors.some((e) => e.includes('via=qr')));
});

test('validator rejects a missing QR target', () => {
  const bad = mutate((t) => {
    delete t.entries.find((e) => e.code === 'cs').qrTargetPath;
  });
  assert.ok(validate(bad).errors.some((e) => e.includes('no qrTargetPath')));
});

test('validator rejects a qrUrl that does not match its own code', () => {
  const bad = mutate((t) => {
    t.entries.find((e) => e.code === 'nm').qrUrl = 'https://treveanspice.com/q/mn';
  });
  assert.ok(validate(bad).errors.some((e) => e.includes('printed')));
});

test('validator rejects a qrUrl on a different origin than the table declares', () => {
  const bad = mutate((t) => {
    t.entries.find((e) => e.code === 'sr').qrUrl = 'https://trevean.co/q/sr';
  });
  assert.ok(validate(bad).errors.length > 0);
});

test('validator rejects a qrRequestPath that is not /q/{code}', () => {
  const bad = mutate((t) => {
    t.entries.find((e) => e.code === 'ps').qrRequestPath = '/t/ps';
  });
  assert.ok(validate(bad).errors.some((e) => e.includes('qrRequestPath')));
});

test('the tap route is byte for byte what the shipped tags carry', () => {
  // The 1,000 tags were encoded on 24 July 2026 and cannot be re-encoded. The
  // QR work must not have moved any of this, so it is asserted against strings
  // transcribed from Scope, section "Tag code map", not against the file.
  for (const [code, [slug]] of Object.entries(EXPECTED_MAP)) {
    const entry = table.entries.find((e) => e.code === code);
    assert.equal(entry.requestPath, `/t/${code}`);
    assert.equal(entry.targetPath, `/blend.html?blend=${slug}&via=nfc`);
    if (entry.status === 'encoded') {
      assert.equal(entry.ndefUri, `https://treveanspice.com/t/${code}`);
    }
  }
});

test('a half transposed pair is caught by the QR pair check', () => {
  // The whole transposition below is invisible to any self referential check.
  // A half transposition, someone moving targetPath and forgetting qrTargetPath,
  // is not, and it is the likelier mistake now that a row carries two targets.
  const half = mutate((t) => {
    const ps = t.entries.find((e) => e.code === 'ps');
    const cs = t.entries.find((e) => e.code === 'cs');
    [ps.blendSlug, cs.blendSlug] = [cs.blendSlug, ps.blendSlug];
    [ps.targetPath, cs.targetPath] = [cs.targetPath, ps.targetPath];
  });
  assert.ok(validate(half).errors.some((e) => e.includes('not the same destination')));
});

test('the repoint check catches a QR only repoint against the deployed table', () => {
  const qrOnly = mutate((t) => {
    const cs = t.entries.find((e) => e.code === 'cs');
    cs.qrTargetPath = '/blend.html?blend=caribbean-sunset&via=qr&promo=1';
  });
  const { errors } = validate(qrOnly, { previous: table });
  assert.ok(errors.some((e) => e.includes('qrTargetPath')), 'printed cartons are no more recallable than encoded tags');
});

test('every target is a relative same origin path', () => {
  for (const entry of table.entries) {
    assert.ok(entry.targetPath.startsWith('/'), `${entry.code} target is not relative`);
    assert.ok(!entry.targetPath.startsWith('//'), `${entry.code} target is protocol relative`);
    assert.ok(!entry.targetPath.includes('://'), `${entry.code} target is absolute`);
  }
});

test('writeProtected is true on the encoded run and null on the reserved code', () => {
  // CORRECTED Friday 11 September 2026, and the client contradicted himself, so the
  // evidence is set out rather than the latest answer simply taken.
  //
  // Wednesday 19 August 2026, D18, closing Q4. Dan: "There are no write protections on
  // the tags." That is what this test asserted until today.
  //
  // Tuesday 8 September 2026, his own encoding instruction to the supplier, order SO4731:
  // "after encoding, please write-protect the NDEF memory area (the ST25TV area password
  // config) so the URL can't be overwritten in the field."
  //
  // Friday 11 September 2026, asked directly with the box in front of him: "yes the tags
  // are locked per the supplier."
  //
  // Two of the three say locked, and the two that say locked are the specific ones: a
  // written instruction to the manufacturer and a check against the physical stock. The
  // August answer was given from memory about a run that had already shipped. So the table
  // records true.
  //
  // WHAT THIS COSTS, and it is the reason this matters beyond a boolean: a locked NDEF
  // area cannot be rewritten without the ST25TV area password. If those 1,000 tags ever
  // need to point somewhere else, whoever holds that password is the only person who can
  // do it. See modules/data/variables.tf, tag_password_holder, which is still nominated to
  // nobody.
  for (const entry of table.entries) {
    if (entry.status === 'encoded') {
      assert.equal(entry.writeProtected, true, `${entry.code} should record the SO4731 answer`);
    } else {
      assert.equal(entry.writeProtected, null, `${entry.code} has no tag and so has no protection state`);
    }
  }
});

test('the shipped table passes every validator check', () => {
  const { errors } = validate(table);
  assert.deepEqual(errors, []);
});

// The validator is only worth having if it fails on the things it claims to
// catch. Each case below is a real edit somebody could plausibly make.

// A function declaration rather than a const, so it is in scope for the QR
// cases above as well as the cases below.
function mutate(fn) {
  const copy = structuredClone(table);
  fn(copy);
  return copy;
}

const transposed = mutate((t) => {
  const ps = t.entries.find((e) => e.code === 'ps');
  const cs = t.entries.find((e) => e.code === 'cs');
  [ps.blendSlug, cs.blendSlug] = [cs.blendSlug, ps.blendSlug];
  [ps.blendName, cs.blendName] = [cs.blendName, ps.blendName];
  [ps.targetPath, cs.targetPath] = [cs.targetPath, ps.targetPath];
  // qrTargetPath moves with the pair. Without this line the fixture is a half
  // transposition rather than a whole one, and the pair check below catches it,
  // which would make the point of the next test disappear.
  [ps.qrTargetPath, cs.qrTargetPath] = [cs.qrTargetPath, ps.qrTargetPath];
});

test('a transposed pair is internally consistent, so the validator alone cannot see it', () => {
  // Stated as a test rather than left as a comment, because it is the limit of
  // what any self referential check can do. Every row still repeats its own code
  // three times and still carries blend={its own blendSlug}, so checks 1 to 6
  // all pass. Two things catch it: the hand transcribed expectation above, and
  // the repoint check against the previously deployed table below.
  assert.deepEqual(validate(transposed).errors, []);
});

test('the hand transcribed tag code map catches a transposed pair', () => {
  const ps = transposed.entries.find((e) => e.code === 'ps');
  assert.notEqual(ps.blendSlug, EXPECTED_MAP.ps[0], 'the fixture really is transposed');
  let caught = false;
  try {
    for (const [code, [slug]] of Object.entries(EXPECTED_MAP)) {
      assert.equal(transposed.entries.find((e) => e.code === code).blendSlug, slug);
    }
  } catch {
    caught = true;
  }
  assert.ok(caught, 'a customer tapping Persian Sunrise would have read about Caribbean Sunset');
});

test('the repoint check catches a transposed pair against the deployed table', () => {
  const { errors } = validate(transposed, { previous: table });
  assert.ok(errors.some((e) => e.includes('repointed')));
});

test('validator rejects a one character typo in a target slug', () => {
  const bad = mutate((t) => {
    const entry = t.entries.find((e) => e.code === 'sr');
    entry.targetPath = '/blend.html?blend=silk-raod&via=nfc';
  });
  assert.ok(validate(bad).errors.length > 0);
});

test('validator rejects a target missing via=nfc', () => {
  const bad = mutate((t) => {
    t.entries[0].targetPath = '/blend.html?blend=persian-sunrise';
  });
  assert.ok(validate(bad).errors.length > 0);
});

test('validator rejects a cross origin target', () => {
  const bad = mutate((t) => {
    t.entries[0].targetPath = 'https://app.treveanspice.com/blend.html?blend=persian-sunrise&via=nfc';
  });
  assert.ok(validate(bad).errors.length > 0, 'a cross origin target costs 450 ms and fails the budget');
});

test('validator rejects a 301', () => {
  const bad = mutate((t) => {
    t.redirectStatus = 301;
  });
  assert.ok(validate(bad).errors.some((e) => e.includes('307')));
});

test('validator rejects an ndefUri that does not match its own code', () => {
  const bad = mutate((t) => {
    t.entries.find((e) => e.code === 'nm').ndefUri = 'https://treveanspice.com/t/mn';
  });
  assert.ok(validate(bad).errors.length > 0);
});

test('validator rejects unit counts that do not add up to 1,000', () => {
  const bad = mutate((t) => {
    t.entries.find((e) => e.code === 'ps').unitsEncoded = 240;
  });
  assert.ok(validate(bad).errors.some((e) => e.includes('1000')));
});

test('validator rejects two codes pointing at the same blend', () => {
  const bad = mutate((t) => {
    const nm = t.entries.find((e) => e.code === 'nm');
    nm.blendSlug = 'silk-road';
    nm.targetPath = '/blend.html?blend=silk-road&via=nfc';
  });
  assert.ok(validate(bad).errors.some((e) => e.includes('unreachable')));
});

test('validator rejects a silent repoint against the previous table', () => {
  const repointed = mutate((t) => {
    const cs = t.entries.find((e) => e.code === 'cs');
    cs.blendSlug = 'kyoto-garden';
    cs.targetPath = '/blend.html?blend=kyoto-garden&via=nfc';
    cs.qrTargetPath = '/blend.html?blend=kyoto-garden&via=qr';
    const kg = t.entries.find((e) => e.code === 'kg');
    kg.blendSlug = 'caribbean-sunset';
    kg.targetPath = '/blend.html?blend=caribbean-sunset&via=nfc';
    kg.qrTargetPath = '/blend.html?blend=caribbean-sunset&via=qr';
  });
  const { errors } = validate(repointed, { previous: table });
  assert.ok(errors.some((e) => e.includes('repointed')));
});

test('validator allows a repoint that says so and bumps the version', () => {
  const repointed = mutate((t) => {
    t.allowRepoint = true;
    t.version = table.version + 1;
    const cs = t.entries.find((e) => e.code === 'cs');
    cs.blendSlug = 'kyoto-garden';
    cs.targetPath = '/blend.html?blend=kyoto-garden&via=nfc';
    cs.qrTargetPath = '/blend.html?blend=kyoto-garden&via=qr';
    const kg = t.entries.find((e) => e.code === 'kg');
    kg.blendSlug = 'caribbean-sunset';
    kg.targetPath = '/blend.html?blend=caribbean-sunset&via=nfc';
    kg.qrTargetPath = '/blend.html?blend=caribbean-sunset&via=qr';
  });
  const { errors, warnings } = validate(repointed, { previous: table });
  assert.deepEqual(errors, [], 'repointing is the whole reason the redirect exists');
  assert.ok(warnings.some((w) => w.includes('repointed')), 'and it is still reported');
});

test('validator rejects an allowed repoint that forgets to bump the version', () => {
  const repointed = mutate((t) => {
    t.allowRepoint = true;
    const cs = t.entries.find((e) => e.code === 'cs');
    cs.blendSlug = 'kyoto-garden';
    cs.targetPath = '/blend.html?blend=kyoto-garden&via=nfc';
    cs.qrTargetPath = '/blend.html?blend=kyoto-garden&via=qr';
    const kg = t.entries.find((e) => e.code === 'kg');
    kg.blendSlug = 'caribbean-sunset';
    kg.targetPath = '/blend.html?blend=caribbean-sunset&via=nfc';
    kg.qrTargetPath = '/blend.html?blend=caribbean-sunset&via=qr';
  });
  assert.ok(validate(repointed, { previous: table }).errors.some((e) => e.includes('version')));
});

test('validator rejects removing a code that tags already carry', () => {
  const removed = mutate((t) => {
    t.entries = t.entries.filter((e) => e.code !== 'sr');
  });
  const { errors } = validate(removed, { previous: table });
  assert.ok(errors.some((e) => e.includes('removed')), '250 jars would start returning 404');
});

/* -------------------------------------------------------------------------- */
/* The repoint guard, and whether it compared anything at all                  */
/* -------------------------------------------------------------------------- */

/**
 * The guard is what stands between a one line edit and 1,000 shipped tags resolving
 * somewhere else. It defaulted to comparing the table against HEAD, which in a CI checkout
 * is the working tree, so it compared the table with itself, reported "compared against
 * HEAD" and passed by construction. These tests run it against a real throwaway git
 * repository rather than against a description of one.
 */

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'edge-repoint-'));
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
    return result.stdout;
  };
  git('init', '--initial-branch=main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  return { dir, git };
}

test('the repoint guard reports a comparison against the checked out commit as vacuous', () => {
  const { dir, git } = gitRepo();
  const tablePath = join(dir, 'redirect-table.json');
  writeFileSync(tablePath, `${JSON.stringify(table, null, 2)}\n`);
  git('add', '.');
  git('commit', '-m', 'the table');

  // Exactly the CI situation: base ref is HEAD and the working tree is that commit.
  const clean = previousTable('HEAD', { tablePath, cwd: dir });
  assert.equal(clean.compared, true, 'a table was read out of git');
  assert.equal(clean.vacuous, true, 'and it is the same table, so nothing was compared');
  assert.match(repointGuardProblem(clean) ?? '', /ran vacuously/);
  // The escape hatch for a first commit must not cover this one.
  assert.match(repointGuardProblem(clean, { allowFirstCommit: true }) ?? '', /ran vacuously/);

  // The bench situation: an uncommitted repoint against HEAD. Not vacuous, and the guard
  // catches the repoint itself.
  const repointed = JSON.parse(JSON.stringify(table));
  repointed.entries[0].targetPath = '/blend.html?blend=caribbean-sunset&via=nfc';
  repointed.entries[0].blendSlug = 'caribbean-sunset';
  writeFileSync(tablePath, `${JSON.stringify(repointed, null, 2)}\n`);

  const dirty = previousTable('HEAD', { tablePath, cwd: dir });
  assert.equal(dirty.compared, true);
  assert.equal(dirty.vacuous, false, 'an uncommitted edit against HEAD is a real comparison');
  assert.equal(repointGuardProblem(dirty), null);
  assert.ok(validate(repointed, { previous: dirty.table }).errors.some((e) => /repointed/.test(e)));
});

test('the repoint guard reports an absent baseline as not having run, and says so in words', () => {
  const { dir } = gitRepo();
  const tablePath = join(dir, 'redirect-table.json');
  writeFileSync(tablePath, `${JSON.stringify(table, null, 2)}\n`);
  // Written but never committed, which is the state build/ is in today: git show returns
  // nothing and there is no baseline at all.
  const absent = previousTable('HEAD', { tablePath, cwd: dir });
  assert.equal(absent.compared, false);
  assert.equal(absent.vacuous, false);
  assert.equal(absent.table, null);
  assert.match(repointGuardProblem(absent) ?? '', /did not run/);
  // One deliberate, written down exception, the same shape as allowRepoint.
  assert.equal(repointGuardProblem(absent, { allowFirstCommit: true }), null);
});

test('the repoint guard compares against a named base ref rather than always against HEAD', () => {
  const { dir, git } = gitRepo();
  const tablePath = join(dir, 'redirect-table.json');
  writeFileSync(tablePath, `${JSON.stringify(table, null, 2)}\n`);
  git('add', '.');
  git('commit', '-m', 'the table');
  const baseCommit = git('rev-parse', 'HEAD').trim();

  const repointed = JSON.parse(JSON.stringify(table));
  repointed.entries[0].targetPath = '/blend.html?blend=caribbean-sunset&via=nfc';
  repointed.entries[0].blendSlug = 'caribbean-sunset';
  writeFileSync(tablePath, `${JSON.stringify(repointed, null, 2)}\n`);
  git('add', '.');
  git('commit', '-m', 'the repoint');

  // Against HEAD the repointed table is compared with itself and passes. Against the
  // commit it will merge on top of, the repoint is caught. Same code, same repository, and
  // the only difference is the base ref the workflow now sets.
  const vsHead = previousTable('HEAD', { tablePath, cwd: dir });
  assert.equal(vsHead.vacuous, true);
  assert.equal(
    validate(repointed, { previous: vsHead.table }).errors.some((e) => /repointed/.test(e)),
    false,
    'compared with itself, a repoint is invisible to check 5',
  );

  const vsBase = previousTable(baseCommit, { tablePath, cwd: dir });
  assert.equal(vsBase.compared, true);
  assert.equal(vsBase.vacuous, false);
  assert.ok(validate(repointed, { previous: vsBase.table }).errors.some((e) => /repointed/.test(e)));
});
