import puppeteer from './node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import { launch } from './node_modules/chrome-launcher/dist/index.js';
import { writeFileSync } from 'node:fs';
const chrome = await launch({ chromeFlags:['--headless=new','--no-sandbox','--disable-gpu'] });
const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${chrome.port}/json/version`)).json();
const browser = await puppeteer.connect({ browserWSEndpoint: webSocketDebuggerUrl });
const page = await browser.newPage();
await page.goto('http://localhost:3413/blend.html?blend=persian-sunrise&via=nfc', { waitUntil:'networkidle0' });
// Tag the banner text with a unique colour so we can find it in the PDF content stream.
await page.evaluate(() => {
  const b = document.querySelector('.placeholder-banner');
  b.style.setProperty('color', 'rgb(3, 7, 11)', 'important');   // -> .0118 .0275 .0431 rg
  b.querySelector('b').style.setProperty('color', 'rgb(3, 7, 11)', 'important');
});
writeFileSync('c:/tmp/probe-sticky.pdf', await page.pdf({ printBackground:false, format:'A4' }));
await page.evaluate(() => { document.querySelector('.placeholder-banner').style.setProperty('position','static','important'); });
writeFileSync('c:/tmp/probe-static.pdf', await page.pdf({ printBackground:false, format:'A4' }));
console.log('written');
await browser.disconnect();
try { await chrome.kill(); } catch {}
process.exit(0);
