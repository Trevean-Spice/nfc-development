import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';

/**
 * An append only record of the decisions that are hard to undo.
 *
 * Three kinds of entry: a publish, a manual revalidation, and a placeholder override. The
 * third is the reason this file exists. An override is a person deciding, in writing, that
 * content which is not real may go to a page a thousand shipped jars point at. That is a
 * decision somebody has to be able to find afterwards, with a name against it.
 *
 * Written as one JSON object per line so it survives being tailed, grepped and pasted into
 * a message, and so a partial write never corrupts what came before.
 */

export interface AuditEntry {
  at: string;
  event: 'publish' | 'publish_blocked' | 'placeholder_override' | 'revalidate' | 'role_change' | 'sign_in';
  subject: string;
  email: string;
  role: string;
  slug?: string;
  detail: Record<string, unknown>;
}

const memory: AuditEntry[] = [];

export function record(entry: Omit<AuditEntry, 'at'>): AuditEntry {
  const full: AuditEntry = { at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), ...entry };
  memory.push(full);
  try {
    mkdirSync(dirname(config.audit.file), { recursive: true });
    appendFileSync(config.audit.file, `${JSON.stringify(full)}\n`, 'utf8');
  } catch {
    // A failed audit write must not fail the action that produced it, but it must not be
    // invisible either. The in memory copy is what the audit screen renders.
  }
  return full;
}

export function recent(limit = 50): AuditEntry[] {
  return memory.slice(-limit).reverse();
}

/** Test seam. */
export function clearAudit(): void {
  memory.length = 0;
}
