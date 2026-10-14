import puppeteer from './node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import { launch } from './node_modules/chrome-launcher/dist/index.js';
import { writeFileSync } from 'node:fs';
const chrome = await launch({ chromeFlags:['--headless=new','--no-sandbox','--disable-gpu'] });
const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${chrome.port}/json/version`)).json();
const browser = await puppeteer.connect({ browserWSEndpoint: webSocketDebuggerUrl });
const page = await browser.newPage();
await page.goto('http://localhost:3414/blend.html?blend=persian-sunrise&via=nfc', { waitUntil:'networkidle0' });
await page.emulateMediaType('print');
const cs = await page.evaluate(() => {
  const b = document.querySelector('.placeholder-banner');
  const s = getComputedStyle(b);
  return { bg:s.backgroundColor, color:s.color, border:s.borderTopWidth+' '+s.borderTopStyle+' '+s.borderTopColor, position:s.position };
});
console.log('banner computed style under print media:', JSON.stringify(cs));
await page.emulateMediaType(null);
writeFileSync('c:/tmp/fixed-print-default.pdf', await page.pdf({ printBackground:false, format:'A4' }));
console.log('pdf written');
await browser.disconnect();
try { await chrome.kill(); } catch {}
process.exit(0);
