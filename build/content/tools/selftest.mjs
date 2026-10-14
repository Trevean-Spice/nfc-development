#!/usr/bin/env node
/**
 * Self test.
 *
 * Runs the seeding tool against an in-memory stand-in for DynamoDB that speaks the
 * same wire protocol, twice, and asserts:
 *
 *   run 1: every item created
 *   run 2: every item unchanged     <- this is the idempotency claim, demonstrated
 *
 * Then asserts the production guard actually refuses, and that the readiness report
 * runs clean. No AWS access, no Docker, no npm install, no network.
 *
 * Usage: node tools/selftest.mjs
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/* --------------------------------------- an in-memory stand-in for DynamoDB */

function startStub() {
  const tables = new Map(); // name -> { KeySchema, items: Map(keyString -> item) }

  const keyOf = (table, item) =>
    JSON.stringify(table.KeySchema.map((k) => Object.values(item[k.AttributeName] ?? {})[0]));

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const target = String(req.headers['x-amz-target'] ?? '').split('.').pop();
      const auth = String(req.headers.authorization ?? '');
      const payload = body ? JSON.parse(body) : {};

      // The signature is not verified here, but its shape is: a request that never
      // went through the signer would not carry these.
      if (!auth.startsWith('AWS4-HMAC-SHA256 Credential=') || !req.headers['x-amz-date']) {
        return json(res, 400, { __type: 'InvalidSignatureException', message: 'unsigned request' });
      }

      switch (target) {
        case 'CreateTable': {
          tables.set(payload.TableName, { KeySchema: payload.KeySchema, items: new Map() });
          return json(res, 200, { TableDescription: { TableName: payload.TableName, TableStatus: 'ACTIVE' } });
        }
        case 'DescribeTable': {
          const t = tables.get(payload.TableName);
          if (!t) return json(res, 400, { __type: 'ResourceNotFoundException', message: 'not found' });
          return json(res, 200, { Table: { TableName: payload.TableName, TableStatus: 'ACTIVE' } });
        }
        case 'PutItem': {
          const t = tables.get(payload.TableName);
          if (!t) return json(res, 400, { __type: 'ResourceNotFoundException', message: 'not found' });
          const k = keyOf(t, payload.Item);
          const old = t.items.get(k) ?? null;
          t.items.set(k, payload.Item);
          return json(res, 200, old && payload.ReturnValues === 'ALL_OLD' ? { Attributes: old } : {});
        }
        case 'GetItem': {
          const t = tables.get(payload.TableName);
          if (!t) return json(res, 400, { __type: 'ResourceNotFoundException', message: 'not found' });
          const k = JSON.stringify(t.KeySchema.map((s) => Object.values(payload.Key[s.AttributeName])[0]));
          return json(res, 200, t.items.has(k) ? { Item: t.items.get(k) } : {});
        }
        case 'ListTables':
          return json(res, 200, { TableNames: [...tables.keys()] });
        default:
          return json(res, 400, { __type: 'UnknownOperationException', message: target });
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, tables }));
  });
}

function json(res, status, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/x-amz-json-1.0', 'content-length': Buffer.byteLength(b) });
  res.end(b);
}

/* ------------------------------------------------------------------ runner */

function run(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: ROOT });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
  });
}

let failures = 0;
function check(label, condition, detail = '') {
  console.log(`${condition ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!condition) {
    failures++;
    if (detail) console.log(detail.split('\n').map((l) => '        ' + l).join('\n'));
  }
}

const { server, port, tables } = await startStub();
const endpoint = `http://127.0.0.1:${port}`;

const first = await run(['tools/seed-dynamodb.mjs', '--env', 'local', '--endpoint-url', endpoint, '--create-tables']);
check('first seed run exits 0', first.code === 0, first.out);
const createdMatch = first.out.match(/created (\d+), updated (\d+), unchanged (\d+), total (\d+)/);
check('first run creates every item', createdMatch && createdMatch[1] === createdMatch[4], first.out);

const second = await run(['tools/seed-dynamodb.mjs', '--env', 'local', '--endpoint-url', endpoint]);
const secondMatch = second.out.match(/created (\d+), updated (\d+), unchanged (\d+), total (\d+)/);
check('second seed run exits 0', second.code === 0, second.out);
check(
  'second run reports every item unchanged, so the tool is idempotent',
  secondMatch && secondMatch[3] === secondMatch[4] && secondMatch[1] === '0',
  second.out,
);

const stored = [...tables.values()].reduce((n, t) => n + t.items.size, 0);
check('rows in the store equal the item count', createdMatch && stored === Number(createdMatch[4]), `stored ${stored}`);

const prod = await run(['tools/seed-dynamodb.mjs', '--env', 'production', '--region', 'us-east-1']);
check('production seeding of placeholder content is refused', prod.code === 1 && prod.out.includes('REFUSED'), prod.out);
check('the refusal explains why, not just that', prod.out.includes('already in the field'), prod.out);

const overrideNoReason = await run([
  'tools/seed-dynamodb.mjs', '--env', 'production', '--allow-placeholder-in-production', '--yes',
]);
check('the production override without a reason is refused', overrideNoReason.code === 1, overrideNoReason.out);

const mismatched = await run(['tools/seed-dynamodb.mjs', '--env', 'production', '--endpoint-url', endpoint, '--allow-placeholder-in-production', '--reason', 'x', '--yes']);
check('a production run pointed at a local endpoint is refused', mismatched.code === 1, mismatched.out);

const readiness = await run(['tools/content-readiness.mjs', '--format', 'json']);
check('readiness report runs clean, no integrity problems', readiness.code === 0, readiness.out.slice(-800));
const report = JSON.parse(readiness.out);
check('readiness report finds placeholder fields', report.summary.fieldsPlaceholder > 0);
check('readiness report finds no unflagged fields', report.integrity.length === 0, report.integrity.join('\n'));

const failOn = await run(['tools/content-readiness.mjs', '--fail-on-placeholder']);
check('--fail-on-placeholder exits 1 while content is outstanding', failOn.code === 1);

server.close();
console.log('');
console.log(failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
