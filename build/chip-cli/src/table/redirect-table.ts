/**
 * The redirect table, derived and never duplicated.
 *
 * `build/edge/redirect-table.json` is the single source of truth for what each code
 * maps to. This module reads it. It does not hold a copy of the codes, it does not
 * hold a copy of the URLs, and there is no fallback list to fall back to if the
 * file is missing: a tool that can encode tags without the table is a tool that can
 * encode the wrong URL onto 500 jars.
 *
 * The URI a tag carries is derived twice and cross checked. The table states it in
 * `ndefUri`, and it is also `origin` plus `requestPath`. If those two disagree the
 * table is corrupt and this module refuses to encode anything at all, rather than
 * picking one. That is the check that would have caught a hand edit.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChipError } from '../chip/errors.js';
import { PART } from '../chip/st25tv02kc.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * From dist/src/table/ back to the package root, then across to the edge package.
 * The path is relative so a checkout works wherever it sits.
 */
export const DEFAULT_TABLE_PATH = resolve(HERE, '..', '..', '..', '..', 'edge', 'redirect-table.json');

export interface TagCodeEntry {
  readonly code: string;
  readonly blendSlug: string;
  readonly blendName: string;
  readonly requestPath: string;
  /** The exact string written to the chip, or null when the code must not be encoded. */
  readonly ndefUri: string | null;
  readonly status: string;
  readonly unitsEncoded: number;
  readonly chipPartNumber: string | null;
  readonly supplierOrderRef: string | null;
  /** What the table records about protection. Null means unrecorded, not unprotected. */
  readonly writeProtected: boolean | null;
}

interface RawEntry {
  code?: unknown;
  blendSlug?: unknown;
  blendName?: unknown;
  requestPath?: unknown;
  ndefUri?: unknown;
  status?: unknown;
  unitsEncoded?: unknown;
  chipPartNumber?: unknown;
  supplierOrderRef?: unknown;
  writeProtected?: unknown;
}

function invalid(message: string, detail: Record<string, string | number | null> = {}): ChipError {
  return new ChipError(
    'TABLE_INVALID',
    message,
    'Do not write any tags. The redirect table is the source of truth and it is not currently trustworthy. Report this before continuing.',
    detail,
  );
}

export class RedirectTable {
  readonly version: number;
  readonly origin: string;
  readonly path: string;
  /** First 12 hex of the SHA-256 of the file, so a batch record names the table it used. */
  readonly digest: string;
  readonly #entries: readonly TagCodeEntry[];

  private constructor(args: {
    version: number;
    origin: string;
    path: string;
    digest: string;
    entries: readonly TagCodeEntry[];
  }) {
    this.version = args.version;
    this.origin = args.origin;
    this.path = args.path;
    this.digest = args.digest;
    this.#entries = args.entries;
  }

  static load(path: string = DEFAULT_TABLE_PATH): RedirectTable {
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch (cause) {
      throw new ChipError(
        'TABLE_NOT_FOUND',
        `The redirect table could not be read at ${path}.`,
        'Check the path. By default the tool looks for build/edge/redirect-table.json relative to this package. Pass --table to point it somewhere else.',
        { path, cause: cause instanceof Error ? cause.message : String(cause) },
      );
    }
    return RedirectTable.parse(raw, path);
  }

  static parse(raw: string, path: string): RedirectTable {
    const digest = createHash('sha256').update(raw).digest('hex').slice(0, 12);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (cause) {
      throw invalid(`The redirect table at ${path} is not valid JSON.`, {
        path,
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }
    if (typeof parsed !== 'object' || parsed === null) throw invalid('The redirect table is not an object.', { path });

    const table = parsed as { version?: unknown; origin?: unknown; entries?: unknown };
    if (typeof table.version !== 'number') throw invalid('The redirect table has no numeric version.', { path });
    if (typeof table.origin !== 'string' || table.origin.length === 0) {
      throw invalid('The redirect table has no origin.', { path });
    }
    if (!Array.isArray(table.entries) || table.entries.length === 0) {
      throw invalid('The redirect table has no entries.', { path });
    }

    const origin = table.origin.replace(/\/+$/, '');
    const entries: TagCodeEntry[] = [];
    const seen = new Set<string>();

    for (const [index, value] of table.entries.entries()) {
      if (typeof value !== 'object' || value === null) throw invalid(`Entry ${index} is not an object.`, { path });
      const row = value as RawEntry;

      const code = row.code;
      if (typeof code !== 'string' || !/^[a-z0-9]{1,8}$/.test(code)) {
        throw invalid(`Entry ${index} has an unusable code.`, { path, index });
      }
      if (seen.has(code)) throw invalid(`The code "${code}" appears more than once.`, { path, code });
      seen.add(code);

      const requestPath = row.requestPath;
      if (typeof requestPath !== 'string' || !requestPath.startsWith('/')) {
        throw invalid(`Entry "${code}" has an unusable requestPath.`, { path, code });
      }
      // The row's own code has to be the last segment of its own request path.
      // Without this the cross check below is satisfied by any edit that changes
      // requestPath and ndefUri together, which is what a hand edit looks like:
      // the row still agrees with itself while "ps" now carries the Caribbean
      // Sunset URL, and 250 Persian Sunrise jars open the wrong blend page.
      if (!requestPath.endsWith(`/${code}`)) {
        throw invalid(
          `Entry "${code}" has requestPath "${requestPath}", which does not end with "/${code}". ` +
            'The row names one code and routes another, so a tag written from it would resolve to a different blend than the row claims.',
          { path, code },
        );
      }

      const ndefUri = row.ndefUri === null || row.ndefUri === undefined ? null : row.ndefUri;
      if (ndefUri !== null && typeof ndefUri !== 'string') {
        throw invalid(`Entry "${code}" has a non string ndefUri.`, { path, code });
      }

      // The cross check. Two independent statements of the same fact must agree.
      if (ndefUri !== null) {
        const derived = `${origin}${requestPath}`;
        if (ndefUri !== derived) {
          throw invalid(
            `Entry "${code}" disagrees with itself: ndefUri is "${ndefUri}" but origin plus requestPath is "${derived}".`,
            { path, code },
          );
        }
      }

      const unitsEncoded = typeof row.unitsEncoded === 'number' ? row.unitsEncoded : 0;
      const status = typeof row.status === 'string' ? row.status : 'unknown';

      entries.push({
        code,
        blendSlug: typeof row.blendSlug === 'string' ? row.blendSlug : '',
        blendName: typeof row.blendName === 'string' ? row.blendName : '',
        requestPath,
        ndefUri,
        status,
        unitsEncoded,
        chipPartNumber: typeof row.chipPartNumber === 'string' ? row.chipPartNumber : null,
        supplierOrderRef: typeof row.supplierOrderRef === 'string' ? row.supplierOrderRef : null,
        writeProtected: typeof row.writeProtected === 'boolean' ? row.writeProtected : null,
      });
    }

    return new RedirectTable({ version: table.version, origin, path, digest, entries });
  }

  entries(): readonly TagCodeEntry[] {
    return this.#entries;
  }

  /** Codes this tool is willing to write. Derived from the data, not from a list of exceptions. */
  encodable(): readonly TagCodeEntry[] {
    return this.#entries.filter((e) => e.ndefUri !== null);
  }

  find(code: string): TagCodeEntry | undefined {
    return this.#entries.find((e) => e.code === code);
  }

  /**
   * The URI to write for a code, or a refusal.
   *
   * The refusal for a reserved code is not a special case for "kg". It is the rule
   * "a row with no ndefUri is not encodable", which happens to be true of Kyoto
   * Garden today and would be true of any future reserved blend without a code
   * change here.
   */
  uriFor(code: string): { entry: TagCodeEntry; uri: string } {
    const normalised = code.trim().toLowerCase();
    const entry = this.find(normalised);
    if (entry === undefined) {
      const known = this.encodable()
        .map((e) => e.code)
        .join(', ');
      throw new ChipError(
        'CODE_UNKNOWN',
        `"${code}" is not in the redirect table.`,
        `Use one of: ${known}. Run "chip-cli codes" to see them with their blends.`,
        { code, known },
      );
    }
    if (entry.ndefUri === null) {
      throw new ChipError(
        'CODE_NOT_ENCODABLE',
        `"${entry.code}" (${entry.blendName}) is marked "${entry.status}" in the redirect table and carries no URI to write.`,
        'Do not write this code onto anything. A tag carrying it produces a not found page at a customer kitchen counter. If this blend is now in production, the redirect table has to be updated and redeployed first.',
        { code: entry.code, status: entry.status, blend: entry.blendName },
      );
    }
    if (entry.chipPartNumber !== null && entry.chipPartNumber !== PART.partNumber) {
      throw new ChipError(
        'CODE_NOT_ENCODABLE',
        `The redirect table says "${entry.code}" is encoded on a ${entry.chipPartNumber}, and this tool only writes ${PART.partNumber}.`,
        'A different part means a different memory model. Stop and check which tags are in front of you.',
        { code: entry.code, chipPartNumber: entry.chipPartNumber },
      );
    }
    return { entry, uri: entry.ndefUri };
  }
}
