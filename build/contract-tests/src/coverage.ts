// Tracks which operations and which declared status codes the run actually exercised.
//
// A contract test suite that silently stops calling an endpoint is worse than no suite,
// because it still reports green. The coverage suite turns that into a failure.

import { operationList, type OperationContract } from './spec.js';

const exercised = new Map<string, Set<number>>();

export function record(operationId: string, status: number): void {
  let statuses = exercised.get(operationId);
  if (!statuses) {
    statuses = new Set<number>();
    exercised.set(operationId, statuses);
  }
  statuses.add(status);
}

export function exercisedOperationIds(): string[] {
  return [...exercised.keys()].sort();
}

export function statusesFor(operationId: string): number[] {
  return [...(exercised.get(operationId) ?? [])].sort((a, b) => a - b);
}

export function unexercisedOperations(): OperationContract[] {
  return operationList.filter((op) => !exercised.has(op.operationId));
}

/**
 * Statuses no contract test may provoke on a shared host. A rate limiter enforced at the
 * CDN and WAF layer, an upstream failure, a deliberate shed and an unhandled exception are
 * incidents, not test cases. Their envelope shape is checked by schema instead.
 */
export const NOT_PROVOKED_BY_DESIGN = [429, 500, 502, 503, 504];

/**
 * Statuses the frozen contract declares but which no caller can reach as the document
 * currently stands. Each one is a finding for the change control process in section 11,
 * not a gap in this suite. They are listed here so the coverage number is honest.
 */
export const STRUCTURALLY_UNREACHABLE: Array<{ operationId: string; status: number; reason: string }> = [
  {
    operationId: 'adminCreateBlend',
    status: 201,
    reason:
      'BlendCreate.slug references the Slug enum, which is closed to the five blends that already ' +
      'exist, so a create can only ever answer 409 SLUG_TAKEN.',
  },
  {
    operationId: 'adminCreateRecipe',
    status: 404,
    reason:
      'RecipeCreate.blendSlug references the same closed Slug enum, so a blend that does not exist ' +
      'cannot be named in a valid request.',
  },
  {
    operationId: 'adminListBlends',
    status: 403,
    reason: 'Minimum role is Viewer, which is the lowest role, so no authenticated caller is below it.',
  },
  {
    operationId: 'adminGetBlend',
    status: 403,
    reason: 'Minimum role is Viewer, the lowest role.',
  },
  {
    operationId: 'adminListMedia',
    status: 403,
    reason: 'Minimum role is Viewer, the lowest role.',
  },
  {
    operationId: 'adminGetMedia',
    status: 403,
    reason: 'Minimum role is Viewer, the lowest role.',
  },
  {
    operationId: 'adminGetScanTimeSeries',
    status: 403,
    reason: 'Minimum role is Viewer, the lowest role.',
  },
];

export interface StatusGap {
  operationId: string;
  status: number;
}

/** Declared statuses that were not observed and have no documented reason. Must be empty. */
export function unexplainedStatusGaps(): StatusGap[] {
  const gaps: StatusGap[] = [];
  for (const op of operationList) {
    const seen = new Set(statusesFor(op.operationId));
    for (const status of op.declaredStatuses) {
      if (seen.has(status)) continue;
      if (NOT_PROVOKED_BY_DESIGN.includes(status)) continue;
      if (
        STRUCTURALLY_UNREACHABLE.some(
          (entry) => entry.operationId === op.operationId && entry.status === status,
        )
      ) {
        continue;
      }
      gaps.push({ operationId: op.operationId, status });
    }
  }
  return gaps;
}

export interface CoverageReport {
  totalOperations: number;
  exercisedOperations: number;
  totalDeclaredStatuses: number;
  observedDeclaredStatuses: number;
  lines: string[];
}

export function report(): CoverageReport {
  const lines: string[] = [];
  let totalDeclaredStatuses = 0;
  let observedDeclaredStatuses = 0;

  for (const op of operationList) {
    const seen = new Set(statusesFor(op.operationId));
    totalDeclaredStatuses += op.declaredStatuses.length;
    const observedHere = op.declaredStatuses.filter((status) => seen.has(status));
    observedDeclaredStatuses += observedHere.length;
    const mark = seen.size > 0 ? 'yes' : 'NO ';
    lines.push(
      `  ${mark}  ${op.method.toUpperCase().padEnd(6)} ${op.path.padEnd(38)} ` +
        `${op.operationId.padEnd(26)} statuses seen [${[...seen].sort((a, b) => a - b).join(', ')}] ` +
        `of declared [${op.declaredStatuses.join(', ')}]`,
    );
  }

  return {
    totalOperations: operationList.length,
    exercisedOperations: exercised.size,
    totalDeclaredStatuses,
    observedDeclaredStatuses,
    lines,
  };
}
