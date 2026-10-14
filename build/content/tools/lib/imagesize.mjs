/**
 * Read the pixel dimensions of a JPEG, PNG or WebP from its header.
 *
 * This exists so the intake validator can tell Trevean "this hero shot is 1600 px wide
 * and we need at least 2560" on the day the files arrive, rather than a week later
 * when someone tries to process them. It reads a few hundred bytes and decodes nothing.
 *
 * Node standard library only.
 */

import fs from 'node:fs';

export function imageSize(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(Math.min(fs.fstatSync(fd).size, 65536));
    fs.readSync(fd, head, 0, head.length, 0);

    if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return { format: 'png', width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
    }

    if (head[0] === 0xff && head[1] === 0xd8) {
      return { format: 'jpeg', ...jpegSize(fd, head) };
    }

    if (head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP') {
      return { format: 'webp', ...webpSize(head) };
    }

    if (head.subarray(4, 8).toString('ascii') === 'ftyp' && head.subarray(8, 12).toString('ascii').startsWith('avi')) {
      // AVIF dimensions live in an ispe box inside meta. Finding it properly means a
      // box walker; the intake spec asks for JPEG, PNG or WebP sources for exactly
      // this reason, so this is reported rather than guessed.
      return { format: 'avif', width: null, height: null };
    }

    return { format: 'unknown', width: null, height: null };
  } finally {
    fs.closeSync(fd);
  }
}

function jpegSize(fd, head) {
  let buf = head;
  let offset = 2;
  while (offset < buf.length) {
    if (buf[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buf[offset + 1];
    // SOF0 to SOF15, excluding the DHT, JPG and DAC markers.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = buf.readUInt16BE(offset + 2);
    offset += 2 + length;
    if (offset + 10 > buf.length) {
      const next = Buffer.alloc(65536);
      const read = fs.readSync(fd, next, 0, next.length, offset);
      if (read === 0) break;
      buf = Buffer.concat([buf.subarray(0, offset), next.subarray(0, read)]);
    }
  }
  return { width: null, height: null };
}

function webpSize(head) {
  const kind = head.subarray(12, 16).toString('ascii');
  if (kind === 'VP8 ') {
    return { width: head.readUInt16LE(26) & 0x3fff, height: head.readUInt16LE(28) & 0x3fff };
  }
  if (kind === 'VP8L') {
    const bits = head.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (kind === 'VP8X') {
    const w = head[24] | (head[25] << 8) | (head[26] << 16);
    const h = head[27] | (head[28] << 8) | (head[29] << 16);
    return { width: w + 1, height: h + 1 };
  }
  return { width: null, height: null };
}
