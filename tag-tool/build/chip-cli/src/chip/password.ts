/**
 * The ST25TV02KC area password: 64 bits, eight bytes, sixteen hexadecimal characters.
 *
 * How the model works, in plain terms:
 *
 *   - Present the correct password and the area accepts writes for that session.
 *   - Power the tag down and it is protected again.
 *   - Holding the password you can change the protection state, and you can change
 *     the password itself.
 *
 * This is not an NTAG lock bit. It is reversible if you hold the password, which
 * moves the entire risk from permanence to custody. There is no reset, no master
 * key and no recovery service, so a lost password freezes the tag exactly as if it
 * had been fused shut.
 *
 * Custody rules this file enforces mechanically rather than documenting:
 *
 *   - A password is never accepted on the command line. Process arguments are
 *     visible to every other process on the machine and end up in shell history.
 *     It comes from an environment variable or a file.
 *   - `toString` and `toJSON` return a fingerprint, never the value. That is what
 *     stops a password reaching the batch journal through an ordinary
 *     `JSON.stringify` of a record that happens to hold one.
 *   - The factory default of sixteen zeros is accepted as the password a tag
 *     currently has, and refused as a password to set. Setting it protects nothing.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import { ChipError } from './errors.js';

export const PASSWORD_BITS = 64;
export const PASSWORD_BYTES = 8;
export const PASSWORD_HEX_CHARS = 16;

/** Sixteen zeros: what an ST25 part ships with, and what "no protection" looks like. */
export const FACTORY_DEFAULT_HEX = '0'.repeat(PASSWORD_HEX_CHARS);

const HEX_PATTERN = /^[0-9a-fA-F]{16}$/;

export type PasswordRole = 'current' | 'new';

export class TagPassword {
  readonly #bytes: Uint8Array;

  private constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
  }

  static fromHex(hex: string, role: PasswordRole): TagPassword {
    const trimmed = hex.trim();
    if (!HEX_PATTERN.test(trimmed)) {
      throw new ChipError(
        'PASSWORD_INVALID',
        `A tag password is ${PASSWORD_BITS} bits, written as exactly ${PASSWORD_HEX_CHARS} hexadecimal characters. Got ${trimmed.length} character(s).`,
        'Correct the password source. The value is not printed here on purpose.',
        { expectedHexChars: PASSWORD_HEX_CHARS, gotLength: trimmed.length, role },
      );
    }
    const normalised = trimmed.toLowerCase();

    if (role === 'new') {
      if (normalised === FACTORY_DEFAULT_HEX) {
        throw new ChipError(
          'PASSWORD_INVALID',
          'That is the factory default password of sixteen zeros.',
          'Choose a real password. Protecting an area with the factory default protects nothing, since it is the value every attacker tries first.',
          { role },
        );
      }
      if (/^(.)\1{15}$/.test(normalised)) {
        throw new ChipError(
          'PASSWORD_INVALID',
          'That password is a single repeated character.',
          'Choose a real password. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(8).toString(\'hex\'))"',
          { role },
        );
      }
    }

    return new TagPassword(Uint8Array.from(Buffer.from(normalised, 'hex')));
  }

  static fromBytes(bytes: Uint8Array, role: PasswordRole): TagPassword {
    if (bytes.length !== PASSWORD_BYTES) {
      throw new ChipError(
        'PASSWORD_INVALID',
        `A tag password is ${PASSWORD_BYTES} bytes. Got ${bytes.length}.`,
        'Correct the password source.',
        { role, gotBytes: bytes.length },
      );
    }
    return TagPassword.fromHex(Buffer.from(bytes).toString('hex'), role);
  }

  /** The factory default, the only password a tag that has never been protected holds. */
  static factoryDefault(): TagPassword {
    return new TagPassword(new Uint8Array(PASSWORD_BYTES));
  }

  /** A copy, so nothing outside this class can mutate the stored value. */
  toBytes(): Uint8Array {
    return this.#bytes.slice();
  }

  isFactoryDefault(): boolean {
    return this.#bytes.every((b) => b === 0);
  }

  /**
   * The first eight hex characters of the SHA-256 of the password.
   *
   * Enough to prove two runs used the same password, or that the password in the
   * secret store is the one in the batch record. Not enough to recover it.
   */
  fingerprint(): string {
    return createHash('sha256').update(this.#bytes).digest('hex').slice(0, 8);
  }

  equals(other: TagPassword): boolean {
    return timingSafeEqual(Buffer.from(this.#bytes), Buffer.from(other.#bytes));
  }

  toString(): string {
    return `[ST25TV02KC 64 bit password, fingerprint ${this.fingerprint()}]`;
  }

  /** Guarantees a password cannot reach a journal, a log line or an error report. */
  toJSON(): string {
    return this.toString();
  }
}

export interface PasswordSource {
  /** Name of an environment variable holding sixteen hex characters. */
  readonly env?: string | undefined;
  /** Path to a file whose entire contents are sixteen hex characters. */
  readonly file?: string | undefined;
}

export interface LoadedPassword {
  readonly password: TagPassword;
  /** Where it came from, for the batch record. Never the value. */
  readonly origin: string;
}

/**
 * Loads a password from an environment variable or a file.
 *
 * Deliberately has no branch that reads a password from argv. See the file header.
 */
export function loadPassword(
  source: PasswordSource,
  role: PasswordRole,
  readFile: (path: string) => string,
  env: NodeJS.ProcessEnv = process.env,
): LoadedPassword {
  if (source.env !== undefined && source.file !== undefined) {
    throw new ChipError(
      'USAGE',
      'Two password sources were given.',
      'Give exactly one of --password-env or --password-file.',
      { role },
    );
  }
  if (source.env !== undefined) {
    const raw = env[source.env];
    if (raw === undefined || raw.trim().length === 0) {
      throw new ChipError(
        'PASSWORD_MISSING',
        `The environment variable ${source.env} is not set or is empty.`,
        `Set ${source.env} from the managed secret store before running with protection enabled.`,
        { variable: source.env, role },
      );
    }
    return { password: TagPassword.fromHex(raw, role), origin: `environment variable ${source.env}` };
  }
  if (source.file !== undefined) {
    let raw: string;
    try {
      raw = readFile(source.file);
    } catch (cause) {
      throw new ChipError(
        'PASSWORD_MISSING',
        `The password file ${source.file} could not be read.`,
        'Check the path, and check that the operator account can read it.',
        { path: source.file, role, cause: cause instanceof Error ? cause.message : String(cause) },
      );
    }
    return { password: TagPassword.fromHex(raw, role), origin: `file ${source.file}` };
  }
  throw new ChipError(
    'PASSWORD_MISSING',
    'Write protection was requested but no password source was given.',
    'Add --password-env TREVEAN_TAG_PASSWORD, or --password-file with a path. There is no --password flag on purpose: command line arguments are visible to other processes.',
    { role },
  );
}
