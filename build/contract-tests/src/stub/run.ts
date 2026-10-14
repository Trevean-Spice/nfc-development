// Starts the stub on a fixed port for manual use.
//
//   npm run stub
//   STUB_PORT=4010 npm run stub
//
// The stub is a development aid. It is in memory, has no authentication worth the name,
// and must never be deployed.

import { startStub, unimplementedOperations } from './server.js';
import { operationList } from '../spec.js';

const port = Number(process.env.STUB_PORT ?? 3001);

const missing = unimplementedOperations();
if (missing.length > 0) {
  console.error(`The stub does not implement: ${missing.join(', ')}`);
  process.exit(1);
}

startStub(port).then((handle) => {
  console.log(`Trevean Spice contract stub listening on ${handle.url}`);
  console.log(`Implementing ${operationList.length} operations from the frozen OpenAPI document.`);
  console.log('Tokens: stub-admin-token, stub-editor-token, stub-viewer-token, stub-expired-token');
  console.log('Stop with Ctrl+C.');
});
