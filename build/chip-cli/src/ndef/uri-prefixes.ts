/**
 * NFC Forum URI Record Type Definition, the abbreviation table.
 *
 * The first byte of a URI record payload is an identifier code standing in for a
 * common prefix. Code 0x04 replaces the nine characters of "https://" with one
 * byte. On a 320 byte chip that is not a rounding error, it is 2.5% of the whole
 * memory, and it is free.
 *
 * Source: NFC Forum URI Record Type Definition, table 3. Codes 0x24 and above are
 * reserved for future use and this tool refuses both to write and to read them.
 *
 * Note for anyone comparing this against a phone app: several apps default to
 * 0x01, "http://www.", which silently produces a different and wrong URL while
 * still reporting a successful write. That defect is exactly what deriving the URI
 * from the redirect table prevents.
 */

export const URI_PREFIXES: readonly string[] = [
  '', // 0x00 no prefix, the URI is carried whole
  'http://www.', // 0x01
  'https://www.', // 0x02
  'http://', // 0x03
  'https://', // 0x04
  'tel:', // 0x05
  'mailto:', // 0x06
  'ftp://anonymous:anonymous@', // 0x07
  'ftp://ftp.', // 0x08
  'ftps://', // 0x09
  'sftp://', // 0x0A
  'smb://', // 0x0B
  'nfs://', // 0x0C
  'ftp://', // 0x0D
  'dav://', // 0x0E
  'news:', // 0x0F
  'telnet://', // 0x10
  'imap:', // 0x11
  'rtsp://', // 0x12
  'urn:', // 0x13
  'pop:', // 0x14
  'sip:', // 0x15
  'sips:', // 0x16
  'tftp:', // 0x17
  'btspp://', // 0x18
  'btl2cap://', // 0x19
  'btgoep://', // 0x1A
  'tcpobex://', // 0x1B
  'irdaobex://', // 0x1C
  'file://', // 0x1D
  'urn:epc:id:', // 0x1E
  'urn:epc:tag:', // 0x1F
  'urn:epc:pat:', // 0x20
  'urn:epc:raw:', // 0x21
  'urn:epc:', // 0x22
  'urn:nfc:', // 0x23
];

/** Highest defined identifier code. 0x24 and above are reserved for future use. */
export const MAX_URI_IDENTIFIER_CODE = URI_PREFIXES.length - 1;

/** The identifier code for "https://", the only one this project's URLs ever use. */
export const HTTPS_IDENTIFIER_CODE = 0x04;

export interface UriSplit {
  /** The identifier code byte that goes first in the payload. */
  readonly identifierCode: number;
  /** The prefix that byte stands for. Empty string for code 0x00. */
  readonly prefix: string;
  /** Everything after the prefix, encoded as UTF-8 in the payload. */
  readonly remainder: string;
  /** Bytes the abbreviation saved against carrying the URI whole. */
  readonly bytesSaved: number;
}

/**
 * Splits a URI into the identifier code plus remainder, choosing the longest
 * matching prefix.
 *
 * Longest match matters: "https://www.example.com" must select 0x02
 * ("https://www.") and not 0x04 ("https://"), because a decoder that expands 0x04
 * would produce "https://www.example.com" either way but the encoding would waste
 * four bytes. For this project's URLs there is no "www.", so 0x04 is always the
 * answer, and a test asserts that.
 */
export function splitUri(uri: string): UriSplit {
  let bestCode = 0x00;
  let bestPrefix = '';
  for (let code = 1; code <= MAX_URI_IDENTIFIER_CODE; code += 1) {
    const prefix = URI_PREFIXES[code];
    if (prefix === undefined || prefix.length === 0) continue;
    if (!uri.startsWith(prefix)) continue;
    if (prefix.length <= bestPrefix.length) continue;
    bestCode = code;
    bestPrefix = prefix;
  }
  return {
    identifierCode: bestCode,
    prefix: bestPrefix,
    remainder: uri.slice(bestPrefix.length),
    // One byte is always spent on the identifier code, so the saving is the prefix
    // length less nothing: the code byte is present in both cases.
    bytesSaved: Buffer.byteLength(bestPrefix, 'utf8'),
  };
}

/** Expands an identifier code plus remainder back into a full URI. */
export function expandUri(identifierCode: number, remainder: string): string {
  const prefix = URI_PREFIXES[identifierCode];
  if (prefix === undefined) {
    throw new Error(`URI identifier code 0x${identifierCode.toString(16)} is reserved for future use`);
  }
  return prefix + remainder;
}
