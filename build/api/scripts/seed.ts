import { execSync } from 'node:child_process';
import { seed } from '../src/db/seed.js';

/**
 * Seeds the five blends, two growers, two recipes, the catalog mirror and the NFCTags
 * mirror of the version controlled redirect table.
 */

function currentCommit(): string | undefined {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  await seed({ sourceCommit: currentCommit() });
  process.stdout.write('Seeded five blends, two growers, two recipes, the catalog mirror and the tag records.\n');
}

main().catch((err: Error) => {
  process.stderr.write(`${err.message}\n`);
  process.exitCode = 1;
});
