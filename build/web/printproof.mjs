import puppeteer from './node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
import { launch } from './node_modules/chrome-launcher/dist/index.js';
import { writeFileSync } from 'node:fs';
const chrome = await launch({ chromeFlags:['--headless=new','--no-sandbox','--disable-gpu'] });
const res = await fetch(`http://127.0.0.1:${chrome.port}/json/version`);
const { webSocketDebuggerUrl } = await res.json();
const browser = await puppeteer.connect({ browserWSEndpoint: webSocketDebuggerUrl });
const page = await browser.newPage();
await page.goto('http://localhost:3413/blend.html?blend=persian-sunrise&via=nfc', { waitUntil:'networkidle0' });
// Default print: printBackground false, exactly what Ctrl+P / Save as PDF does by default.
const pdf = await page.pdf({ printBackground:false, format:'A4' });
writeFileSync('/tmp/blend-print-default.pdf', pdf);
const pdf2 = await page.pdf({ printBackground:true, format:'A4' });
writeFileSync('/tmp/blend-print-backgrounds.pdf', pdf2);
await page.emulateMediaType('print');
const shot = await page.screenshot({ fullPage:false });
writeFileSync('/tmp/blend-print-media.png', shot);
const cs = await page.evaluate(() => {
  const b = document.querySelector('.placeholder-banner');
  const s = getComputedStyle(b);
  return { bg:s.backgroundColor, color:s.color, display:s.display, visibility:s.visibility };
});
console.log('computed under print media emulation:', JSON.stringify(cs));
await browser.disconnect();
await chrome.kill();
