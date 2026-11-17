#!/usr/bin/env node
/**
 * Launcher for the Tag Tool, the browser page for writing tags one after another.
 * "Start Tag Tool.cmd" (Windows) and "start-tag-tool.command" (Mac) run this after
 * building. Run "npm run build" in this folder first if starting it by hand.
 */
import { runTagTool } from '../dist/src/app/main.js';

const code = await runTagTool(process.argv.slice(2));
process.exitCode = code;
// Anything still holding the event loop open after a clean stop is not worth a hung window.
setTimeout(() => process.exit(code), 2000).unref();
