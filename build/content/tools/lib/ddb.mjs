/**
 * A very small DynamoDB client: SigV4 signing and four operations.
 *
 * Why not the AWS SDK. The seeding tool has to run on a laptop with no AWS access, no
 * npm install and no network, against DynamoDB Local, on the day someone needs it. A
 * zero dependency tool that speaks the wire protocol does that. It also means this
 * deliverable adds nothing to the background IP list, which is a standing obligation
 * under the Scope document, "IP and handoff".
 *
 * Node standard library only: node:crypto and global fetch.
 */

import crypto from 'node:crypto';

const SERVICE = 'dynamodb';
const API = 'DynamoDB_20120810';

/* ------------------------------------------------------------- marshalling */

export function marshal(value) {
  if (value === null || value === undefined) return { NULL: true };
  if (typeof value === 'boolean') return { BOOL: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`cannot store non finite number: ${value}`);
    return { N: String(value) };
  }
  if (typeof value === 'string') {
    // DynamoDB rejects an empty string in a key. Elsewhere it is legal, but an empty
    // string in content data is almost always a bug, so it is refused here too.
    if (value === '') throw new Error('empty string: use null rather than an empty string in fixtures');
    return { S: value };
  }
  if (Array.isArray(value)) return { L: value.map(marshal) };
  if (typeof value === 'object') {
    const m = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      m[k] = marshal(v);
    }
    return { M: m };
  }
  throw new Error(`cannot marshal ${typeof value}`);
}

export function marshalItem(obj) {
  const item = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    item[k] = marshal(v);
  }
  return item;
}

export function unmarshal(av) {
  if (av === null || av === undefined) return null;
  if ('NULL' in av) return null;
  if ('S' in av) return av.S;
  if ('N' in av) return Number(av.N);
  if ('BOOL' in av) return av.BOOL;
  if ('L' in av) return av.L.map(unmarshal);
  if ('M' in av) return Object.fromEntries(Object.entries(av.M).map(([k, v]) => [k, unmarshal(v)]));
  throw new Error(`cannot unmarshal ${JSON.stringify(av)}`);
}

export function unmarshalItem(item) {
  if (!item) return null;
  return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, unmarshal(v)]));
}

/* ------------------------------------------------------------------ SigV4 */

const sha256hex = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

function signingKey(secret, dateStamp, region) {
  return hmac(hmac(hmac(hmac('AWS4' + secret, dateStamp), region), SERVICE), 'aws4_request');
}

function sign({ method = 'POST', url, body, headers, region, credentials, now }) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const u = new URL(url);

  const all = {
    ...headers,
    host: u.host,
    'x-amz-date': amzDate,
    ...(credentials.sessionToken ? { 'x-amz-security-token': credentials.sessionToken } : {}),
  };
  const signedHeaders = Object.keys(all).map((h) => h.toLowerCase()).sort();
  const canonicalHeaders = signedHeaders.map((h) => `${h}:${String(all[Object.keys(all).find((k) => k.toLowerCase() === h)]).trim()}\n`).join('');
  const payloadHash = sha256hex(body);

  const canonicalRequest = [
    method,
    u.pathname || '/',
    u.searchParams.toString(),
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const signature = crypto
    .createHmac('sha256', signingKey(credentials.secretAccessKey, dateStamp, region))
    .update(stringToSign)
    .digest('hex');

  return {
    ...all,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`,
  };
}

/* ------------------------------------------------------------------ client */

export function resolveCredentials(env = process.env) {
  const accessKeyId = env.AWS_ACCESS_KEY_ID ?? null;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY ?? null;
  const sessionToken = env.AWS_SESSION_TOKEN ?? null;
  return { accessKeyId, secretAccessKey, sessionToken };
}

export function localCredentials() {
  // DynamoDB Local validates the signature shape, not the credentials themselves.
  return { accessKeyId: 'local', secretAccessKey: 'local', sessionToken: null };
}

export function createClient({ endpoint, region, credentials }) {
  if (!credentials.accessKeyId || !credentials.secretAccessKey) {
    throw new Error(
      'no credentials. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or point --endpoint-url at DynamoDB Local, which accepts placeholder credentials.',
    );
  }

  async function call(operation, payload) {
    const body = JSON.stringify(payload);
    const headers = sign({
      url: endpoint,
      body,
      headers: {
        'content-type': 'application/x-amz-json-1.0',
        'x-amz-target': `${API}.${operation}`,
      },
      region,
      credentials,
      now: new Date(),
    });

    const res = await fetch(endpoint, { method: 'POST', headers, body });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`${operation}: ${res.status}, unparseable response: ${text.slice(0, 400)}`);
    }
    if (!res.ok) {
      const type = String(parsed.__type ?? '').split('#').pop();
      const err = new Error(`${operation} failed: ${type || res.status}: ${parsed.message ?? parsed.Message ?? text.slice(0, 300)}`);
      err.code = type;
      err.status = res.status;
      throw err;
    }
    return parsed;
  }

  return {
    call,
    putItem: (params) => call('PutItem', params),
    getItem: (params) => call('GetItem', params),
    describeTable: (TableName) => call('DescribeTable', { TableName }),
    createTable: (params) => call('CreateTable', params),
    listTables: () => call('ListTables', {}),
  };
}
