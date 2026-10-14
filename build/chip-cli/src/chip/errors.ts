/**
 * Typed errors for the chip tooling.
 *
 * Every failure the operator can hit has a code here, and every code has an entry
 * in the README section "If something goes wrong". A failure with no code is a bug
 * in this tool, not an operator mistake, and it is reported as one.
 */

export type ChipErrorCode =
  // Redirect table
  | 'TABLE_NOT_FOUND'
  | 'TABLE_INVALID'
  | 'CODE_UNKNOWN'
  | 'CODE_NOT_ENCODABLE'
  // NDEF and memory
  | 'NDEF_ENCODE'
  | 'NDEF_DECODE'
  | 'CAPACITY_EXCEEDED'
  // Transport and tag
  | 'TRANSPORT_UNAVAILABLE'
  | 'TAG_ABSENT'
  | 'TAG_NOT_ST25TV02KC'
  | 'TAG_CHANGED'
  | 'WRITE_FAILED'
  | 'READBACK_FAILED'
  | 'READBACK_MISMATCH'
  // Protection
  | 'PROTECT_BEFORE_VERIFY'
  | 'RECEIPT_INVALID'
  | 'PROTECT_FAILED'
  | 'AREA_PROTECTED'
  | 'PASSWORD_MISSING'
  | 'PASSWORD_INVALID'
  | 'PASSWORD_REJECTED'
  // Batch
  | 'JOURNAL_CORRUPT'
  | 'JOURNAL_MISMATCH'
  | 'BATCH_INCOMPLETE'
  | 'INTERRUPTED'
  // Operator input
  | 'USAGE';

export interface ChipErrorDetail {
  readonly [key: string]: string | number | boolean | null;
}

/**
 * The single error type this package throws. `code` drives the process exit code
 * and the README lookup; `remedy` is what the operator should actually do.
 */
export class ChipError extends Error {
  readonly code: ChipErrorCode;
  readonly remedy: string;
  readonly detail: ChipErrorDetail;

  constructor(code: ChipErrorCode, message: string, remedy: string, detail: ChipErrorDetail = {}) {
    super(message);
    this.name = 'ChipError';
    this.code = code;
    this.remedy = remedy;
    this.detail = detail;
  }

  toJSON(): Record<string, unknown> {
    return { code: this.code, message: this.message, remedy: this.remedy, detail: this.detail };
  }
}

export function isChipError(value: unknown): value is ChipError {
  return value instanceof ChipError;
}

/**
 * Wraps anything thrown by the runtime or by a reader implementation so a batch
 * record always carries a code. An unknown failure is never swallowed and never
 * reported as a pass.
 */
export function asChipError(value: unknown, fallback: ChipErrorCode, remedy: string): ChipError {
  if (isChipError(value)) return value;
  const message = value instanceof Error ? value.message : String(value);
  return new ChipError(fallback, message, remedy, { wrapped: true });
}
