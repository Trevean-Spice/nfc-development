/*
 * A DynamoDB table in memory, for the catalog sync tests.
 *
 * It evaluates the condition and update expressions it is given rather than trusting the
 * caller, so a test proves what the expression the writer built actually does. It
 * understands exactly the subset the writer emits and THROWS on anything else, so a
 * future change to a REMOVE, an ADD or an OR fails here instead of passing vacuously.
 */

import type { AttributeValue, CatalogTable, GetItemInput, Item, UpdateItemInput } from '../../src/sync/catalogWriter.js';

function keyOf(key: Item): string {
  const pk = key['pk'];
  const sk = key['sk'];
  if (!pk || !('S' in pk) || !sk || !('S' in sk)) throw new Error('memory table: key must be { pk: {S}, sk: {S} }');
  return `${pk.S}|${sk.S}`;
}

function same(a: AttributeValue | undefined, b: AttributeValue | undefined): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export class ConditionalCheckFailed extends Error {
  override name = 'ConditionalCheckFailedException';
}

export class MemoryTable implements CatalogTable {
  readonly items = new Map<string, Item>();
  readonly gets: GetItemInput[] = [];
  readonly updates: UpdateItemInput[] = [];
  /** Runs before each update is applied: simulate a concurrent writer, or throw. */
  beforeUpdate: ((input: UpdateItemInput, table: MemoryTable) => void) | undefined;
  /** Runs before each get: throw to simulate a read failure. */
  beforeGet: ((input: GetItemInput) => void) | undefined;

  put(item: Item): void {
    this.items.set(keyOf(item), structuredClone(item));
  }

  item(pk: string, sk = 'v0'): Item | undefined {
    const found = this.items.get(`${pk}|${sk}`);
    return found ? structuredClone(found) : undefined;
  }

  snapshot(): string {
    return JSON.stringify([...this.items.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }

  async getItem(input: GetItemInput): Promise<{ Item?: Item }> {
    this.gets.push(structuredClone(input));
    this.beforeGet?.(input);
    const found = this.items.get(keyOf(input.Key));
    return found ? { Item: structuredClone(found) } : {};
  }

  async updateItem(input: UpdateItemInput): Promise<unknown> {
    this.updates.push(structuredClone(input));
    this.beforeUpdate?.(input, this);
    const k = keyOf(input.Key);
    const existing = this.items.get(k);
    const names = input.ExpressionAttributeNames;
    const values = input.ExpressionAttributeValues;
    const name = (token: string) => {
      const n = names[token];
      if (!n) throw new Error(`memory table: unknown name ${token}`);
      return n;
    };
    const value = (token: string) => {
      const v = values[token];
      if (!v) throw new Error(`memory table: unknown value ${token}`);
      return v;
    };

    for (const clause of input.ConditionExpression.split(' AND ').map((c) => c.trim())) {
      let ok: boolean;
      let m: RegExpMatchArray | null;
      if ((m = clause.match(/^attribute_exists\((#\w+)\)$/))) {
        ok = existing !== undefined && name(m[1]!) in existing;
      } else if ((m = clause.match(/^begins_with\((#\w+), (:\w+)\)$/))) {
        const attr = existing?.[name(m[1]!)];
        const prefix = value(m[2]!);
        ok = !!attr && 'S' in attr && 'S' in prefix && attr.S.startsWith(prefix.S);
      } else if ((m = clause.match(/^(#\w+) = (:\w+)$/))) {
        ok = same(existing?.[name(m[1]!)], value(m[2]!));
      } else {
        throw new Error(`memory table: unsupported condition clause ${JSON.stringify(clause)}`);
      }
      if (!ok) throw new ConditionalCheckFailed('The conditional request failed');
    }

    if (!input.UpdateExpression.startsWith('SET ')) {
      throw new Error(`memory table: only SET is supported, got ${input.UpdateExpression}`);
    }
    const next: Item = structuredClone(existing ?? { ...input.Key });
    for (const assignment of input.UpdateExpression.slice(4).split(', ')) {
      const m = assignment.match(/^(#\w+) = (:\w+)$/);
      if (!m) throw new Error(`memory table: unsupported assignment ${JSON.stringify(assignment)}`);
      next[name(m[1]!)] = structuredClone(value(m[2]!));
    }
    this.items.set(k, next);
    return {};
  }
}
