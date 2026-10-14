import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { config } from './config.js';
import { isRole, type Role } from './auth/roles.js';

/**
 * The frozen contract, read at startup.
 *
 * Every minimum role in this application comes from the `x-minimum-role` extension on the
 * operation in the OpenAPI document. Nothing retypes it. A contract frozen for seven weeks
 * with an authorisation table hand written beside it drifts silently, and the drift is not
 * visible until somebody who should not be able to publish, publishes.
 *
 * The same reasoning as the API's decision to compile its request validation from this
 * document rather than restating it in TypeScript.
 */

export interface Operation {
  operationId: string;
  method: string;
  path: string;
  minimumRole: Role | null;
  summary: string;
}

interface ContractDocument {
  info: { version: string; title: string };
  paths: Record<string, Record<string, unknown>>;
}

const HTTP_METHODS = ['get', 'post', 'patch', 'put', 'delete'];

export class Contract {
  readonly version: string;
  readonly title: string;
  readonly operations: Map<string, Operation> = new Map();

  constructor(document: ContractDocument) {
    this.version = document.info?.version ?? 'unknown';
    this.title = document.info?.title ?? 'unknown';

    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const method of HTTP_METHODS) {
        const op = (item as Record<string, unknown>)[method] as Record<string, unknown> | undefined;
        if (!op) continue;
        const operationId = typeof op['operationId'] === 'string' ? op['operationId'] : undefined;
        if (!operationId) continue;
        const raw = op['x-minimum-role'];
        this.operations.set(operationId, {
          operationId,
          method: method.toUpperCase(),
          path,
          minimumRole: isRole(raw) ? raw : null,
          summary: typeof op['summary'] === 'string' ? op['summary'] : '',
        });
      }
    }
  }

  operation(operationId: string): Operation {
    const op = this.operations.get(operationId);
    if (!op) {
      // A typo in an operation id must not silently become an unguarded route.
      throw new Error(
        `Operation '${operationId}' is not in the frozen contract. The admin does not invent endpoints.`,
      );
    }
    return op;
  }

  /**
   * The minimum role for an operation. An admin operation with no declared minimum role is
   * refused rather than defaulted, because defaulting an authorisation rule is how an admin
   * write endpoint ends up reachable by an under privileged caller.
   */
  minimumRole(operationId: string): Role {
    const op = this.operation(operationId);
    if (op.minimumRole) return op.minimumRole;
    if (op.path.startsWith('/v1/admin/')) {
      throw new Error(
        `Operation '${operationId}' is an admin operation with no x-minimum-role in the contract.`,
      );
    }
    return 'Viewer';
  }

  adminOperations(): Operation[] {
    return [...this.operations.values()]
      .filter((op) => op.path.startsWith('/v1/admin/'))
      .sort((a, b) => (a.path === b.path ? a.method.localeCompare(b.method) : a.path.localeCompare(b.path)));
  }
}

let cached: Contract | undefined;

export function contract(): Contract {
  if (!cached) cached = loadContract(config.contractPath);
  return cached;
}

export function loadContract(path: string): Contract {
  const text = readFileSync(path, 'utf8');
  return new Contract(parse(text) as ContractDocument);
}

/** Test seam. Never called by the running application. */
export function setContract(value: Contract | undefined): void {
  cached = value;
}
