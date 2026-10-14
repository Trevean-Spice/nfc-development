import { config } from '../config/env.js';

/**
 * Structured logging, with a redaction rule that is not optional.
 *
 * No IP address, no user agent and no free text from a request body ever reaches a log
 * line. The Architecture document, "Security and privacy", says no IP storage, and a log
 * file is storage. The scan beacon in particular carries only enums, bounded strings and
 * numbers, so there is nothing in it that needs redacting, and this guard exists to keep
 * it that way when somebody adds a field in a hurry.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type Level = keyof typeof LEVELS;

/**
 * Keys that must never be logged. Matched case insensitively against the leaf key name.
 * x-forwarded-for and the CloudFront viewer address headers are the ones that actually
 * turn up by accident, because they ride along on a request object somebody logs whole.
 */
const FORBIDDEN_KEYS = new Set([
  'ip',
  'clientip',
  'sourceip',
  'remoteaddress',
  'remoteaddr',
  'x-forwarded-for',
  'xforwardedfor',
  'x-real-ip',
  'cloudfront-viewer-address',
  'user-agent',
  'useragent',
  'authorization',
  'cookie',
  'set-cookie',
  'email',
  'password',
  'token',
  'secret',
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(k.toLowerCase())) {
      out[k] = '[redacted]';
      continue;
    }
    out[k] = redact(v, depth + 1);
  }
  return out;
}

export interface LogFields {
  [key: string]: unknown;
}

export interface Logger {
  child(fields: LogFields): Logger;
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
}

type Sink = (line: string) => void;

let sink: Sink = (line) => process.stdout.write(`${line}\n`);

/** Test seam, so the suite can assert on what is and is not written. */
export function setLogSink(next: Sink): void {
  sink = next;
}

class JsonLogger implements Logger {
  constructor(private readonly base: LogFields = {}) {}

  child(fields: LogFields): Logger {
    return new JsonLogger({ ...this.base, ...fields });
  }

  private write(level: Level, msg: string, fields?: LogFields): void {
    if (LEVELS[level] < LEVELS[config.log.level]) return;
    const line = {
      level,
      time: new Date().toISOString(),
      msg,
      ...(redact({ ...this.base, ...fields }) as LogFields),
    };
    sink(JSON.stringify(line));
  }

  debug(msg: string, fields?: LogFields): void {
    this.write('debug', msg, fields);
  }
  info(msg: string, fields?: LogFields): void {
    this.write('info', msg, fields);
  }
  warn(msg: string, fields?: LogFields): void {
    this.write('warn', msg, fields);
  }
  error(msg: string, fields?: LogFields): void {
    this.write('error', msg, fields);
  }
}

export const logger: Logger = new JsonLogger({ service: 'tap-to-story-api', stage: config.stage });

export const __testing = { redact, FORBIDDEN_KEYS };
