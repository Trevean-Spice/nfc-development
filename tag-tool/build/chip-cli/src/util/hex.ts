/** Hex helpers. Byte level output is how a mismatch is explained to a human. */

export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

export function fromHex(hex: string): Uint8Array {
  const cleaned = hex.replace(/[\s:]/g, '');
  if (cleaned.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(cleaned)) {
    throw new Error('Not a hex string');
  }
  return Uint8Array.from(Buffer.from(cleaned, 'hex'));
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/** Index of the first differing byte, or -1. Named in the mismatch message. */
export function firstDifference(a: Uint8Array, b: Uint8Array): number {
  const limit = Math.max(a.length, b.length);
  for (let i = 0; i < limit; i += 1) if (a[i] !== b[i]) return i;
  return -1;
}

/** A block by block dump, four bytes to a line, with printable ASCII alongside. */
export function dumpBlocks(bytes: Uint8Array, firstBlock: number, blockSize: number): string {
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    const block = bytes.subarray(offset, offset + blockSize);
    const hex = toHex(block).replace(/(..)/g, '$1 ').trim();
    let ascii = '';
    for (const b of block) ascii += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.';
    const blockNumber = firstBlock + offset / blockSize;
    lines.push(`  block ${String(blockNumber).padStart(2, ' ')}  ${hex.padEnd(blockSize * 3, ' ')}  ${ascii}`);
  }
  return lines.join('\n');
}
