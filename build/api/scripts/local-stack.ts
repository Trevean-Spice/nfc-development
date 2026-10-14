import dynalite from 'dynalite';

/**
 * The whole thing, running with no AWS account.
 *
 * We do not have AWS access yet and the API has to be demonstrably working before it
 * lands. This starts an in process DynamoDB compatible server, creates the five tables,
 * seeds them, and starts the API against them. One command, no Docker, no Java, no
 * credentials.
 *
 * DynamoDB Local in Docker is the alternative and is closer to the real thing. See
 * docker-compose.yml and the README. Either way nothing in src/ changes: the only
 * difference is what DYNAMODB_ENDPOINT points at.
 */

const DB_PORT = Number.parseInt(process.env.LOCAL_DDB_PORT ?? '4567', 10);

async function main(): Promise<void> {
  const server = dynalite({ createTableMs: 0, updateTableMs: 0, deleteTableMs: 0 });
  await new Promise<void>((resolve, reject) => {
    server.listen(DB_PORT, (err?: Error) => (err ? reject(err) : resolve()));
  });
  process.stdout.write(`Local DynamoDB listening on http://localhost:${DB_PORT}\n`);

  process.env.DYNAMODB_ENDPOINT = `http://localhost:${DB_PORT}`;
  process.env.STAGE = process.env.STAGE ?? 'local';
  process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID ?? 'local';
  process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY ?? 'local';
  // A development only symmetric signing key. There is no identity provider on a laptop,
  // and this value is refused outright when STAGE is production.
  process.env.SECRET_TREVEAN_API_DEV_JWT_SECRET =
    process.env.SECRET_TREVEAN_API_DEV_JWT_SECRET ?? 'local-development-signing-key-not-for-any-real-environment';

  const { ensureTables } = await import('../src/db/schema.js');
  const { seed } = await import('../src/db/seed.js');
  const created = await ensureTables();
  process.stdout.write(`Tables ready: ${created.length > 0 ? created.join(', ') : 'already existed'}\n`);
  await seed({ sourceCommit: 'local' });
  process.stdout.write('Seeded.\n');

  await import('../src/index.js');
}

main().catch((err: Error) => {
  process.stderr.write(`${err.message}\n`);
  process.exitCode = 1;
});
