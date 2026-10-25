/**
 * The batch workflow: the 500 unit pilot run, its journal, its resumption and its
 * refusal to skip anything silently.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runBatch, type BatchEvent } from '../src/workflow/batch.js';
import { readJournal, resumeState, verifyRecordDigest } from '../src/workflow/journal.js';
import { RedirectTable } from '../src/table/redirect-table.js';
import { SimulatorTransport, type SimulatorFaultKind } from '../src/transport/simulator.js';
import { RecordingTransport } from '../src/transport/transport.js';
import { TagPassword } from '../src/chip/password.js';
import { isChipError } from '../src/chip/errors.js';

const table = RedirectTable.load();

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'chip-cli-batch-'));
}

function base(journalPath: string, overrides: Record<string, unknown> = {}) {
  return {
    table,
    code: 'ps',
    count: 5,
    journalPath,
    transport: new SimulatorTransport(),
    dryRun: false,
    protect: false,
    toolVersion: 'test',
    operator: 'test-operator',
    attemptsPerUnit: 1,
    ...overrides,
  } as Parameters<typeof runBatch>[0];
}

test('a clean batch completes and journals one record per unit', async () => {
  const path = join(scratch(), 'run.jsonl');
  const summary = await runBatch(base(path, { count: 12 }));

  assert.equal(summary.complete, true);
  assert.equal(summary.succeeded.length, 12);
  assert.equal(summary.failed.length, 0);
  assert.equal(summary.notAttempted.length, 0);

  const journal = readJournal(path);
  assert.equal(journal.units.length, 12);
  assert.equal(journal.header.code, 'ps');
  assert.equal(journal.header.uri, 'https://treveanspice.com/t/ps');
  assert.equal(journal.header.tableDigest, table.digest);
  assert.equal(journal.ends.length, 1);
  assert.equal(journal.ends[0]?.reason, 'completed');

  for (const unit of journal.units) {
    assert.equal(unit.outcome, 'verified');
    assert.equal(unit.uri, 'https://treveanspice.com/t/ps');
    assert.ok(unit.readBackHex !== null && unit.readBackHex.length > 0);
    assert.ok(unit.uid !== null, 'the record has to say which tag it was');
    assert.equal(verifyRecordDigest(unit), true, 'each record must carry a digest of itself');
  }
});

test('every sequence number appears in the summary exactly once, and nothing is skipped', async () => {
  const path = join(scratch(), 'run.jsonl');
  const faults: Record<number, SimulatorFaultKind> = { 2: 'write-fail', 5: 'tag-absent', 9: 'readback-corrupt' };
  const summary = await runBatch(base(path, { count: 10, transport: new SimulatorTransport({ faults }) }));

  assert.equal(summary.outcomeBySeq.size, 10);
  for (let seq = 1; seq <= 10; seq += 1) {
    assert.ok(summary.outcomeBySeq.has(seq), `unit ${seq} must have an outcome`);
  }
  assert.deepEqual(summary.failed, [2, 5, 9]);
  assert.equal(summary.succeeded.length, 7);
  assert.equal(summary.succeeded.length + summary.failed.length + summary.notAttempted.length, 10);
  assert.equal(summary.complete, false, 'a run with failures is not complete');
});

test('a failed unit records the reason and the remedy, and does not report a URL as written', async () => {
  const path = join(scratch(), 'run.jsonl');
  await runBatch(base(path, { count: 3, transport: new SimulatorTransport({ faults: { 2: 'readback-corrupt' } }) }));

  const journal = readJournal(path);
  const failed = journal.units.find((u) => u.outcome === 'failed');
  assert.ok(failed !== undefined);
  assert.equal(failed.seq, 2);
  assert.equal(failed.error?.code, 'READBACK_MISMATCH');
  assert.ok((failed.error?.remedy.length ?? 0) > 10);
  assert.equal(failed.readBackHex, null);
  assert.equal(failed.verifiedAt, null);
});

test('an interrupted run resumes and does exactly the units that were left', async () => {
  const dir = scratch();
  const path = join(dir, 'run.jsonl');

  let done = 0;
  const first = await runBatch(
    base(path, {
      count: 20,
      shouldStop: () => done >= 7,
      onEvent: (event: BatchEvent) => {
        if (event.type === 'unit-done') done += 1;
      },
    }),
  );

  assert.equal(first.interrupted, true);
  assert.equal(first.succeeded.length, 7);
  assert.equal(first.notAttempted.length, 13);
  assert.equal(first.complete, false);

  const second = await runBatch(base(path, { count: 20 }));
  assert.equal(second.complete, true);
  assert.equal(second.succeeded.length, 20);
  assert.equal(second.runId, first.runId, 'a resumed run keeps its identity');

  const journal = readJournal(path);
  const seqs = journal.units.map((u) => u.seq).sort((a, b) => a - b);
  assert.deepEqual(seqs, Array.from({ length: 20 }, (_, i) => i + 1), 'every unit written once, none twice, none missed');
});

test('a resumed run retries the units that failed rather than counting them done', async () => {
  const dir = scratch();
  const path = join(dir, 'run.jsonl');

  const first = await runBatch(base(path, { count: 6, transport: new SimulatorTransport({ faults: { 3: 'write-fail' } }) }));
  assert.deepEqual(first.failed, [3]);

  const state = resumeState(readJournal(path), 6);
  assert.deepEqual([...state.remaining], [3]);
  assert.deepEqual([...state.previouslyFailed], [3]);

  const second = await runBatch(base(path, { count: 6 }));
  assert.equal(second.complete, true);

  const journal = readJournal(path);
  const attemptsForThree = journal.units.filter((u) => u.seq === 3);
  assert.equal(attemptsForThree.length, 2, 'the failure and the retry are both on the record');
  assert.equal(attemptsForThree[0]?.outcome, 'failed');
  assert.equal(attemptsForThree[1]?.outcome, 'verified');
  assert.equal(attemptsForThree[1]?.attempt, 2, 'the attempt counter continues across runs');
});

test('resuming a journal with a different code is refused rather than merged', async () => {
  const path = join(scratch(), 'run.jsonl');
  await runBatch(base(path, { count: 2 }));
  await assert.rejects(
    () => runBatch(base(path, { code: 'cs', count: 2 })),
    (error: unknown) => isChipError(error) && error.code === 'JOURNAL_MISMATCH' && /code/.test(error.message),
  );
});

test('resuming a journal with a different target count is refused', async () => {
  const path = join(scratch(), 'run.jsonl');
  await runBatch(base(path, { count: 2 }));
  await assert.rejects(
    () => runBatch(base(path, { count: 3 })),
    (error: unknown) => isChipError(error) && error.code === 'JOURNAL_MISMATCH',
  );
});

test('resuming a journal written against a different redirect table is refused', async () => {
  const path = join(scratch(), 'run.jsonl');
  await runBatch(base(path, { count: 2 }));

  const altered = RedirectTable.parse(
    JSON.stringify({
      version: 99,
      origin: 'https://treveanspice.com',
      entries: [
        {
          code: 'ps',
          blendSlug: 'persian-sunrise',
          blendName: 'Persian Sunrise',
          requestPath: '/t/ps',
          ndefUri: 'https://treveanspice.com/t/ps',
          status: 'encoded',
          unitsEncoded: 250,
          chipPartNumber: 'ST25TV02KC',
        },
      ],
    }),
    'altered',
  );

  await assert.rejects(
    () => runBatch(base(path, { count: 2, table: altered })),
    (error: unknown) => isChipError(error) && error.code === 'JOURNAL_MISMATCH' && /table digest/.test(error.message),
  );
});

test('a journal whose last line was cut off mid write is recovered, not condemned', async () => {
  const path = join(scratch(), 'run.jsonl');
  await runBatch(base(path, { count: 4 }));

  // What a power cut during the fsync would leave behind.
  appendFileSync(path, '{"kind":"unit","seq":5,"attem');

  const journal = readJournal(path);
  assert.equal(journal.truncatedTail, true);
  assert.equal(journal.units.length, 4);
});

test('the batch stops after too many failures rather than grinding through a broken setup', async () => {
  const path = join(scratch(), 'run.jsonl');
  const faults: Record<number, SimulatorFaultKind> = {};
  for (let i = 1; i <= 10; i += 1) faults[i] = 'write-fail';

  const summary = await runBatch(base(path, { count: 30, maxFailures: 3, transport: new SimulatorTransport({ faults }) }));
  assert.equal(summary.aborted, true);
  assert.equal(summary.failed.length, 3);
  assert.ok(summary.notAttempted.length > 0);
  assert.equal(summary.complete, false);
  assert.equal(readJournal(path).ends[0]?.reason, 'aborted');
});

test('a unit is retried before it is recorded failed when attempts allow it', async () => {
  const path = join(scratch(), 'run.jsonl');
  const summary = await runBatch(
    base(path, { count: 3, attemptsPerUnit: 2, transport: new SimulatorTransport({ faults: { 2: 'write-fail' } }) }),
  );
  assert.deepEqual(summary.failed, [2]);
  const attempts = readJournal(path).units.filter((u) => u.seq === 2);
  assert.equal(attempts.length, 2, 'both attempts are on the record, neither is hidden');
});

test('a protected batch records the password fingerprint and never the password', async () => {
  const path = join(scratch(), 'run.jsonl');
  const password = TagPassword.fromHex('0f1e2d3c4b5a6978', 'new');
  const summary = await runBatch(
    base(path, {
      count: 3,
      protect: true,
      currentPassword: TagPassword.factoryDefault(),
      newPassword: password,
    }),
  );

  assert.equal(summary.complete, true);
  const raw = readFileSync(path, 'utf8');
  assert.ok(!raw.includes('0f1e2d3c4b5a6978'), 'the password must never reach the journal');
  assert.ok(raw.includes(password.fingerprint()), 'the fingerprint must, so a run can be traced to a key');

  const journal = readJournal(path);
  assert.equal(journal.header.passwordFingerprint, password.fingerprint());
  for (const unit of journal.units) {
    assert.equal(unit.outcome, 'protected');
    assert.equal(unit.protection?.applied, true);
    assert.equal(unit.protection?.refusalProven, true);
    assert.equal(unit.protection?.passwordFingerprint, password.fingerprint());
  }
});

test('protection without a password is refused before a single tag is touched', async () => {
  const path = join(scratch(), 'run.jsonl');
  const transport = new RecordingTransport(new SimulatorTransport());
  await assert.rejects(
    () => runBatch(base(path, { count: 3, protect: true, transport })),
    (error: unknown) => isChipError(error) && error.code === 'PASSWORD_MISSING',
  );
  assert.equal(transport.countOf('waitForTag'), 0);
});

test('a code that must not be written is refused before the journal is created', async () => {
  const path = join(scratch(), 'run.jsonl');
  await assert.rejects(
    () => runBatch(base(path, { code: 'kg', count: 3 })),
    (error: unknown) => isChipError(error) && error.code === 'CODE_NOT_ENCODABLE',
  );
  assert.throws(() => readFileSync(path, 'utf8'), 'no journal should exist for a run that was refused');
});

/* -------------------------------------------------------------------------- */
/* Dry run                                                                     */
/* -------------------------------------------------------------------------- */

test('a dry run touches nothing at all', async () => {
  const path = join(scratch(), 'dry.jsonl');
  const transport = new RecordingTransport(new SimulatorTransport());
  const summary = await runBatch(base(path, { count: 25, dryRun: true, transport }));

  assert.equal(summary.dryRun, true);
  assert.equal(summary.complete, true);
  assert.equal(summary.planned.length, 25);
  assert.deepEqual(transport.methodSequence(), [], 'a dry run must make zero transport calls of any kind');

  const journal = readJournal(path);
  assert.equal(journal.header.dryRun, true);
  assert.equal(journal.units.length, 25);
  for (const unit of journal.units) {
    assert.equal(unit.outcome, 'planned');
    assert.equal(unit.readBackHex, null);
    assert.equal(unit.protection, null);
  }
});

test('a dry run journal cannot be resumed as a real run', async () => {
  const path = join(scratch(), 'dry.jsonl');
  await runBatch(base(path, { count: 3, dryRun: true }));
  await assert.rejects(
    () => runBatch(base(path, { count: 3, dryRun: false })),
    (error: unknown) => isChipError(error) && error.code === 'JOURNAL_MISMATCH' && /dry run/.test(error.message),
  );
});

/* -------------------------------------------------------------------------- */
/* Scale                                                                       */
/* -------------------------------------------------------------------------- */

test('a 500 unit pilot run completes with 500 journalled units and no gaps', async () => {
  const path = join(scratch(), 'pilot-500.jsonl');
  const summary = await runBatch(base(path, { count: 500, transport: new SimulatorTransport() }));

  assert.equal(summary.complete, true);
  assert.equal(summary.succeeded.length, 500);

  const journal = readJournal(path);
  assert.equal(journal.units.length, 500);
  const seqs = new Set(journal.units.map((u) => u.seq));
  assert.equal(seqs.size, 500);
  for (let seq = 1; seq <= 500; seq += 1) assert.ok(seqs.has(seq), `unit ${seq} is missing from the journal`);
});

test('a run begun on a physical reader is not finished on the simulator', async () => {
  // The resume command chip-cli status prints carries no --transport, and the
  // default is the simulator. Without this refusal the remaining units of a
  // hardware batch complete against memory: the journal says 500 tags are
  // encoded and the tags after the interruption were never touched.
  const path = join(scratch(), 'transport.jsonl');
  const reader = new SimulatorTransport();
  Object.defineProperty(reader, 'isHardware', { value: true });
  Object.defineProperty(reader, 'name', { value: 'pcsc' });

  let ticks = 0;
  const first = await runBatch(base(path, { count: 5, transport: reader, shouldStop: () => ticks++ >= 2 }));
  assert.equal(first.transportIsHardware, true);
  assert.equal(first.succeeded.length, 2);

  await assert.rejects(
    () => runBatch(base(path, { count: 5, transport: new SimulatorTransport() })),
    (error: unknown) => isChipError(error) && error.code === 'JOURNAL_MISMATCH',
  );

  // Resuming on a reader again is allowed, including a different reader.
  const other = new SimulatorTransport();
  Object.defineProperty(other, 'isHardware', { value: true });
  Object.defineProperty(other, 'name', { value: 'pcsc-2' });
  const second = await runBatch(base(path, { count: 5, transport: other }));
  assert.equal(second.complete, true);
});

/* -------------------------------------------------------------------------- */
/* The journal digest, checked rather than merely stored                       */
/* -------------------------------------------------------------------------- */

test('a forged journal line is refused on resume rather than counted as a unit done', async () => {
  // The exact probe from the review. A three unit run stopped after unit 1, then two lines
  // copied from unit 1 with the seq changed and the digest left as it was. Both fail their
  // own digest check. The resume used to report complete, exit 0, with zero tags touched.
  const path = join(scratch(), 'forged.jsonl');
  let ticks = 0;
  await runBatch(base(path, { count: 3, shouldStop: () => ticks++ >= 1 }));

  const lines = readFileSync(path, 'utf8').trim().split('\n');
  const unitOne = lines.find((line) => line.includes('"kind":"unit"'));
  assert.ok(unitOne !== undefined, 'the first run journalled a unit');
  appendFileSync(path, `${unitOne.replace('"seq":1', '"seq":2')}\n`);
  appendFileSync(path, `${unitOne.replace('"seq":1', '"seq":3')}\n`);

  const parsed = readJournal(path);
  assert.equal(parsed.digestFailures.length, 2, 'both forged lines fail their own digest');
  assert.deepEqual(parsed.digestFailures.map((failure) => failure.seq), [2, 3]);
  assert.equal(parsed.digestFailures[0]?.reason, 'digest does not match contents');
  // resumeState still reports them as done, which is the point: nothing downstream of the
  // parse can tell a forged line from a real one, so the refusal has to happen here.
  assert.deepEqual([...resumeState(parsed, 3).done], [1, 2, 3]);

  await assert.rejects(
    () => runBatch(base(path, { count: 3 })),
    (error: unknown) =>
      isChipError(error) && error.code === 'JOURNAL_CORRUPT' && /do not match their own digest/.test(error.message),
  );
});

test('a record with no digest at all is refused, because this tool has never written one', async () => {
  const path = join(scratch(), 'nodigest.jsonl');
  let ticks = 0;
  await runBatch(base(path, { count: 3, shouldStop: () => ticks++ >= 1 }));

  const lines = readFileSync(path, 'utf8').trim().split('\n');
  const unitOne = JSON.parse(lines.find((line) => line.includes('"kind":"unit"')) as string) as Record<string, unknown>;
  delete unitOne['digest'];
  unitOne['seq'] = 2;
  appendFileSync(path, `${JSON.stringify(unitOne)}\n`);

  const parsed = readJournal(path);
  assert.equal(parsed.digestFailures.length, 1);
  assert.equal(parsed.digestFailures[0]?.reason, 'no digest');
  await assert.rejects(
    () => runBatch(base(path, { count: 3 })),
    (error: unknown) => isChipError(error) && error.code === 'JOURNAL_CORRUPT',
  );
});

test('a resume says something about an unreadable line instead of proceeding in silence', async () => {
  const path = join(scratch(), 'badline.jsonl');
  let ticks = 0;
  await runBatch(base(path, { count: 4, shouldStop: () => ticks++ >= 1 }));
  // Well formed as a line, not as JSON. runBatch used to ignore parsed.badLines entirely.
  appendFileSync(path, 'this line is not JSON\n');

  assert.equal(readJournal(path).badLines, 1);
  await assert.rejects(
    () => runBatch(base(path, { count: 4 })),
    (error: unknown) => isChipError(error) && error.code === 'JOURNAL_CORRUPT' && /unreadable line/.test(error.message),
  );
});

test('an interrupted final write is still resumable, because that is the case the journal is built for', async () => {
  // The digest check must not condemn the one damaged line the design expects. A truncated
  // tail is excluded from it, and the resume proceeds.
  const path = join(scratch(), 'truncated.jsonl');
  let ticks = 0;
  await runBatch(base(path, { count: 4, shouldStop: () => ticks++ >= 1 }));
  appendFileSync(path, '{"kind":"unit","seq":2,"attem');

  const parsed = readJournal(path);
  assert.equal(parsed.truncatedTail, true);
  assert.deepEqual([...parsed.digestFailures], []);

  const second = await runBatch(base(path, { count: 4 }));
  assert.equal(second.complete, true);
});

test('an intact journal has no digest failures, so the check is not simply refusing everything', async () => {
  const path = join(scratch(), 'intact.jsonl');
  await runBatch(base(path, { count: 6 }));
  const parsed = readJournal(path);
  assert.equal(parsed.units.length, 6);
  assert.deepEqual([...parsed.digestFailures], []);
  assert.equal(parsed.badLines, 0);
});
