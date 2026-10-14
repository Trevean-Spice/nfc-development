import { ensureTables } from '../src/db/schema.js';
import { config } from '../src/config/env.js';

/**
 * Creates the five tables against whatever DYNAMODB_ENDPOINT points at.
 *
 * Run it against DynamoDB Local, against the in process server started by npm run
 * local:up, or against a real AWS account. It refuses to run against AWS without an
 * explicit acknowledgement, because table creation on the Trevean account belongs to the
 * infrastructure deliverable, not to a developer's terminal.
 */

async function main(): Promise<void> {
  if (!config.dynamoEndpoint && process.env.ALLOW_AWS_TABLE_CREATE !== 'true') {
    throw new Error(
      'No DYNAMODB_ENDPOINT is set, which means this would create tables in a real AWS account. ' +
        'Table creation there belongs to the infrastructure deliverable. Set ALLOW_AWS_TABLE_CREATE=true to override.',
    );
  }
  const created = await ensureTables();
  process.stdout.write(
    created.length === 0
      ? 'All five tables already exist.\n'
      : `Created: ${created.join(', ')}\n`,
  );
}

main().catch((err: Error) => {
  process.stderr.write(`${err.message}\n`);
  process.exitCode = 1;
});
