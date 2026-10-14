/*
 * The two AWS adapters the catalog_sync function needs, and nothing more.
 *
 * Both load the AWS SDK v3 that ships inside the Lambda nodejs22.x runtime, through a
 * dynamic import whose specifier is a variable. That keeps this package at zero declared
 * runtime dependencies (MANIFEST.md, and a test asserts it), keeps the deployment archive
 * to our own compiled code, and means no AWS SDK types are needed to typecheck. The price
 * is that the SDK version is whatever the runtime carries, which is recorded as a risk in
 * CATALOG-SYNC-DEPLOY.md rather than discovered.
 *
 * NOT EXERCISED BY THE TEST SUITE, for the same reason HttpAdminTransport is not: a test
 * that mocks the SDK proves only that the mock was called. Everything above these two
 * adapters is tested against an in memory table and recorded Admin API responses.
 */

import type { CredentialProvider } from '../admin/transport.js';
import type { CatalogTable, GetItemInput, Item, UpdateItemInput } from '../sync/catalogWriter.js';

// Typed as string, not as the literal, so TypeScript does not try to resolve the module.
const DYNAMODB_SDK: string = '@aws-sdk/client-dynamodb';
const SECRETS_SDK: string = '@aws-sdk/client-secrets-manager';

/**
 * The secret's value, from what Secrets Manager returned.
 *
 * Accepts the raw token, or a JSON object with a string "value", which is the shape the
 * secrets module's placeholder uses. Refuses the placeholder itself: terraform creates
 * every secret holding FILL IN WHEN ACCESS LANDS, and sending that to Shopify as a token
 * would be a 401 that reads like a scope problem. Failing here names the real cause.
 */
export function secretValueFrom(raw: string | undefined, name: string): string {
  if (raw === undefined || raw.trim() === '') throw new Error(`Secret ${name} has no value.`);
  let value = raw.trim();
  if (value.startsWith('{')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error(`Secret ${name} looks like JSON but does not parse.`);
    }
    const obj = parsed as { value?: unknown; set_by?: unknown };
    if (obj.set_by === 'terraform-placeholder') {
      throw new Error(`Secret ${name} still holds the terraform placeholder. Set the real value out of band first.`);
    }
    if (typeof obj.value !== 'string' || obj.value.trim() === '') {
      throw new Error(`Secret ${name} is JSON without a string "value".`);
    }
    value = obj.value.trim();
  }
  if (/^FILL IN/i.test(value)) {
    throw new Error(`Secret ${name} still holds a placeholder. Set the real value out of band first.`);
  }
  return value;
}

/** Secrets Manager, read at the moment of use. The value is never logged and never cached beyond the client. */
export class SecretsManagerCredentialProvider implements CredentialProvider {
  private reader: Promise<(name: string) => Promise<string | undefined>> | undefined;

  async get(name: string): Promise<string> {
    this.reader ??= import(SECRETS_SDK).then((sdk) => {
      const client = new sdk.SecretsManagerClient({});
      return async (secretId: string) => {
        const out = (await client.send(new sdk.GetSecretValueCommand({ SecretId: secretId }))) as { SecretString?: string };
        return out.SecretString;
      };
    });
    const read = await this.reader;
    return secretValueFrom(await read(name), name);
  }
}

/** The CatalogTable over the low level DynamoDB client. Region comes from the Lambda environment. */
export async function awsCatalogTable(): Promise<CatalogTable> {
  const sdk = (await import(DYNAMODB_SDK)) as {
    DynamoDBClient: new (config: object) => { send(command: unknown): Promise<unknown> };
    GetItemCommand: new (input: GetItemInput) => unknown;
    UpdateItemCommand: new (input: UpdateItemInput) => unknown;
  };
  const client = new sdk.DynamoDBClient({});
  return {
    async getItem(input) {
      return (await client.send(new sdk.GetItemCommand(input))) as { Item?: Item };
    },
    async updateItem(input) {
      return client.send(new sdk.UpdateItemCommand(input));
    },
  };
}
