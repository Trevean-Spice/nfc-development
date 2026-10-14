/*
 * The `include` query parameter, in every shape a query parser might hand over.
 *
 * WHY THIS FILE EXISTS. `GET /v1/blends/{slug}?include=grower,recipes` returned 500 on the
 * deployed environment for every blend, because the handler did
 * `(request.query.include ?? '').split(',')` and the parser in front of it produced an array
 * rather than a string. `Array.prototype.split` does not exist, so it was a TypeError on the
 * one request the renderer makes for every blend on every publish. The first publish attempt
 * on real infrastructure failed on it.
 *
 * The local development server only ever produced the string, so the whole suite passed
 * against a shape production does not send. That is the actual defect this file guards: not
 * the missing branch, but the assumption that one parser's output is the only one.
 *
 * Found Monday 7 September 2026, by a Fargate render rather than by a test.
 */

import { describe, expect, it } from 'vitest';
import { parseInclude } from '../../src/http/validation.js';

describe('parseInclude', () => {
  it('reads the comma separated string the contract documents', () => {
    expect(parseInclude('grower,recipes')).toEqual(['grower', 'recipes']);
  });

  it('reads the array the deployed parser actually produced, which is the regression', () => {
    expect(parseInclude(['grower', 'recipes'])).toEqual(['grower', 'recipes']);
  });

  it('reads an array whose members are themselves comma separated', () => {
    expect(parseInclude(['grower,recipes'])).toEqual(['grower', 'recipes']);
  });

  it('treats absent, empty and whitespace as asking for nothing', () => {
    expect(parseInclude(undefined)).toEqual([]);
    expect(parseInclude('')).toEqual([]);
    expect(parseInclude('   ')).toEqual([]);
    expect(parseInclude([])).toEqual([]);
    expect(parseInclude(',,')).toEqual([]);
  });

  it('trims, because a parser that keeps spaces after commas is a fourth reading', () => {
    expect(parseInclude('grower, recipes')).toEqual(['grower', 'recipes']);
    expect(parseInclude([' grower ', ' recipes '])).toEqual(['grower', 'recipes']);
  });

  it('never throws on a shape nobody predicted, because a 500 here is the whole outage', () => {
    expect(() => parseInclude(null)).not.toThrow();
    expect(() => parseInclude(42)).not.toThrow();
    expect(() => parseInclude({ grower: true })).not.toThrow();
    expect(parseInclude(null)).toEqual([]);
  });
});
