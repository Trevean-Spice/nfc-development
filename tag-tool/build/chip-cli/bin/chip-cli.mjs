#!/usr/bin/env node
/**
 * Launcher. The tool itself is TypeScript compiled into dist/.
 * Run "npm run build" in this folder once before using it.
 */
import { main } from '../dist/src/cli/main.js';

const code = await main(process.argv.slice(2));
process.exitCode = code;
