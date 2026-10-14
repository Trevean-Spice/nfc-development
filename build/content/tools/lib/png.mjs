/**
 * Minimal PNG writer and 5x7 bitmap font, Node standard library only.
 *
 * Why this exists rather than an image library: the placeholder imagery has to be
 * generated reproducibly, on any machine, with no network and no native build step,
 * and it has to hit an exact byte count so the page is measured against the real
 * performance budget rather than against a small grey rectangle. Twelve hundred lines
 * of dependency for four rectangles and some text is a worse trade than this file.
 *
 * No external dependency. node:zlib and node:crypto only.
 */

import zlib from 'node:zlib';

/* ------------------------------------------------------------------ canvas */

export function createCanvas(width, height, rgb = [0xff, 0xff, 0xff]) {
  const data = Buffer.alloc(width * height * 3);
  const canvas = { width, height, data };
  fillRect(canvas, 0, 0, width, height, rgb);
  return canvas;
}

export function cloneCanvas(canvas) {
  return { width: canvas.width, height: canvas.height, data: Buffer.from(canvas.data) };
}

export function setPixel(canvas, x, y, rgb) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const i = (y * canvas.width + x) * 3;
  canvas.data[i] = rgb[0];
  canvas.data[i + 1] = rgb[1];
  canvas.data[i + 2] = rgb[2];
}

export function fillRect(canvas, x0, y0, w, h, rgb) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) setPixel(canvas, x, y, rgb);
  }
}

export function strokeRect(canvas, x0, y0, w, h, thickness, rgb) {
  fillRect(canvas, x0, y0, w, thickness, rgb);
  fillRect(canvas, x0, y0 + h - thickness, w, thickness, rgb);
  fillRect(canvas, x0, y0, thickness, h, rgb);
  fillRect(canvas, x0 + w - thickness, y0, thickness, h, rgb);
}

/** Diagonal hazard stripes across the whole canvas. Unmistakable at a glance. */
export function diagonalStripes(canvas, rgb, stripeWidth, gap) {
  const period = stripeWidth + gap;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (((x + y) % period) < stripeWidth) setPixel(canvas, x, y, rgb);
    }
  }
}

/* -------------------------------------------------------------------- font */

const GLYPHS = {
  A: '.###.|#...#|#...#|#####|#...#|#...#|#...#',
  B: '####.|#...#|#...#|####.|#...#|#...#|####.',
  C: '.###.|#...#|#....|#....|#....|#...#|.###.',
  D: '####.|#...#|#...#|#...#|#...#|#...#|####.',
  E: '#####|#....|#....|####.|#....|#....|#####',
  F: '#####|#....|#....|####.|#....|#....|#....',
  G: '.###.|#...#|#....|#.###|#...#|#...#|.###.',
  H: '#...#|#...#|#...#|#####|#...#|#...#|#...#',
  I: '#####|..#..|..#..|..#..|..#..|..#..|#####',
  J: '..###|...#.|...#.|...#.|...#.|#..#.|.##..',
  K: '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#',
  L: '#....|#....|#....|#....|#....|#....|#####',
  M: '#...#|##.##|#.#.#|#...#|#...#|#...#|#...#',
  N: '#...#|##..#|#.#.#|#..##|#...#|#...#|#...#',
  O: '.###.|#...#|#...#|#...#|#...#|#...#|.###.',
  P: '####.|#...#|#...#|####.|#....|#....|#....',
  Q: '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#',
  R: '####.|#...#|#...#|####.|#.#..|#..#.|#...#',
  S: '.####|#....|#....|.###.|....#|....#|####.',
  T: '#####|..#..|..#..|..#..|..#..|..#..|..#..',
  U: '#...#|#...#|#...#|#...#|#...#|#...#|.###.',
  V: '#...#|#...#|#...#|#...#|#...#|.#.#.|..#..',
  W: '#...#|#...#|#...#|#...#|#.#.#|##.##|#...#',
  X: '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#',
  Y: '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..',
  Z: '#####|....#|...#.|..#..|.#...|#....|#####',
  0: '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.',
  1: '..#..|.##..|..#..|..#..|..#..|..#..|.###.',
  2: '.###.|#...#|....#|...#.|..#..|.#...|#####',
  3: '#####|...#.|..#..|...#.|....#|#...#|.###.',
  4: '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.',
  5: '#####|#....|####.|....#|....#|#...#|.###.',
  6: '..##.|.#...|#....|####.|#...#|#...#|.###.',
  7: '#####|....#|...#.|..#..|.#...|.#...|.#...',
  8: '.###.|#...#|#...#|.###.|#...#|#...#|.###.',
  9: '.###.|#...#|#...#|.####|....#|...#.|.##..',
  ' ': '.....|.....|.....|.....|.....|.....|.....',
  '-': '.....|.....|.....|#####|.....|.....|.....',
  '.': '.....|.....|.....|.....|.....|.##..|.##..',
  ',': '.....|.....|.....|.....|.##..|.##..|.#...',
  ':': '.....|.##..|.##..|.....|.##..|.##..|.....',
  '/': '....#|...#.|...#.|..#..|.#...|.#...|#....',
  '[': '.###.|.#...|.#...|.#...|.#...|.#...|.###.',
  ']': '.###.|...#.|...#.|...#.|...#.|...#.|.###.',
  '(': '..##.|.#...|.#...|.#...|.#...|.#...|..##.',
  ')': '.##..|...#.|...#.|...#.|...#.|...#.|.##..',
  '?': '.###.|#...#|....#|...#.|..#..|.....|..#..',
  '!': '..#..|..#..|..#..|..#..|..#..|.....|..#..',
  '+': '.....|..#..|..#..|#####|..#..|..#..|.....',
  '=': '.....|.....|#####|.....|#####|.....|.....',
};

const GLYPH_W = 5;
const GLYPH_H = 7;

function glyph(ch) {
  return GLYPHS[ch] ?? GLYPHS['?'];
}

export function textWidth(text, scale, tracking = 1) {
  const chars = String(text).toUpperCase();
  if (chars.length === 0) return 0;
  return chars.length * (GLYPH_W + tracking) * scale - tracking * scale;
}

export function textHeight(scale) {
  return GLYPH_H * scale;
}

export function drawText(canvas, text, x, y, scale, rgb, tracking = 1) {
  const chars = String(text).toUpperCase();
  let cx = x;
  for (const ch of chars) {
    const rows = glyph(ch).split('|');
    for (let ry = 0; ry < GLYPH_H; ry++) {
      for (let rx = 0; rx < GLYPH_W; rx++) {
        if (rows[ry][rx] !== '#') continue;
        fillRect(canvas, cx + rx * scale, y + ry * scale, scale, scale, rgb);
      }
    }
    cx += (GLYPH_W + tracking) * scale;
  }
}

export function drawTextCentred(canvas, text, y, scale, rgb, tracking = 1) {
  const w = textWidth(text, scale, tracking);
  drawText(canvas, text, Math.round((canvas.width - w) / 2), y, scale, rgb, tracking);
}

/* ------------------------------------------------------------------- noise */

/** Deterministic PRNG. Same fixtures on every machine, every run. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Perturb a fraction of pixels by a small amount.
 *
 * This is what makes the byte weight honest. A flat synthetic image compresses to a
 * few kilobytes no matter how large it is, so a page built against one would pass a
 * byte budget that real photography would then blow. Adding entropy until the encoded
 * file reaches the budgeted size is what makes the placeholder cost what the real
 * photograph will cost.
 */
export function addNoise(canvas, probability, amplitude, seed) {
  const rnd = mulberry32(seed);
  const d = canvas.data;
  for (let i = 0; i < d.length; i += 3) {
    if (rnd() >= probability) continue;
    const delta = Math.round((rnd() * 2 - 1) * amplitude);
    d[i] = clamp8(d[i] + delta);
    d[i + 1] = clamp8(d[i + 1] + delta);
    d[i + 2] = clamp8(d[i + 2] + delta);
  }
}

function clamp8(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

/* ------------------------------------------------------------------ encode */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function textChunk(keyword, value) {
  // tEXt: ancillary, public, safe to copy. Latin-1, no null bytes in the text.
  const clean = value.replace(/[^\x20-\x7e\n]/g, ' ').replace(/\n/g, ' ');
  return chunk('tEXt', Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(clean, 'latin1')]));
}

function rawScanlines(canvas) {
  // Filter type 0 (None) on every scanline. Predictable, and with dithered noise
  // present it costs almost nothing against the adaptive filters.
  const stride = canvas.width * 3;
  const out = Buffer.alloc((stride + 1) * canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    out[y * (stride + 1)] = 0;
    canvas.data.copy(out, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return out;
}

/**
 * Encode to PNG. If padToBytes is given, the file is padded with a tEXt chunk to that
 * exact byte count. The padding is legible metadata explaining what the file is, not
 * junk, and it is an ancillary chunk so every decoder ignores it.
 */
export function encodePng(canvas, { comments = [], padToBytes = null } = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(canvas.width, 0);
  ihdr.writeUInt32BE(canvas.height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const idat = zlib.deflateSync(rawScanlines(canvas), { level: 9 });

  const parts = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
  ];
  for (const [keyword, value] of comments) parts.push(textChunk(keyword, value));
  parts.push(chunk('IDAT', idat));

  const tail = chunk('IEND', Buffer.alloc(0));
  let body = Buffer.concat([...parts, tail]);

  if (padToBytes === null) return body;
  if (body.length > padToBytes) return null; // caller reduces entropy and retries

  const shortfall = padToBytes - body.length;
  if (shortfall === 0) return body;

  // A tEXt chunk costs 12 bytes of framing plus keyword, a null, and the text.
  const keyword = 'Comment';
  const framing = 12 + keyword.length + 1;
  if (shortfall < framing + 1) {
    return null; // cannot pad this precisely; caller lowers the entropy target
  }
  const fillLength = shortfall - framing;
  const message =
    'PADDING TO THE EXACT PERFORMANCE BUDGET. This file is a generated placeholder, not a photograph. ' +
    'It is padded to the byte cap in the M1 performance budget so that a page built against it is a truthful ' +
    'weight test. Replace it with real photography and the byte count must not rise. ';
  let fill = '';
  while (fill.length < fillLength) fill += message;
  fill = fill.slice(0, fillLength);

  const padded = chunk(
    'tEXt',
    Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(fill, 'latin1')]),
  );

  return Buffer.concat([...parts, padded, tail]);
}
