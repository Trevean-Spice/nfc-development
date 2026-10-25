/**
 * The command line.
 *
 * Exit codes, because a runbook and a CI job both need them:
 *   0    everything asked for was done
 *   1    the command line was wrong
 *   2    an operational failure, with a code from chip/errors.ts
 *   3    the batch did not complete: some units failed or were not attempted
 *   130  interrupted by the operator
 */

import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { ChipError, asChipError, isChipError } from '../chip/errors.js';
import { FACTORY_DEFAULT_HEX, TagPassword, loadPassword } from '../chip/password.js';
import { PART, T5T_AREA_BYTES, type CcPolicy } from '../chip/st25tv02kc.js';
import { decodeUriMessage } from '../ndef/decode.js';
import { unwrapNdefTlv } from '../ndef/tlv.js';
import { RedirectTable, DEFAULT_TABLE_PATH } from '../table/redirect-table.js';
import { PhysicalReaderTransport } from '../transport/reader-stub.js';
import { PcscTransport } from '../transport/pcsc.js';
import { SimulatorTransport, type SimulatorFaultKind } from '../transport/simulator.js';
import type { TagTransport } from '../transport/transport.js';
import { fromHex } from '../util/hex.js';
import { runBatch, type BatchEvent } from '../workflow/batch.js';
import { readJournal, resumeState } from '../workflow/journal.js';
import { UnitSession, planEncoding } from '../workflow/unit.js';
import { compactRanges, renderBatchSummary, renderEncoding, renderError, resumeCommand, rule } from './render.js';

export const TOOL_VERSION = '1.0.0';

const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_FAILURE = 2;
const EXIT_INCOMPLETE = 3;
const EXIT_INTERRUPTED = 130;

const OPTIONS = {
  help: { type: 'boolean' as const, short: 'h' },
  version: { type: 'boolean' as const },
  table: { type: 'string' as const },
  code: { type: 'string' as const },
  count: { type: 'string' as const },
  journal: { type: 'string' as const },
  transport: { type: 'string' as const },
  'reader-name': { type: 'string' as const },
  'dry-run': { type: 'boolean' as const },
  protect: { type: 'boolean' as const },
  'password-env': { type: 'string' as const },
  'password-file': { type: 'string' as const },
  'current-password-env': { type: 'string' as const },
  'current-password-file': { type: 'string' as const },
  'cc-policy': { type: 'string' as const },
  'verify-after-power-cycle': { type: 'boolean' as const },
  attempts: { type: 'string' as const },
  'max-failures': { type: 'string' as const },
  'tag-timeout-ms': { type: 'string' as const },
  operator: { type: 'string' as const },
  prompt: { type: 'boolean' as const },
  'no-prompt': { type: 'boolean' as const },
  json: { type: 'boolean' as const },
  hex: { type: 'string' as const },
  expect: { type: 'string' as const },
  'sim-fault': { type: 'string' as const, multiple: true as const },
  'sim-preload-uri': { type: 'string' as const },
  'sim-preload-blank': { type: 'boolean' as const },
  'sim-tray': { type: 'string' as const },
};

const USAGE = `
chip-cli, Trevean Spice chip programming tool
ST25TV02KC, NFC Forum Type 5 / ISO 15693. Not NTAG, not Type 2.

USAGE
  chip-cli <command> [options]

COMMANDS
  codes                       List the tag codes in the redirect table
  encode --code <code>        Show exactly what would be written for a code. No tag needed
  decode --hex <bytes>        Decode NDEF bytes back into a URL
  write --code <code>         Write, read back, verify, and optionally protect one tag
  verify --expect <code>      Read one tag and check it carries the right URL
  batch --code <code> --count <n> --journal <path>
                              Run a batch, resumable, one journal line per unit
  status --journal <path>     Report progress of a batch journal
  doctor                      Check the tool, the table and the transport before a run

COMMON OPTIONS
  --table <path>              Redirect table. Default: the one in build/edge
  --transport <name>          simulator (default), reader (PC/SC), or stub
  --reader-name <substring>   Pick one reader by name when several are attached
  --dry-run                   Plan only. Touches no tag and writes nothing
  --json                      Machine readable output where it makes sense

PROTECTION OPTIONS
  --protect                   Apply area based 64 bit password write protection
  --password-env <VAR>        New password, 16 hex characters, from an environment variable
  --password-file <path>      New password from a file
  --current-password-env <VAR>
  --current-password-file <path>
                              The password the tag holds now. Defaults to the
                              factory sixteen zeros
  There is deliberately no --password flag. Command line arguments are visible to
  other processes and end up in shell history.

BATCH OPTIONS
  --count <n>                 Units in this batch
  --journal <path>            Batch journal. Rerun the same command to resume it
  --attempts <n>              Attempts per unit before it is recorded failed. Default 2
  --max-failures <n>          Stop the run after this many failures. Default 10
  --prompt / --no-prompt      Wait for the operator between tags. Default: on with
                              a real reader and an interactive terminal
  --verify-after-power-cycle  Lift the tag out of the field before reading it back

SIMULATOR OPTIONS (no hardware needed)
  --sim-tray <n>              Tags in the simulated tray
  --sim-preload-uri <uri>     Every simulated tag starts already encoded with this
  --sim-preload-blank         Every simulated tag starts unformatted
  --sim-fault <pos>=<kind>    Inject a fault at a tray position. Repeatable.
                              Kinds: tag-absent, write-fail, write-partial,
                              readback-fail, readback-corrupt, protect-fail,
                              wrong-password, geometry-mismatch
`.trimStart();

type Parsed = { values: Record<string, unknown>; positionals: string[] };

function parse(argv: string[]): Parsed {
  try {
    const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
    return { values: values as Record<string, unknown>, positionals };
  } catch (cause) {
    throw new ChipError(
      'USAGE',
      cause instanceof Error ? cause.message : String(cause),
      'Run "chip-cli --help" for the option list.',
      {},
    );
  }
}

function str(values: Record<string, unknown>, key: string): string | undefined {
  const value = values[key];
  return typeof value === 'string' ? value : undefined;
}

function bool(values: Record<string, unknown>, key: string): boolean {
  return values[key] === true;
}

function int(values: Record<string, unknown>, key: string, fallback: number): number {
  const raw = str(values, key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new ChipError('USAGE', `--${key} needs a whole number. Got "${raw}".`, 'Correct the option and run it again.', { key, raw });
  }
  return parsed;
}

function loadTable(values: Record<string, unknown>): RedirectTable {
  return RedirectTable.load(str(values, 'table') ?? DEFAULT_TABLE_PATH);
}

function buildTransport(values: Record<string, unknown>): TagTransport {
  const name = str(values, 'transport') ?? 'simulator';
  // "reader" is the real one and is PC/SC. The old stub is kept reachable under its own
  // name so the bring up in README section 6.3 can be rehearsed against something that
  // refuses predictably, rather than against hardware that might be at fault instead.
  if (name === 'reader' || name === 'pcsc') return new PcscTransport(str(values, 'reader-name'));
  if (name === 'stub') return new PhysicalReaderTransport();
  if (name !== 'simulator') {
    throw new ChipError('USAGE', `Unknown transport "${name}".`, 'Use --transport simulator, --transport reader, or --transport stub.', { name });
  }

  const faults: Record<number, SimulatorFaultKind> = {};
  const rawFaults = values['sim-fault'];
  if (Array.isArray(rawFaults)) {
    for (const spec of rawFaults) {
      const text = String(spec);
      const [positionText, kind] = text.split('=');
      const position = Number(positionText);
      if (!Number.isInteger(position) || position < 1 || kind === undefined) {
        throw new ChipError('USAGE', `--sim-fault wants <position>=<kind>. Got "${text}".`, 'For example: --sim-fault 3=write-fail', {
          spec: text,
        });
      }
      faults[position] = kind as SimulatorFaultKind;
    }
  }

  const trayText = str(values, 'sim-tray');
  const options: ConstructorParameters<typeof SimulatorTransport>[0] = {
    faults,
    preloadUri: str(values, 'sim-preload-uri') ?? null,
    preloadBlank: bool(values, 'sim-preload-blank'),
  };
  if (trayText !== undefined) {
    return new SimulatorTransport({ ...options, trayCount: Number(trayText) });
  }
  return new SimulatorTransport(options);
}

interface Passwords {
  readonly current: TagPassword;
  readonly next: TagPassword;
  readonly origin: string;
}

function loadPasswords(values: Record<string, unknown>): Passwords {
  const newSource = { env: str(values, 'password-env'), file: str(values, 'password-file') };
  const loaded = loadPassword(newSource, 'new', (p) => readFileSync(p, 'utf8'));

  const currentEnv = str(values, 'current-password-env');
  const currentFile = str(values, 'current-password-file');
  if (currentEnv === undefined && currentFile === undefined) {
    return { current: TagPassword.factoryDefault(), next: loaded.password, origin: loaded.origin };
  }
  const current = loadPassword({ env: currentEnv, file: currentFile }, 'current', (p) => readFileSync(p, 'utf8'));
  return { current: current.password, next: loaded.password, origin: loaded.origin };
}

/* -------------------------------------------------------------------------- */
/* Commands                                                                    */
/* -------------------------------------------------------------------------- */

function commandCodes(values: Record<string, unknown>, out: (line: string) => void): number {
  const table = loadTable(values);
  if (bool(values, 'json')) {
    out(JSON.stringify({ tablePath: table.path, tableDigest: table.digest, version: table.version, entries: table.entries() }, null, 2));
    return EXIT_OK;
  }
  out('');
  out(`Redirect table  ${table.path}`);
  out(`Version ${table.version}, digest ${table.digest}`);
  out('');
  out('  CODE  BLEND                        UNITS  WRITE THIS');
  out(`  ${rule(66)}`);
  for (const entry of table.entries()) {
    const target = entry.ndefUri ?? `do not write, table status "${entry.status}"`;
    out(`  ${entry.code.padEnd(5)} ${entry.blendName.padEnd(28)} ${String(entry.unitsEncoded).padStart(5)}  ${target}`);
  }
  out('');
  out('A code with no URL is not encodable. Writing it would put a not found page on a jar.');
  out('');
  return EXIT_OK;
}

function commandEncode(values: Record<string, unknown>, out: (line: string) => void): number {
  const table = loadTable(values);
  const code = str(values, 'code');
  if (code === undefined) throw new ChipError('USAGE', 'encode needs --code.', 'For example: chip-cli encode --code ps', {});
  const { entry, uri } = table.uriFor(code);
  const plan = planEncoding(uri);

  if (bool(values, 'json')) {
    out(JSON.stringify({ code: entry.code, blend: entry.blendName, ...plan.summary }, null, 2));
    return EXIT_OK;
  }
  out('');
  out(`${entry.code}  ${entry.blendName}`);
  out(rule());
  out(renderEncoding(plan.summary, plan.tlv, plan.record.message));
  out('');
  return EXIT_OK;
}

function commandDecode(values: Record<string, unknown>, out: (line: string) => void): number {
  const hex = str(values, 'hex');
  if (hex === undefined) throw new ChipError('USAGE', 'decode needs --hex.', 'For example: chip-cli decode --hex d101165504...', {});
  let bytes: Uint8Array;
  try {
    bytes = fromHex(hex);
  } catch {
    throw new ChipError('USAGE', 'The --hex value is not a hex string.', 'Give an even number of hex characters.', {});
  }
  // Accept either a bare NDEF message or a whole TLV, since an operator reading
  // bytes off another tool will not know which they have.
  const message = bytes[0] === 0x03 ? unwrapNdefTlv(bytes) : bytes;
  const decoded = decodeUriMessage(message);
  if (bool(values, 'json')) {
    out(JSON.stringify(decoded, null, 2));
    return EXIT_OK;
  }
  out('');
  out(`URL              ${decoded.uri}`);
  out(`Prefix code      0x${decoded.identifierCode.toString(16).padStart(2, '0')}`);
  out(`Payload bytes    ${decoded.payloadLength}`);
  out('');
  return EXIT_OK;
}

async function commandWrite(values: Record<string, unknown>, out: (line: string) => void): Promise<number> {
  const table = loadTable(values);
  const code = str(values, 'code');
  if (code === undefined) throw new ChipError('USAGE', 'write needs --code.', 'For example: chip-cli write --code ps', {});
  const { entry, uri } = table.uriFor(code);
  const protect = bool(values, 'protect');
  const dryRun = bool(values, 'dry-run');

  if (dryRun) {
    const plan = planEncoding(uri);
    out('');
    out(`DRY RUN. No tag is touched, nothing is written. ${entry.code}  ${entry.blendName}`);
    out(rule());
    out(renderEncoding(plan.summary, plan.tlv, plan.record.message));
    out('');
    out(protect ? 'Protection would be applied after verification, never before.' : 'Protection would not be applied.');
    out('');
    return EXIT_OK;
  }

  const transport = buildTransport(values);
  const passwords = protect ? loadPasswords(values) : null;

  await transport.open();
  try {
    const session = new UnitSession({
      transport,
      uri,
      code: entry.code,
      ccPolicy: (str(values, 'cc-policy') as CcPolicy | undefined) ?? 'preserve',
      tagTimeoutMs: int(values, 'tag-timeout-ms', 10_000),
      verifyAfterPowerCycle: bool(values, 'verify-after-power-cycle'),
      unlockPassword: passwords?.current,
    });

    const identity = await session.selectTag();
    out(`Tag selected     uid ${identity.uid ?? 'unknown'}, ${identity.blockCount} blocks of ${identity.blockSizeBytes} bytes`);
    const plan = await session.write();
    out(`Written          ${plan.blocksWritten} blocks, capability container ${plan.ccAction === 'write' ? 'written' : 'preserved'}`);
    const receipt = await session.verify();
    out(`Verified         ${receipt.decodedUri}`);
    if (passwords !== null) {
      const outcome = await session.protect(receipt, { currentPassword: passwords.current, newPassword: passwords.next });
      out(`Protected        area ${outcome.area}, password ${outcome.passwordNumber}, fingerprint ${outcome.passwordFingerprint}`);
      out(`                 refusal proven: ${outcome.refusalProven ? 'yes' : 'no'}`);
    }
    await session.finish();
    out('');
    out(`OK  ${entry.code}  ${entry.blendName}  ${uri}`);
    out('');
    return EXIT_OK;
  } finally {
    await transport.close();
  }
}

async function commandVerify(values: Record<string, unknown>, out: (line: string) => void): Promise<number> {
  const table = loadTable(values);
  const expect = str(values, 'expect');
  if (expect === undefined) {
    throw new ChipError('USAGE', 'verify needs --expect with the code the tag should carry.', 'For example: chip-cli verify --expect ps', {});
  }
  const { entry, uri } = table.uriFor(expect);
  const transport = buildTransport(values);

  await transport.open();
  try {
    await transport.waitForTag(int(values, 'tag-timeout-ms', 10_000));
    const blocks = Math.ceil(T5T_AREA_BYTES / PART.blockSizeBytes);
    const image = await transport.readBlocks(0, 1 + blocks);
    const decoded = decodeUriMessage(unwrapNdefTlv(image.subarray(PART.blockSizeBytes)));
    if (decoded.uri !== uri) {
      throw new ChipError(
        'READBACK_MISMATCH',
        `The tag carries "${decoded.uri}" and ${entry.code} (${entry.blendName}) should carry "${uri}".`,
        'Set this tag aside, label it, and report it.',
        { found: decoded.uri, expected: uri },
      );
    }
    out('');
    out(`OK  the tag carries ${uri}  (${entry.blendName})`);
    out('');
    return EXIT_OK;
  } finally {
    await transport.close();
  }
}

async function commandBatch(values: Record<string, unknown>, out: (line: string) => void): Promise<number> {
  const table = loadTable(values);
  const code = str(values, 'code');
  const journalPath = str(values, 'journal');
  if (code === undefined || journalPath === undefined) {
    throw new ChipError(
      'USAGE',
      'batch needs --code, --count and --journal.',
      'For example: chip-cli batch --code ps --count 125 --journal runs/ps.jsonl',
      {},
    );
  }
  const count = int(values, 'count', -1);
  if (count < 1) {
    throw new ChipError('USAGE', 'batch needs --count with a whole number of at least 1.', 'For example: --count 125', {});
  }

  const dryRun = bool(values, 'dry-run');
  const protect = bool(values, 'protect');
  const transport = buildTransport(values);
  const passwords = protect ? loadPasswords(values) : null;

  const interactive =
    bool(values, 'prompt') || (!bool(values, 'no-prompt') && transport.isHardware && process.stdin.isTTY === true);
  const readline = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;

  let stopRequested = false;
  const onSignal = (): void => {
    if (stopRequested) process.exit(EXIT_INTERRUPTED);
    stopRequested = true;
    out('');
    out('Stopping after the current unit. Everything finished so far is already on disk.');
  };
  process.on('SIGINT', onSignal);

  try {
    const summary = await runBatch({
      table,
      code,
      count,
      journalPath,
      transport,
      dryRun,
      protect,
      currentPassword: passwords?.current,
      newPassword: passwords?.next,
      ccPolicy: (str(values, 'cc-policy') as CcPolicy | undefined) ?? 'preserve',
      verifyAfterPowerCycle: bool(values, 'verify-after-power-cycle'),
      attemptsPerUnit: int(values, 'attempts', 2),
      maxFailures: int(values, 'max-failures', 10),
      tagTimeoutMs: int(values, 'tag-timeout-ms', 10_000),
      toolVersion: TOOL_VERSION,
      ...(str(values, 'operator') !== undefined ? { operator: str(values, 'operator') as string } : {}),
      shouldStop: () => stopRequested,
      beforeUnit: readline
        ? async (seq, total) => {
            await readline.question(`Present tag ${seq} of ${total}, then press Enter. `);
          }
        : undefined,
      onEvent: (event) => reportBatchEvent(event, out),
    });

    out(renderBatchSummary(summary));
    if (summary.interrupted) return EXIT_INTERRUPTED;
    return summary.complete ? EXIT_OK : EXIT_INCOMPLETE;
  } finally {
    process.off('SIGINT', onSignal);
    readline?.close();
  }
}

function reportBatchEvent(event: BatchEvent, out: (line: string) => void): void {
  switch (event.type) {
    case 'run-start': {
      const h = event.header;
      out('');
      out(rule());
      out(`${h.dryRun ? 'DRY RUN  ' : ''}${event.resuming ? 'RESUMING' : 'STARTING'}  ${h.code}  ${h.blendName}`);
      out(rule());
      out(`URL            ${h.uri}`);
      out(`Table          ${h.tablePath}`);
      out(`Table digest   ${h.tableDigest} (version ${h.tableVersion})`);
      out(`Units to do    ${event.remaining} of ${h.targetCount}`);
      out(`Transport      ${h.transport}${h.transportIsHardware ? '' : '  (simulated, no physical tags)'}`);
      out(`Protection     ${h.protectRequested ? `on, password fingerprint ${h.passwordFingerprint ?? 'unknown'}` : 'off'}`);
      out(`Journal        ${event.header.runId}`);
      out('');
      break;
    }
    case 'unit-done': {
      const r = event.record;
      if (r.outcome === 'failed') {
        out(`  ${String(r.seq).padStart(4)}  FAILED    ${r.error?.code ?? 'unknown'}: ${r.error?.message ?? ''}`);
        out(`        ${r.error?.remedy ?? ''}`);
      } else {
        out(`  ${String(r.seq).padStart(4)}  ${r.outcome.padEnd(9)} ${r.uri}  ${(r.durationMs / 1000).toFixed(2)} s`);
      }
      break;
    }
    case 'unit-retry':
      out(`  ${String(event.seq).padStart(4)}  retrying after attempt ${event.attempt}: ${event.error.message}`);
      break;
    default:
      break;
  }
}

function commandStatus(values: Record<string, unknown>, out: (line: string) => void): number {
  const path = str(values, 'journal');
  if (path === undefined) throw new ChipError('USAGE', 'status needs --journal.', 'For example: chip-cli status --journal runs/ps.jsonl', {});
  const parsed = readJournal(path);
  const state = resumeState(parsed, parsed.header.targetCount);
  const damaged = parsed.digestFailures.length > 0 || parsed.badLines > 0;

  if (bool(values, 'json')) {
    out(
      JSON.stringify(
        {
          header: parsed.header,
          done: state.done.length,
          remaining: state.remaining,
          previouslyFailed: state.previouslyFailed,
          truncatedTail: parsed.truncatedTail,
          badLines: parsed.badLines,
          digestFailures: parsed.digestFailures,
          resumable: !damaged,
          resumeCommand: damaged ? null : resumeCommand(parsed.header, path),
        },
        null,
        2,
      ),
    );
    if (damaged) return EXIT_FAILURE;
    return state.remaining.length === 0 ? EXIT_OK : EXIT_INCOMPLETE;
  }

  out('');
  out(`Journal        ${path}`);
  out(`Run            ${parsed.header.runId}, started ${parsed.header.startedAt}`);
  out(`Code           ${parsed.header.code}  ${parsed.header.blendName}`);
  out(`URL            ${parsed.header.uri}`);
  out(`Table digest   ${parsed.header.tableDigest}`);
  out(`Done           ${state.done.length} of ${parsed.header.targetCount}`);
  out(`Remaining      ${state.remaining.length}${state.remaining.length > 0 ? `: ${compactRanges(state.remaining)}` : ''}`);
  if (state.previouslyFailed.length > 0) {
    out(`Failed before  ${compactRanges(state.previouslyFailed)}`);
  }
  if (parsed.truncatedTail) {
    out('Note           the last line was incomplete, which is what an interrupted write looks like. It was ignored.');
  }
  if (parsed.badLines > 0) out(`Note           ${parsed.badLines} unreadable line(s) were ignored.`);
  // A digest failure is reported here rather than thrown, because status is the command an
  // operator runs to find out what is in a damaged file. runBatch is what refuses it.
  for (const failure of parsed.digestFailures) {
    out(
      `FAIL           line ${failure.line} (${failure.kind}${failure.seq === null ? '' : ` seq ${failure.seq}`}) ${failure.reason}.`,
    );
  }
  out('');
  if (damaged) {
    // Printed whether or not units remain. A damaged journal whose surviving lines happen
    // to add up to "done" is the worst case, not the safe one: it is the state in which a
    // forged line can claim a physical tag was written.
    out('Do not resume this journal. A record does not match its own digest, so the list of units already done cannot be trusted.');
    out('Count the tags physically written, then start a new run into a new journal file for the units that are left.');
    out('');
  } else if (state.remaining.length > 0) {
    for (const line of resumeCommand(parsed.header, path)) out(line);
    out('');
  }
  if (damaged) return EXIT_FAILURE;
  return state.remaining.length === 0 ? EXIT_OK : EXIT_INCOMPLETE;
}

async function commandDoctor(values: Record<string, unknown>, out: (line: string) => void): Promise<number> {
  const checks: { name: string; ok: boolean; note: string }[] = [];

  let table: RedirectTable | null = null;
  try {
    table = loadTable(values);
    checks.push({
      name: 'redirect table',
      ok: true,
      note: `${table.path}, version ${table.version}, digest ${table.digest}, ${table.encodable().length} encodable codes`,
    });
  } catch (cause) {
    checks.push({ name: 'redirect table', ok: false, note: asChipError(cause, 'TABLE_NOT_FOUND', '').message });
  }

  if (table !== null) {
    let allFit = true;
    for (const entry of table.encodable()) {
      try {
        planEncoding(entry.ndefUri as string);
      } catch {
        allFit = false;
      }
    }
    checks.push({
      name: 'every code fits the chip',
      ok: allFit,
      note: `${T5T_AREA_BYTES} byte area on a ${PART.totalBytes} byte ${PART.partNumber}`,
    });
  }

  const transport = buildTransport(values);
  let transportOk = false;
  let transportNote = '';
  try {
    await transport.open();
    await transport.close();
    transportOk = true;
    // Naming the reader matters on the first run: it is how the operator sees which of
    // several PC/SC interfaces was picked, and what to pass to --reader-name if wrong.
    const readerName = transport instanceof PcscTransport ? transport.readerName : null;
    transportNote = transport.isHardware
      ? `physical reader responded${readerName ? `: ${readerName}` : ''}`
      : 'simulator, no physical tags are written';
  } catch (cause) {
    transportNote = asChipError(cause, 'TRANSPORT_UNAVAILABLE', '').message;
  }
  checks.push({ name: `transport "${transport.name}"`, ok: transportOk, note: transportNote });

  if (bool(values, 'protect')) {
    try {
      const passwords = loadPasswords(values);
      checks.push({
        name: 'password',
        ok: true,
        note: `from ${passwords.origin}, fingerprint ${passwords.next.fingerprint()}, current is ${passwords.current.isFactoryDefault() ? 'the factory default' : `fingerprint ${passwords.current.fingerprint()}`}`,
      });
    } catch (cause) {
      checks.push({ name: 'password', ok: false, note: asChipError(cause, 'PASSWORD_MISSING', '').message });
    }
  }

  out('');
  for (const check of checks) {
    out(`  ${check.ok ? 'ok  ' : 'FAIL'}  ${check.name.padEnd(28)} ${check.note}`);
  }
  out('');
  const failed = checks.filter((c) => !c.ok).length;
  out(failed === 0 ? 'Ready.' : `${failed} check(s) failed. Fix them before writing tags.`);
  out('');
  return failed === 0 ? EXIT_OK : EXIT_FAILURE;
}

/* -------------------------------------------------------------------------- */

export interface MainOptions {
  readonly out?: (line: string) => void;
  readonly err?: (line: string) => void;
}

export async function main(argv: string[], io: MainOptions = {}): Promise<number> {
  const out = io.out ?? ((line: string) => process.stdout.write(`${line}\n`));
  const err = io.err ?? ((line: string) => process.stderr.write(`${line}\n`));

  try {
    const { values, positionals } = parse(argv);
    const command = positionals[0];

    if (bool(values, 'version')) {
      out(TOOL_VERSION);
      return EXIT_OK;
    }
    if (command === undefined || bool(values, 'help') || command === 'help') {
      out(USAGE);
      return command === undefined && !bool(values, 'help') ? EXIT_USAGE : EXIT_OK;
    }

    switch (command) {
      case 'codes':
        return commandCodes(values, out);
      case 'encode':
        return commandEncode(values, out);
      case 'decode':
        return commandDecode(values, out);
      case 'write':
        return await commandWrite(values, out);
      case 'verify':
        return await commandVerify(values, out);
      case 'batch':
        return await commandBatch(values, out);
      case 'status':
        return commandStatus(values, out);
      case 'doctor':
        return await commandDoctor(values, out);
      default:
        throw new ChipError('USAGE', `Unknown command "${command}".`, 'Run "chip-cli --help" for the command list.', { command });
    }
  } catch (cause) {
    const error = isChipError(cause)
      ? cause
      : asChipError(cause, 'USAGE', 'This is an unexpected failure. Report it with the message above.');
    err(renderError(error));
    if (error.code === 'USAGE') return EXIT_USAGE;
    if (error.code === 'INTERRUPTED') return EXIT_INTERRUPTED;
    return EXIT_FAILURE;
  }
}

export { FACTORY_DEFAULT_HEX };
