/*
 * Regenerates img/world.jpg: the graded world the map shows underneath its
 * tiles, so a frame whose tiles have not arrived is still a map.
 *
 * Run it whenever gradeStrength, LAND_STOPS or the Blue Marble source in
 * farroute-map.js changes, otherwise the backdrop and the tiles above it drift
 * apart in colour.
 *
 *   node tools/make-world-image.mjs                        # img/world.jpg, 1536px
 *   PX=1024 Q=0.74 OUT=world-small.jpg node tools/...     # the phone copy
 *
 * It drives the site in headless Chrome and asks the map itself for the
 * picture, so the file is always the same pipeline as the live tiles.
 * PUPPETEER points at a puppeteer-core checkout, CHROME at the browser.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUPPETEER = process.env.PUPPETEER ||
  '/Users/noorsoliman/farroute-extension/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TILES = +(process.env.TILES || 8), PX = +(process.env.PX || 1536), Q = +(process.env.Q || 0.78);
const OUT = process.env.OUT || 'world.jpg';

const puppeteer = (await import(PUPPETEER)).default;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer((q, r) => {
  const name = decodeURIComponent(q.url.split('?')[0]).replace(/^\//, '') || 'index.html';
  const file = join(ROOT, name);
  if (!existsSync(file)) { r.writeHead(404); r.end('not found'); return; }
  r.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
  r.end(readFileSync(file));
});
const port = await new Promise(ok => server.listen(0, '127.0.0.1', () => ok(server.address().port)));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 860 });
await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__FM && window.__FM.worldImage, { timeout: 60000 });
console.log('building', TILES * TILES, 'tiles into', PX + 'px');
const url = await page.evaluate((t, px, q) => window.__FM.worldImage(t, px, q), TILES, PX, Q);
const bytes = Buffer.from(url.split(',')[1], 'base64');
writeFileSync(join(ROOT, 'img', OUT), bytes);
console.log('img/' + OUT, (bytes.length / 1024).toFixed(0) + ' KB');
await browser.close();
server.close();
