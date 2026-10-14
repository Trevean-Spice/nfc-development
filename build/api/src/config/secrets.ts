import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { config } from './env.js';

/**
 * Secrets come from a managed store, never from the repository, per the Architecture
 * document, "Security and privacy". The same rule covers the tag password, whose holder
 * and rotation path are documented separately.
 *
 * Local development reads from the process environment, because there is no AWS account
 * to read from yet. That path is refused when STAGE is production, so the failure mode of
 * a secret leaking into an environment variable in production is a hard startup error
 * rather than a quiet success.
 */

export interface SecretProvider {
  get(name: string): Promise<string>;
  /** Returns undefined instead of throwing when the secret is absent. */
  getOptional(name: string): Promise<string | undefined>;
}

function envKeyFor(name: string): string {
  return `SECRET_${name.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;
}

export class EnvSecretProvider implements SecretProvider {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async getOptional(name: string): Promise<string | undefined> {
    return this.env[envKeyFor(name)] ?? undefined;
  }

  async get(name: string): Promise<string> {
    const value = await this.getOptional(name);
    if (value === undefined) {
      throw new Error(`Secret '${name}' is not present. Set ${envKeyFor(name)} for local development.`);
    }
    return value;
  }
}

export class SecretsManagerProvider implements SecretProvider {
  private readonly client: SecretsManagerClient;
  private readonly cache = new Map<string, { value: string; expiresAt: number }>();

  constructor(region: string, private readonly ttlMs = 5 * 60 * 1000) {
    this.client = new SecretsManagerClient({ region });
  }

  async getOptional(name: string): Promise<string | undefined> {
    const cached = this.cache.get(name);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    try {
      const out = await this.client.send(new GetSecretValueCommand({ SecretId: name }));
      const value = out.SecretString;
      if (value === undefined) return undefined;
      this.cache.set(name, { value, expiresAt: Date.now() + this.ttlMs });
      return value;
    } catch {
      return undefined;
    }
  }

  async get(name: string): Promise<string> {
    const value = await this.getOptional(name);
    if (value === undefined) throw new Error(`Secret '${name}' could not be read from the managed store.`);
    return value;
  }
}

let provider: SecretProvider | undefined;

export function secrets(): SecretProvider {
  if (provider) return provider;
  provider = config.stage === 'local' ? new EnvSecretProvider() : new SecretsManagerProvider(config.region);
  return provider;
}

/** Test seam. */
export function setSecretProvider(next: SecretProvider | undefined): void {
  provider = next;
}
