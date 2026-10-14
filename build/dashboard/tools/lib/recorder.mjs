/**
 * A recording proxy in front of the local DynamoDB.
 *
 * This exists for one assertion, and it is the assertion this deliverable most needs to be
 * able to make: that no dashboard path issues a table scan. Asserting it by reading the
 * source proves that nobody wrote the word Scan today. Asserting it here proves that a full
 * dashboard load, through the real API, over the real key schema, issued only bounded
 * partition queries against rollup partitions, and would still prove it if somebody
 * introduced a scan three layers down in a repository this package does not own.
 *
 * The API is pointed at this proxy instead of at the database. Every operation, its target,
 * its table and its key condition are captured on the way through.
 */

import http from 'node:http';

export function createRecordingProxy(upstreamPort, upstreamHost = '127.0.0.1') {
  const operations = [];

  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      record(operations, request.headers['x-amz-target'], body);

      const headers = { ...request.headers, host: `${upstreamHost}:${upstreamPort}` };
      const forwarded = http.request(
        { host: upstreamHost, port: upstreamPort, method: request.method, path: request.url, headers },
        (upstream) => {
          response.writeHead(upstream.statusCode ?? 500, upstream.headers);
          upstream.pipe(response);
        },
      );
      forwarded.on('error', (error) => {
        response.writeHead(502, { 'content-type': 'text/plain' });
        response.end(String(error && error.message ? error.message : error));
      });
      forwarded.end(body);
    });
  });

  return {
    server,
    operations,
    reset() {
      operations.length = 0;
    },
    /** Every operation recorded since the last reset, in order. */
    all() {
      return operations.slice();
    },
    /** Operations whose name matches, for example "Scan" or "Query". */
    named(name) {
      return operations.filter((operation) => operation.operation === name);
    },
    against(tableName) {
      return operations.filter((operation) => operation.table === tableName);
    },
    listen(port, host = '127.0.0.1') {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve(server.address().port));
      });
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

function record(operations, target, body) {
  const name = typeof target === 'string' ? target.split('.').pop() : 'Unknown';
  let parsed = null;
  try {
    parsed = body.length > 0 ? JSON.parse(body.toString('utf8')) : null;
  } catch {
    parsed = null;
  }
  operations.push({
    operation: name ?? 'Unknown',
    table: parsed && typeof parsed.TableName === 'string' ? parsed.TableName : null,
    indexName: parsed && typeof parsed.IndexName === 'string' ? parsed.IndexName : null,
    keyCondition: parsed && typeof parsed.KeyConditionExpression === 'string' ? parsed.KeyConditionExpression : null,
    filterExpression: parsed && typeof parsed.FilterExpression === 'string' ? parsed.FilterExpression : null,
    projectionExpression: parsed && typeof parsed.ProjectionExpression === 'string' ? parsed.ProjectionExpression : null,
    values: parsed && parsed.ExpressionAttributeValues ? flattenValues(parsed.ExpressionAttributeValues) : {},
    key: parsed && parsed.Key ? flattenValues(parsed.Key) : {},
  });
}

/** DynamoDB wire format is one key per type. Only strings matter for these assertions. */
function flattenValues(map) {
  const out = {};
  for (const [name, value] of Object.entries(map)) {
    if (value && typeof value === 'object' && typeof value.S === 'string') out[name] = value.S;
    else if (value && typeof value === 'object' && typeof value.N === 'string') out[name] = Number(value.N);
  }
  return out;
}
