/**
 * Start the Tag Tool: find the reader, serve the page on this computer only, open
 * the browser on it, and keep going until the window is closed.
 *
 * What "Start Tag Tool.cmd" runs, after it has installed and built. The real reader
 * is the default here, which is the opposite of chip-cli, because the person
 * double clicking this has a reader on the desk and a stack of tags beside it.
 * --simulator is for rehearsing without either.
 */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ChipError, asChipError } from '../chip/errors.js';
import { TOOL_VERSION } from '../cli/main.js';
import { renderError } from '../cli/render.js';
import { DEFAULT_TABLE_PATH, RedirectTable } from '../table/redirect-table.js';
import { PcscTransport } from '../transport/pcsc.js';
import type { SimulatorFaultKind } from '../transport/simulator.js';
import type { TagTransport } from '../transport/transport.js';
import { BenchSimulator } from './bench-simulator.js';
import { TagToolController } from './controller.js';
import { DEFAULT_PORTS, probeExisting, startServer, type RunningServer } from './server.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** From dist/src/app back to the package root. runs/ is ignored by git. */
export const DEFAULT_JOURNAL_DIR = resolve(HERE, '..', '..', '..', 'runs', 'tag-tool');

const USAGE = `
Tag Tool, the easy way to write Trevean Spice tags

USAGE
  node bin/tag-tool.mjs [options]

Opens a page in your browser that shows the reader and the tag, and writes the
product code you choose to each tag, checking every one by reading it back. It
never locks a tag.

OPTIONS
  --reader-name <text>    Use the reader whose name contains this text
  --simulator             No reader, no tags: rehearse on a simulated bench
  --sim-fault <n>=<kind>  With --simulator, make simulated tag n fail. Kinds:
                          write-fail, write-partial, readback-fail,
                          readback-corrupt, geometry-mismatch
  --port <n>              Use this port only, instead of the first free one
                          from ${DEFAULT_PORTS[0]} to ${DEFAULT_PORTS[DEFAULT_PORTS.length - 1]}
  --no-open               Do not open the browser
  --table <path>          Redirect table. Default: the one in build/edge
  --journal-dir <path>    Where the record of every tag goes. Default: runs/tag-tool
`.trimStart();

export interface TagToolIo {
  readonly out?: (line: string) => void;
  readonly err?: (line: string) => void;
  /** Resolves when the tool should shut down. Defaults to Ctrl+C or the window closing. */
  readonly untilStopped?: (server: RunningServer) => Promise<void>;
  readonly openBrowser?: (url: string) => void;
  /** For tests: the ports tried in place of DEFAULT_PORTS. */
  readonly ports?: readonly number[];
}

/** Opens the default browser. Failure is not fatal: the address is printed anyway. */
export function openBrowser(url: string, onFail: () => void = () => undefined): void {
  try {
    const child =
      process.platform === 'win32'
        ? // "start" is a cmd built in. The empty title argument stops it reading the URL as a title.
          spawn('cmd.exe', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true })
        : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' });
    child.on('error', onFail);
    child.unref();
  } catch {
    onFail();
  }
}

function waitForSignal(): Promise<void> {
  return new Promise((resolveStop) => {
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    if (process.platform === 'win32') signals.push('SIGBREAK');
    const stop = (): void => {
      for (const s of signals) process.off(s, stop);
      resolveStop();
    };
    for (const s of signals) process.on(s, stop);
  });
}

function timeStamp(): string {
  const now = new Date();
  return [now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

/** The first port before `own` in `ports` with a Tag Tool on it, or null. Every port is asked at once. */
async function findEarlierCopy(own: number, ports: readonly number[]): Promise<number | null> {
  const index = ports.indexOf(own);
  const earlier = index === -1 ? ports : ports.slice(0, index);
  const answers = await Promise.all(earlier.map((port) => probeExisting(port)));
  return earlier.find((_, i) => answers[i]) ?? null;
}

export async function runTagTool(argv: string[], io: TagToolIo = {}): Promise<number> {
  const out = io.out ?? ((line: string) => process.stdout.write(`${line}\n`));
  const err = io.err ?? ((line: string) => process.stderr.write(`${line}\n`));

  let values: Record<string, unknown>;
  try {
    values = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        help: { type: 'boolean', short: 'h' },
        simulator: { type: 'boolean' },
        'sim-fault': { type: 'string', multiple: true },
        'reader-name': { type: 'string' },
        port: { type: 'string' },
        'no-open': { type: 'boolean' },
        table: { type: 'string' },
        'journal-dir': { type: 'string' },
      },
    }).values as Record<string, unknown>;
  } catch (cause) {
    err(cause instanceof Error ? cause.message : String(cause));
    err('Run "node bin/tag-tool.mjs --help" for the options.');
    return 1;
  }
  if (values.help === true) {
    out(USAGE);
    return 0;
  }

  try {
    let ports: readonly number[] = io.ports ?? DEFAULT_PORTS;
    if (typeof values.port === 'string') {
      const port = Number(values.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new ChipError('USAGE', `--port needs a port number. Got "${values.port}".`, 'For example: --port 10350', {});
      }
      ports = [port];
    }

    const table = RedirectTable.load(typeof values.table === 'string' ? values.table : DEFAULT_TABLE_PATH);
    const open = io.openBrowser ?? ((url: string) => openBrowser(url, () => out(`Could not open the browser. Open this address yourself: ${url}`)));

    // A second double click finds the first copy and shows it, rather than fighting
    // it for the reader.
    for (const port of ports) {
      if (await probeExisting(port)) {
        const url = `http://127.0.0.1:${port}/`;
        out(`The Tag Tool is already running at ${url}`);
        out('Opening it. You can close this window.');
        if (values['no-open'] !== true) open(url);
        return 0;
      }
    }

    const simulated = values.simulator === true;
    let bench: BenchSimulator | null = null;
    let pcsc: PcscTransport | null = null;
    let transport: TagTransport;
    if (simulated) {
      const faults: Record<number, SimulatorFaultKind> = {};
      const raw = values['sim-fault'];
      for (const spec of Array.isArray(raw) ? raw : []) {
        const [positionText, kind] = String(spec).split('=');
        const position = Number(positionText);
        if (!Number.isInteger(position) || position < 1 || kind === undefined) {
          throw new ChipError('USAGE', `--sim-fault wants <n>=<kind>. Got "${String(spec)}".`, 'For example: --sim-fault 3=write-fail', {});
        }
        faults[position] = kind as SimulatorFaultKind;
      }
      bench = new BenchSimulator({ faults });
      transport = bench;
    } else {
      pcsc = new PcscTransport(typeof values['reader-name'] === 'string' ? values['reader-name'] : undefined);
      transport = pcsc;
    }

    const controller = new TagToolController({
      transport,
      table,
      journalDir: typeof values['journal-dir'] === 'string' ? resolve(values['journal-dir']) : DEFAULT_JOURNAL_DIR,
      toolVersion: TOOL_VERSION,
      readerName: () => (bench !== null ? bench.readerName : (pcsc?.readerName ?? null)),
      ...(bench !== null
        ? { simulatorState: () => ({ readerConnected: (bench as BenchSimulator).readerConnected, tagPresent: (bench as BenchSimulator).tagPresent }) }
        : {}),
      log: (line) => out(`${timeStamp()}  ${line}`),
    });

    const server = await startServer({ controller, bench, ports, allowAnyPort: typeof values.port !== 'string' });

    // Two double clicks close together can both find nothing above and both start, one
    // port apart, and then both poll the one reader. So, now that this copy holds its
    // port and before it has touched the reader, it asks every port before its own
    // once more. The copy on the lowest port always wins: the other finds it here.
    //
    // Chosen over a lock file in the journal folder because a held port is let go by
    // the operating system however the process ends. Closing the black window ends
    // it without any clean up, so a lock file would be left behind every time, and
    // telling a stale one from a live one means trusting a process number that
    // Windows reuses. A lock file would also miss a copy given another --journal-dir.
    const earlier = await findEarlierCopy(server.port, ports);
    if (earlier !== null) {
      await server.close();
      const url = `http://127.0.0.1:${earlier}/`;
      out(`The Tag Tool is already running at ${url}`);
      out('Opening it. You can close this window.');
      if (values['no-open'] !== true) open(url);
      return 0;
    }
    controller.start();

    out('');
    out('Trevean Tag Tool');
    out('');
    out(`  The page is at ${server.url}`);
    out(simulated ? '  SIMULATOR: no reader is used and no real tag is written.' : '  Looking for the reader now.');
    out('  Keep this window open while you write tags. Close it, or press Ctrl+C, to stop.');
    out('');
    if (values['no-open'] !== true) open(server.url);

    await (io.untilStopped ?? waitForSignal)(server);

    out('');
    out('Stopping. Every tag written is already recorded.');
    await controller.stop();
    await server.close();
    return 0;
  } catch (cause) {
    const error = asChipError(cause, 'TRANSPORT_UNAVAILABLE', 'Close this window and start the Tag Tool again. If it repeats, report the message above.');
    err(renderError(error));
    return error.code === 'USAGE' ? 1 : 2;
  }
}
