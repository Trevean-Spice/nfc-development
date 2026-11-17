/**
 * The command line, driven the way an operator drives it.
 *
 * Exit codes matter as much as the output here: the runbook tells the operator to
 * look at the last line, and a CI job looks at the number.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { main } from '../src/cli/main.js';

async function run(args: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main(args, { out: (line) => out.push(line), err: (line) => err.push(line) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'chip-cli-cli-'));
}

test('no arguments prints usage and exits non zero', async () => {
  const result = await run([]);
  assert.equal(result.code, 1);
  assert.match(result.out, /ST25TV02KC/);
  assert.match(result.out, /Not NTAG/);
});

test('codes lists the table with the encodable ones and the reserved one', async () => {
  const result = await run(['codes']);
  assert.equal(result.code, 0);
  assert.match(result.out, /ps\s+Persian Sunrise/);
  assert.match(result.out, /https:\/\/treveanspice\.com\/t\/ps/);
  assert.match(result.out, /kg\s+Kyoto Garden\s+0\s+do not write/);
});

test('encode shows the prefix abbreviation and the capacity headroom without a tag', async () => {
  const result = await run(['encode', '--code', 'ps']);
  assert.equal(result.code, 0);
  assert.match(result.out, /0x04 for "https:\/\/"/);
  assert.match(result.out, /29 of 312 bytes used, 283 free \(320 byte part\)/);
});

test('encode as JSON is machine readable', async () => {
  const result = await run(['encode', '--code', 'cs', '--json']);
  assert.equal(result.code, 0);
  const parsed = JSON.parse(result.out) as { uri: string; identifierCode: number; tlvBytes: number };
  assert.equal(parsed.uri, 'https://treveanspice.com/t/cs');
  assert.equal(parsed.identifierCode, 4);
  assert.equal(parsed.tlvBytes, 29);
});

test('encode refuses the reserved code and says why', async () => {
  const result = await run(['encode', '--code', 'kg']);
  assert.equal(result.code, 2);
  assert.match(result.err, /CODE_NOT_ENCODABLE/);
  assert.match(result.err, /not found page at a customer kitchen counter/);
});

test('decode turns bytes back into a URL, from a message or from a whole TLV', async () => {
  const message = await run(['encode', '--code', 'sr', '--json']);
  const { messageHex, tlvHex } = JSON.parse(message.out) as { messageHex: string; tlvHex: string };

  const a = await run(['decode', '--hex', messageHex]);
  assert.equal(a.code, 0);
  assert.match(a.out, /https:\/\/treveanspice\.com\/t\/sr/);

  const b = await run(['decode', '--hex', tlvHex]);
  assert.equal(b.code, 0);
  assert.match(b.out, /https:\/\/treveanspice\.com\/t\/sr/);
});

test('a dry run write states that nothing was touched', async () => {
  const result = await run(['write', '--code', 'ps', '--dry-run']);
  assert.equal(result.code, 0);
  assert.match(result.out, /DRY RUN\. No tag is touched/);
  assert.match(result.out, /Protection would not be applied/);
});

test('a simulated write reports the read back verification', async () => {
  const result = await run(['write', '--code', 'ps']);
  assert.equal(result.code, 0);
  assert.match(result.out, /Verified\s+https:\/\/treveanspice\.com\/t\/ps/);
});

test('a simulated protected write proves the refusal', async () => {
  const previous = process.env['TEST_CLI_PASSWORD'];
  process.env['TEST_CLI_PASSWORD'] = 'a1b2c3d4e5f60718';
  try {
    const result = await run(['write', '--code', 'ps', '--protect', '--password-env', 'TEST_CLI_PASSWORD']);
    assert.equal(result.code, 0);
    assert.match(result.out, /refusal proven: yes/);
    assert.match(result.out, /unlock proven: yes/);
    assert.ok(!result.out.includes('a1b2c3d4e5f60718'), 'the password must never be printed');
  } finally {
    if (previous === undefined) delete process.env['TEST_CLI_PASSWORD'];
    else process.env['TEST_CLI_PASSWORD'] = previous;
  }
});

test('there is no --password flag, and asking for one is a usage error', async () => {
  const result = await run(['write', '--code', 'ps', '--protect', '--password', 'a1b2c3d4e5f60718']);
  assert.equal(result.code, 1);
  assert.match(result.err, /FAILED  USAGE/);
});

test('protect without a password source explains where it should come from', async () => {
  const result = await run(['write', '--code', 'ps', '--protect']);
  assert.equal(result.code, 2);
  assert.match(result.err, /PASSWORD_MISSING/);
  assert.match(result.err, /--password-env/);
});

test('a batch run, its status, and its resumption work from the command line', async () => {
  const path = join(scratch(), 'run.jsonl');

  const first = await run(['batch', '--code', 'ps', '--count', '6', '--journal', path, '--sim-fault', '4=write-fail']);
  assert.equal(first.code, 3, 'a batch with a failure is incomplete');
  assert.match(first.out, /BATCH NOT COMPLETE/);
  assert.match(first.out, /Units that failed: 4/);

  const status = await run(['status', '--journal', path]);
  assert.equal(status.code, 3);
  assert.match(status.out, /Done\s+5 of 6/);
  assert.match(status.out, /Remaining\s+1: 4/);

  const second = await run(['batch', '--code', 'ps', '--count', '6', '--journal', path]);
  assert.equal(second.code, 0);
  assert.match(second.out, /BATCH COMPLETE/);

  const finalStatus = await run(['status', '--journal', path]);
  assert.equal(finalStatus.code, 0);
  assert.match(finalStatus.out, /Done\s+6 of 6/);
});

test('a batch dry run writes a journal and touches nothing', async () => {
  const path = join(scratch(), 'dry.jsonl');
  const result = await run(['batch', '--code', 'nm', '--count', '10', '--journal', path, '--dry-run']);
  assert.equal(result.code, 0);
  assert.match(result.out, /DRY RUN/);
  assert.match(result.out, /Planned\s+10/);
});

test('verify reads a tag and confirms, or refuses, the code it should carry', async () => {
  const right = await run(['verify', '--expect', 'cs', '--sim-preload-uri', 'https://treveanspice.com/t/cs']);
  assert.equal(right.code, 0);
  assert.match(right.out, /OK  the tag carries https:\/\/treveanspice\.com\/t\/cs/);

  const wrong = await run(['verify', '--expect', 'ps', '--sim-preload-uri', 'https://treveanspice.com/t/cs']);
  assert.equal(wrong.code, 2);
  assert.match(wrong.err, /READBACK_MISMATCH/);
  assert.match(wrong.err, /should carry "https:\/\/treveanspice\.com\/t\/ps"/);
});

test('a protected batch reports the protected count separately from the verified count', async () => {
  const path = join(scratch(), 'protected.jsonl');
  const previous = process.env['TEST_CLI_BATCH_PASSWORD'];
  process.env['TEST_CLI_BATCH_PASSWORD'] = '3f8a1c47b9d02e65';
  try {
    const result = await run([
      'batch',
      '--code',
      'nm',
      '--count',
      '4',
      '--journal',
      path,
      '--protect',
      '--password-env',
      'TEST_CLI_BATCH_PASSWORD',
    ]);
    assert.equal(result.code, 0);
    assert.match(result.out, /Protected\s+4/);
    assert.ok(!result.out.includes('3f8a1c47b9d02e65'));
  } finally {
    if (previous === undefined) delete process.env['TEST_CLI_BATCH_PASSWORD'];
    else process.env['TEST_CLI_BATCH_PASSWORD'] = previous;
  }
});

test('doctor reports the table, the codes and the transport', async () => {
  const result = await run(['doctor']);
  assert.equal(result.code, 0);
  assert.match(result.out, /ok\s+redirect table/);
  assert.match(result.out, /ok\s+every code fits the chip\s+312 byte area on a 320 byte ST25TV02KC/);
  assert.match(result.out, /simulator, no physical tags are written/);
  assert.match(result.out, /Ready\./);
});

test('doctor reports the real reader as unavailable rather than pretending it is ready', async () => {
  // The property under test is unchanged and is the whole point: doctor must not say
  // Ready when it cannot reach a reader. What changed on Thursday 17 September 2026 is
  // WHY it cannot: "reader" is now the PC/SC transport rather than the old stub, so the
  // reason is a missing optional native module on a machine with no reader, instead of
  // an unimplemented file. Asserted on the failure and the exit code rather than on the
  // sentence, so this test stops breaking every time the remedy is reworded.
  const result = await run(['doctor', '--transport', 'reader']);
  assert.equal(result.code, 2);
  assert.match(result.out, /FAIL\s+transport "pcsc"/);
  assert.match(result.out, /check\(s\) failed/);
  assert.ok(!result.out.includes('Ready.'), 'doctor must never report Ready with no reachable reader');
});

test('the old stub is still reachable by name, so the bring up can be rehearsed against it', async () => {
  // README section 6.3 is run against hardware that might itself be at fault. Keeping a
  // transport that refuses predictably means a failure can be attributed.
  const result = await run(['doctor', '--transport', 'stub']);
  assert.equal(result.code, 2);
  assert.match(result.out, /not implemented/);
});

test('an unknown command and an unknown option are usage errors', async () => {
  assert.equal((await run(['frobnicate'])).code, 1);
  assert.equal((await run(['codes', '--nonsense'])).code, 1);
});

test('an unknown transport is a usage error rather than a silent fallback to the simulator', async () => {
  const result = await run(['write', '--code', 'ps', '--transport', 'magic']);
  assert.equal(result.code, 1);
  assert.match(result.err, /Unknown transport/);
});

test('the reader transport refuses to write rather than silently doing nothing', async () => {
  const result = await run(['write', '--code', 'ps', '--transport', 'reader']);
  assert.equal(result.code, 2);
  assert.match(result.err, /TRANSPORT_UNAVAILABLE/);
  assert.match(result.err, /--transport simulator/);
});

/* -------------------------------------------------------------------------- */
/* The resume command the tool prints has to be a command that works           */
/* -------------------------------------------------------------------------- */

/** Split a printed "Resume with:  chip-cli batch ..." line into argv, minus the program. */
function argvFrom(statusOut: string): string[] {
  const line = statusOut.split('\n').find((candidate) => candidate.startsWith('Resume with:'));
  assert.ok(line !== undefined, 'status printed a resume line');
  const command = line.slice('Resume with:'.length).trim();
  assert.ok(command.startsWith('chip-cli batch '), `the resume line is a chip-cli batch command: ${command}`);
  return command.slice('chip-cli batch '.length).split(' ').filter(Boolean);
}

test('the printed resume command actually resumes an unprotected run', async () => {
  const path = join(scratch(), 'plain.jsonl');
  const first = await run(['batch', '--code', 'ps', '--count', '6', '--journal', path, '--sim-fault', '4=write-fail']);
  assert.equal(first.code, 3);

  const status = await run(['status', '--journal', path]);
  const argv = argvFrom(status.out);
  // The three flags whose absence made the printed command fail: the transport, which the
  // resume check compares, the table, which the digest check compares, and the protection
  // flag below.
  assert.ok(argv.includes('--transport'), `the transport is named: ${argv.join(' ')}`);
  assert.ok(argv.includes('--table'), `the table is named: ${argv.join(' ')}`);
  assert.equal(argv.includes('--protect'), false, 'an unprotected run does not ask for a password');

  const resumed = await run(['batch', ...argv]);
  assert.equal(resumed.code, 0, `running exactly the printed command must not fail: ${resumed.err}`);
  assert.match(resumed.out, /BATCH COMPLETE/);
});

test('the printed resume command carries --protect and names the password the operator must supply', async () => {
  // Running the old printed line against a protected run exited 2 with
  // JOURNAL_MISMATCH: "the journal was started with write protection true and this run
  // asks for false". The password cannot be echoed, so the line names it instead.
  const path = join(scratch(), 'protected.jsonl');
  process.env['CHIP_CLI_TEST_PASSWORD'] = 'a1b2c3d4e5f60718';
  try {
    const first = await run([
      'batch', '--code', 'ps', '--count', '5', '--journal', path,
      '--protect', '--password-env', 'CHIP_CLI_TEST_PASSWORD',
      '--sim-fault', '3=protect-fail',
    ]);
    assert.equal(first.code, 3);

    const status = await run(['status', '--journal', path]);
    const argv = argvFrom(status.out);
    assert.ok(argv.includes('--protect'), `a protected run is resumed with --protect: ${argv.join(' ')}`);
    assert.ok(argv.includes('--password-env'), 'the password source is named as a flag');
    assert.match(status.out, /The password is not printed here and is not in the journal/);
    assert.match(status.out, /fingerprint [0-9a-f]{8}/);

    // Substituting the one placeholder the operator is told to substitute produces a
    // command that runs. Everything else is copied verbatim.
    const substituted = argv.map((token) => (token.startsWith('<') ? 'CHIP_CLI_TEST_PASSWORD' : token));
    const resumed = await run(['batch', ...substituted]);
    assert.notEqual(resumed.code, 2, `the printed command must not be refused outright: ${resumed.err}`);
    assert.equal(/JOURNAL_MISMATCH/.test(resumed.err), false, resumed.err);
  } finally {
    delete process.env['CHIP_CLI_TEST_PASSWORD'];
  }
});

test('a dry run prints a resume command that keeps it a dry run', async () => {
  // A dry run journals every unit as planned rather than verified, so status always shows
  // them as remaining. The printed command must therefore carry --dry-run: without it the
  // resume asks for a real run against a dry run journal and is refused with
  // JOURNAL_MISMATCH on "dry run".
  const path = join(scratch(), 'dryresume.jsonl');
  const first = await run(['batch', '--code', 'nm', '--count', '4', '--journal', path, '--dry-run']);
  assert.equal(first.code, 0);

  const status = await run(['status', '--journal', path]);
  const argv = argvFrom(status.out);
  assert.ok(argv.includes('--dry-run'), `a dry run is resumed as a dry run: ${argv.join(' ')}`);

  const resumed = await run(['batch', ...argv]);
  assert.notEqual(resumed.code, 2, `the printed command must not be refused outright: ${resumed.err}`);
  assert.equal(/JOURNAL_MISMATCH/.test(resumed.err), false, resumed.err);
});

test('a journal with a forged line prints a refusal instead of a resume command', async () => {
  const path = join(scratch(), 'forged-cli.jsonl');
  const first = await run(['batch', '--code', 'ps', '--count', '6', '--journal', path, '--sim-fault', '4=write-fail']);
  assert.equal(first.code, 3);

  const lines = readFileSync(path, 'utf8').trim().split('\n');
  const unitOne = lines.find((line) => line.includes('"kind":"unit"')) as string;
  appendFileSync(path, `${unitOne.replace('"seq":1', '"seq":4')}\n`);

  const status = await run(['status', '--journal', path]);
  // Exit 2, not 0: the forged line makes every unit look done, which is the worst state to
  // report as success rather than the safest.
  assert.equal(status.code, 2);
  assert.match(status.out, /FAIL\s+line \d+ \(unit seq 4\) digest does not match contents/);
  assert.equal(status.out.includes('Resume with:'), false);
  assert.match(status.out, /Do not resume this journal/);

  const resumed = await run(['batch', '--code', 'ps', '--count', '6', '--journal', path]);
  assert.equal(resumed.code, 2);
  assert.match(resumed.err, /JOURNAL_CORRUPT/);
});

test('write says the capability container was written or preserved, in plain English', async () => {
  // A blank tag has no container, so the tool writes one, and the line used to read
  // "writed". It is on screen in front of the client on the first real run.
  const blank = await run(['write', '--code', 'ps', '--sim-preload-blank']);
  assert.equal(blank.code, 0);
  assert.match(blank.out, /capability container written$/m);
  assert.doesNotMatch(blank.out, /writed/);

  const encoded = await run(['write', '--code', 'ps', '--sim-preload-uri', 'https://treveanspice.com/t/cs']);
  assert.equal(encoded.code, 0);
  assert.match(encoded.out, /capability container preserved$/m);
});
