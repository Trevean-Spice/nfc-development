/**
 * The protection path of the PC/SC transport against the ACS ACR1552U reference manual
 * and, since Sunday 25 October 2026, the ST25TV02KC datasheet, DS13304 Rev 7. The D66
 * gate made stricter. First written for findings D1 to D8 of the reader setup report,
 * then extended for the datasheet corrections and review findings F1 to F9.
 *
 * **These tests do not prove anything about silicon.** They prove the bytes the tool
 * sends are the bytes the manual (REF-ACR1552U-Series 1.09, section 5.3.5) and the
 * datasheet lay out, that every answer is read the strict way, and that the irreversible
 * pair and the protection read send nothing unless the probe passed on the tag in the
 * field now. The fake tag behind them is a model of those documents. README section 6
 * says what is still unproven.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ACS_RF_CYCLE,
  ACS_SESSION_END,
  ACS_SESSION_START,
  ACS_SWITCH_ISO15693,
  ISO15693_ERROR_BLOCK_LOCKED,
  PcscTransport,
  RF_OFF_US,
  TRANSCEIVE_TIMEOUT_US,
  c0Problem,
  judgeOpcodeProbe,
  judgeProbePreconditions,
  parseBerTlv,
  parseTransceiveAnswer,
  transparentExchangeApdu,
  writeSingleBlockFrame,
  type TagAnswer,
} from '../src/transport/pcsc.js';
import { isChipError } from '../src/chip/errors.js';
import { TagPassword } from '../src/chip/password.js';
import { ST_COMMANDS, coverCode } from '../src/chip/st-custom.js';
import { SimulatorTransport } from '../src/transport/simulator.js';
import { RecordingTransport, type TagTransport } from '../src/transport/transport.js';
import { UnitSession } from '../src/workflow/unit.js';
import { runBatch, type BatchEvent } from '../src/workflow/batch.js';
import { readJournal } from '../src/workflow/journal.js';
import { RedirectTable } from '../src/table/redirect-table.js';
import {
  ACR1552U,
  C0_NO_RESPONSE_FROM_TAG,
  C0_OK,
  FakeBinding,
  FakeReader,
  FakeTag,
  OK,
  OTHER_UID_LSB_FIRST,
  UID_LSB_FIRST,
  carriesSt,
  exchangeAnswer,
  frameOf,
  hex,
} from './fake-acr1552u.js';

const B4 = ST_COMMANDS.GET_RANDOM_NUMBER.code;
const B3 = ST_COMMANDS.PRESENT_PASSWORD.code;
const B1 = ST_COMMANDS.WRITE_PASSWORD.code;
const A0 = ST_COMMANDS.READ_CONFIGURATION.code;
const A1 = ST_COMMANDS.WRITE_CONFIGURATION.code;
/** ToggleDiscreetSilent, DS13304 6.4.23. What the tool used to send as "Set Memory Protection". */
const BA = 0xba;
const URI = 'https://treveanspice.com/t/ps';
const NEW_PASSWORD = '0a1b2c3d4e5f6071';
const UID = 'e002112233445566';
const UID_BYTES = Uint8Array.from([0xe0, 0x02, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66]);

async function openWith(reader: FakeReader): Promise<PcscTransport> {
  const transport = new PcscTransport(undefined, { loadBinding: async () => new FakeBinding([reader]), readerTimeoutMs: 50 });
  await transport.open();
  return transport;
}

async function selected(reader = new FakeReader(ACR1552U)): Promise<{ reader: FakeReader; transport: PcscTransport }> {
  const transport = await openWith(reader);
  await transport.waitForTag(200);
  return { reader, transport };
}

/** The probe passed and the current password presented, which is where UnitSession stands before Write Password. */
async function proven(reader = new FakeReader(ACR1552U)): Promise<{ reader: FakeReader; transport: PcscTransport }> {
  const ctx = await selected(reader);
  const probe = await ctx.transport.verifyOpcodes();
  assert.equal(probe.proven, true, probe.detail);
  await ctx.transport.presentPassword(1, new Uint8Array(8));
  return ctx;
}

function chipCode(code: string, also?: (e: { message: string; remedy: string; detail: Record<string, unknown> }) => void) {
  return (error: unknown) => {
    assert.ok(isChipError(error), 'must be a ChipError so the CLI can render a remedy');
    assert.equal(error.code, code, error.message);
    also?.(error);
    return true;
  };
}

/** Every transceived ISO 15693 frame, as sent (address included). */
const framesSent = (tag: FakeTag) => tag.sent.map(frameOf).filter((f): f is number[] => f !== null);
const commandsSent = (tag: FakeTag) => framesSent(tag).map((f) => f[1]);
const irreversibleFrames = (reader: FakeReader) => reader.tag.sent.filter((a) => carriesSt(a, B1) || carriesSt(a, A1) || carriesSt(a, BA));
const ok = (data: number[] = []): TagAnswer => ({ kind: 'ok', data: Uint8Array.from(data) });
const err = (errorCode: number): TagAnswer => ({ kind: 'error', errorCode });
const none = (reason: string): TagAnswer => ({ kind: 'no-answer', reason });
/** The UID as it travels, LSB first, as the fake holds it. */
const UID_ON_AIR = UID_LSB_FIRST;

const irreversible = [
  ['writePassword', (t: PcscTransport) => t.writePassword(1, TagPassword.fromHex(NEW_PASSWORD, 'new').toBytes())],
  ['setAreaProtection', (t: PcscTransport) => t.setAreaProtection(1, 'write_protected', 1)],
] as const;
const gateRefusal = /Refusing to (change a password|apply area protection): (the ST custom command path has not been proven on this tag|the tag in the field reads uid)/;

/* ------------------------------------------------------------------------ */
/* D1. Switch Protocol selects ISO 15693. Manual 5.3.5.5 and 5.3.5.5.1.       */
/* ------------------------------------------------------------------------ */

test('D1: Switch Protocol carries 8F 02 02 03 (RF 02h ISO15693, layer 3) and Le 00, per manual 5.3.5.5', () => {
  assert.equal(hex(ACS_SWITCH_ISO15693), 'ff c2 00 02 04 8f 02 02 03 00');
  assert.equal(ACS_SWITCH_ISO15693[7], 0x02);
});

test('D1: session start and end are the manual example bytes, 5.3.5.6 steps 1 and 7', () => {
  assert.equal(hex(ACS_SESSION_START), 'ff c2 00 00 02 81 00');
  assert.equal(hex(ACS_SESSION_END), 'ff c2 00 00 02 82 00');
});

test('D1: a password presentation is session start, switch, GetRandomNumber, PresentPassword, session end, in that order', async () => {
  const { reader, transport } = await selected();
  const before = reader.tag.sent.length;
  await transport.presentPassword(1, new Uint8Array(8));
  const sent = reader.tag.sent.slice(before);
  assert.equal(sent.length, 5);
  assert.equal(sent[0], 'ff c2 00 00 02 81 00');
  assert.equal(sent[1], 'ff c2 00 02 04 8f 02 02 03 00');
  assert.equal(frameOf(sent[2]!)?.[1], B4);
  assert.equal(frameOf(sent[3]!)?.[1], B3);
  assert.equal(sent[4], 'ff c2 00 00 02 82 00');
  await transport.close();
});

test('D1: a switch refused inside the C0 object under 90 00 stops the command before the exchange', async () => {
  const { reader, transport } = await selected();
  reader.tag.switchOverride = [0xc0, 0x03, 0x01, 0x64, 0x01, ...OK];
  const before = reader.tag.sent.length;
  await assert.rejects(() => transport.presentPassword(1, new Uint8Array(8)), chipCode('PROTECT_FAILED'));
  const sent = reader.tag.sent.slice(before);
  assert.equal(sent.filter((a) => a.startsWith('ff c2 00 01')).length, 0, 'no exchange after a failed switch');
  assert.equal(sent.at(-1), 'ff c2 00 00 02 82 00', 'and the session is still ended');
  await transport.close();
});

test('D1: a switch answer carrying an object the manual does not list for it is a failure, and no exchange follows', async () => {
  const { reader, transport } = await selected();
  reader.tag.switchOverride = [...C0_OK, 0x97, 0x01, 0x00, ...OK];
  const before = reader.tag.sent.length;
  await assert.rejects(() => transport.presentPassword(1, new Uint8Array(8)), chipCode('PROTECT_FAILED', (e) => assert.match(e.message, /switch protocol/)));
  assert.equal(reader.tag.sent.slice(before).filter((a) => a.startsWith('ff c2 00 01')).length, 0);
  await transport.close();
});

/* ------------------------------------------------------------------------ */
/* D2. Timer TLV and Le 00 on Transparent Exchange. Manual 5.3.5.4.            */
/* ------------------------------------------------------------------------ */

test('D2: Transparent Exchange is FF C2 00 01 Lc, Timer 5F 46 04 LSB first, Transceive 95, then Le 00', () => {
  assert.equal(hex(transparentExchangeApdu(Uint8Array.from([0x02, 0xb3, 0x02]))), 'ff c2 00 01 0c 5f 46 04 50 c3 00 00 95 03 02 b3 02 00');
});

test('D2: the timer is far above the manual default of about 302 µs and covers an ISO 15693 write-alike answer', () => {
  assert.ok(TRANSCEIVE_TIMEOUT_US >= 20_000, 'ISO 15693-3 lets a write-alike answer take up to 20 ms');
  assert.ok(TRANSCEIVE_TIMEOUT_US <= 1_000_000, 'and not so long that a silent tag hangs the unit');
});

test('D2: a frame the one byte BER length cannot carry is refused before the wire', () => {
  assert.throws(() => transparentExchangeApdu(new Uint8Array(0)));
  assert.throws(() => transparentExchangeApdu(new Uint8Array(128)));
});

test('D2: every exchange the transport sends carries the timer before the frame and ends Le 00', async () => {
  const { reader, transport } = await proven();
  await transport.setAreaProtection(1, 'write_protected', 1);
  const exchanges = reader.tag.sent.filter((a) => a.startsWith('ff c2 00 01'));
  assert.ok(exchanges.length >= 3);
  for (const apdu of exchanges) {
    const bytes = apdu.split(' ');
    assert.deepEqual(bytes.slice(5, 12), ['5f', '46', '04', '50', 'c3', '00', '00'], apdu);
    assert.equal(bytes[12], '95', apdu);
    assert.equal(bytes.at(-1), '00', apdu);
    assert.equal(parseInt(bytes[4]!, 16), bytes.length - 6, `Lc counts the data field only: ${apdu}`);
  }
  await transport.close();
});

/* ------------------------------------------------------------------------ */
/* D3 and F9. The C0 status and the ISO 15693 flags are read, not only the SW. */
/* ------------------------------------------------------------------------ */

test('D3: the manual example shape, 5.3.5.6 step 6, reads as the tag answer inside 97', () => {
  const answer = parseTransceiveAnswer(Uint8Array.from(exchangeAnswer([0x00, 0xaa])));
  assert.equal(answer.kind, 'ok');
  assert.equal(answer.kind === 'ok' && hex(answer.data), 'aa');
});

for (const [label, bytes, why] of [
  ['a timeout reported in C0 under 90 00', [...C0_NO_RESPONSE_FROM_TAG, ...OK], /no response from the tag/],
  ['a status word other than 90 00', [0x63, 0x00], /status word/],
  ['no C0 object at all, the shape the old fake used', [0x97, 0x01, 0x00, ...OK], /no C0/],
  ['a CRC error in the 96 object', [...C0_OK, 0x96, 0x02, 0x01, 0x00, 0x97, 0x01, 0x00, ...OK], /response status/],
  ['a collision in the 96 object', [...C0_OK, 0x96, 0x02, 0x02, 0x00, 0x97, 0x01, 0x00, ...OK], /response status/],
  ['a partial last byte in the 92 object', [...C0_OK, 0x92, 0x01, 0x03, 0x97, 0x01, 0x00, ...OK], /bit framing/],
  ['no 97 object', [...C0_OK, ...OK], /no 97/],
  ['an empty 97 object', [...C0_OK, 0x97, 0x00, ...OK], /empty 97/],
  ['two 97 objects', [...C0_OK, 0x97, 0x01, 0x00, 0x97, 0x01, 0x00, ...OK], /twice/],
  ['an object the manual does not list', [...C0_OK, 0x99, 0x01, 0x00, 0x97, 0x01, 0x00, ...OK], /unexpected data object/],
  ['a length that runs past the end', [...C0_OK, 0x97, 0x05, 0x00, ...OK], /malformed/],
  ['the error flag with no error code', [...C0_OK, 0x97, 0x01, 0x01, ...OK], /neither/],
  ['the error flag with two bytes after it', [...C0_OK, 0x97, 0x03, 0x01, 0x0f, 0x00, ...OK], /neither/],
  ['RFU response flags', [...C0_OK, 0x97, 0x01, 0x02, ...OK], /neither/],
  ['the extension flag', [...C0_OK, 0x97, 0x01, 0x08, ...OK], /neither/],
  // F9: the manual's success shape always carries 92 and 96. Without 96 a CRC error is invisible.
  ['F9: a success with no 96 response status object', [...C0_OK, 0x92, 0x01, 0x00, 0x97, 0x01, 0x00, ...OK], /no 96/],
  ['F9: a success with no 92 receive bit framing object', [...C0_OK, 0x96, 0x02, 0x00, 0x00, 0x97, 0x01, 0x00, ...OK], /no 92/],
  ['F9: an error with neither 92 nor 96', [...C0_OK, 0x97, 0x02, 0x01, 0x12, ...OK], /no 92/],
  ['F9: an error with no 96', [...C0_OK, 0x92, 0x01, 0x00, 0x97, 0x02, 0x01, 0x0f, ...OK], /no 96/],
] as const) {
  test(`D3: ${label} is no answer from the tag`, () => {
    const answer = parseTransceiveAnswer(Uint8Array.from(bytes));
    assert.equal(answer.kind, 'no-answer');
    assert.match(answer.kind === 'no-answer' ? answer.reason : '', why);
  });
}

test('F9: a proof write answered 12h without a 96 object is never read as protection', async () => {
  const { reader, transport } = await selected();
  reader.tag.exchangeOverride = (frame, normal) => (frame[1] === 0x21 ? [...C0_OK, 0x92, 0x01, 0x00, 0x97, 0x02, 0x01, 0x12, ...OK] : normal());
  await assert.rejects(() => transport.proveWriteRefused(1, new Uint8Array(4), UID), chipCode('PROTECT_FAILED', (e) => assert.match(e.message, /no 96/)));
  await transport.close();
});

test('D3: flags 01 and one code is an explicit tag error', () => {
  assert.deepEqual(parseTransceiveAnswer(Uint8Array.from(exchangeAnswer([0x01, 0x0f]))), { kind: 'error', errorCode: 0x0f });
});

test('D3: BER-TLV two byte tags and 81 lengths parse, truncation does not', () => {
  const tlvs = parseBerTlv(Uint8Array.from([0x5f, 0x51, 0x02, 0x3b, 0x00, 0x97, 0x81, 0x01, 0xaa]));
  assert.deepEqual(
    tlvs?.map((t) => [t.tag, hex(t.value)]),
    [
      [0x5f51, '3b 00'],
      [0x97, 'aa'],
    ],
  );
  assert.equal(parseBerTlv(Uint8Array.from([0x5f])), null);
  assert.equal(parseBerTlv(Uint8Array.from([0x97, 0x81])), null);
  assert.equal(parseBerTlv(Uint8Array.from([0x97, 0x83, 0, 0, 1])), null);
});

test('D3: the C0 object is judged on all three bytes', () => {
  assert.equal(c0Problem(Uint8Array.from([0x00, 0x90, 0x00])), null);
  assert.match(c0Problem(Uint8Array.from([0x01, 0x64, 0x01])) ?? '', /no response from the tag/);
  assert.match(c0Problem(Uint8Array.from([0x00, 0x90])) ?? '', /2 bytes/);
});

test('D3: a password refused by the tag with 0Fh under SW 90 00 is PASSWORD_REJECTED', async () => {
  const { reader, transport } = await selected();
  reader.tag.password = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
  await assert.rejects(() => transport.presentPassword(1, new Uint8Array(8)), chipCode('PASSWORD_REJECTED', (e) => assert.match(e.message, /0x0f/)));
  await transport.close();
});

test('D3: a timeout inside C0 under SW 90 00 is not a presented password', async () => {
  const { reader, transport } = await selected();
  reader.tag.tagOverride = () => null;
  await assert.rejects(
    () => transport.presentPassword(1, new Uint8Array(8)),
    chipCode('PROTECT_FAILED', (e) => assert.match(e.message, /no response from the tag/)),
  );
  await transport.close();
});

test('D3: success flags followed by unexpected bytes are not a presented password', async () => {
  const { reader, transport } = await selected();
  reader.tag.tagOverride = (f) => (f[1] === B3 ? [0x00, 0x12, 0x34] : reader.tag.datasheetAnswer(f));
  await assert.rejects(() => transport.presentPassword(1, new Uint8Array(8)), chipCode('PROTECT_FAILED'));
  await transport.close();
});

for (const [label, call] of irreversible) {
  test(`D3: ${label} refused by the tag under SW 90 00 is PROTECT_FAILED, after the probe passed`, async () => {
    const { reader, transport } = await proven();
    reader.tag.tagOverride = (f) => (f[1] === B1 || f[1] === A1 ? [0x01, 0x13] : reader.tag.datasheetAnswer(f));
    await assert.rejects(() => call(transport), chipCode('PROTECT_FAILED', (e) => assert.match(e.message, /not confirmed by the tag/)));
    await transport.close();
  });
}

/* ------------------------------------------------------------------------ */
/* D4. The probe proves "correct", not "different".                           */
/* ------------------------------------------------------------------------ */

test('D4: the probe pair is proven only by error 0Fh for the wrong password and a bare success for the default', () => {
  assert.equal(judgeOpcodeProbe(err(0x0f), ok()).proven, true);
});

for (const code of [0x01, 0x02, 0x03]) {
  test(`D4: a wrong password "refused" with ${code.toString(16).padStart(2, '0')}h is explained as a frame the tag did not take, for the bring up notes`, () => {
    const verdict = judgeOpcodeProbe(err(code), ok());
    assert.equal(verdict.proven, false);
    assert.match(verdict.detail, /did not take the frame as a command it implements/);
  });
}

for (const [label, wrong, right] of [
  ['a timeout and a CRC error, which differ and proved the path under the old rule', none('timeout'), none('CRC')],
  ['a timeout on the wrong password', none('timeout'), ok()],
  ['a timeout on the factory default', err(0x0f), none('timeout')],
  ['a CRC error on the factory default', err(0x0f), none('response status 01 00')],
  ['both refused', err(0x0f), err(0x0f)],
  ['both refused with different codes', err(0x0f), err(0x10)],
  ['both accepted', ok(), ok()],
  ['the factory default accepted with extra bytes', err(0x0f), ok([0x00, 0x00])],
  ['the wrong password "refused" as invalid IC Mfg code', err(0x01), ok()],
  ['the wrong password "refused" as invalid request format', err(0x02), ok()],
  ['the wrong password "refused" as invalid request flags', err(0x03), ok()],
  ['the wrong password refused with 10h, invalid Password_id, not 0Fh (stricter since the datasheet)', err(0x10), ok()],
  ['the wrong password refused with 12h', err(0x12), ok()],
  ['the answers swapped round', ok(), err(0x0f)],
] as const) {
  test(`D4: not proven: ${label}`, () => {
    const verdict = judgeOpcodeProbe(wrong, right);
    assert.equal(verdict.proven, false);
    assert.match(verdict.detail, /stay locked|cannot be told apart/);
  });
}

test('D4: on the wire, a wrong password that times out leaves the pair locked and sends neither', async () => {
  const { reader, transport } = await selected();
  let b3 = 0;
  reader.tag.tagOverride = (f) => (f[1] === B3 && ++b3 === 1 ? null : reader.tag.datasheetAnswer(f));
  assert.equal((await transport.verifyOpcodes()).proven, false);
  for (const [, call] of irreversible) await assert.rejects(() => call(transport), chipCode('PROTECT_FAILED'));
  assert.deepEqual(irreversibleFrames(reader), []);
  await transport.close();
});

test('D4: on the wire, a CRC error on the factory default leaves the pair locked', async () => {
  const { reader, transport } = await selected();
  let b3 = 0;
  reader.tag.exchangeOverride = (frame, normal) => {
    const answer = normal();
    return frame[1] === B3 && ++b3 === 2 ? [...C0_OK, 0x92, 0x01, 0x00, 0x96, 0x02, 0x01, 0x00, 0x97, 0x01, 0x00, ...OK] : answer;
  };
  assert.equal((await transport.verifyOpcodes()).proven, false);
  await assert.rejects(() => transport.setAreaProtection(1, 'write_protected', 1), chipCode('PROTECT_FAILED'));
  assert.deepEqual(irreversibleFrames(reader), []);
  await transport.close();
});

test('D4: on the wire, a transport error during the probe leaves the pair locked', async () => {
  const { reader, transport } = await selected();
  let exchanges = 0;
  reader.tag.exchangeOverride = (_frame, normal) => {
    exchanges += 1;
    if (exchanges === 2) reader.tag.failTransmit = true;
    return normal();
  };
  const probe = await transport.verifyOpcodes();
  assert.equal(probe.proven, false);
  assert.match(probe.detail, /did not complete/);
  reader.tag.failTransmit = false;
  await assert.rejects(() => transport.writePassword(1, new Uint8Array(8).fill(7)), chipCode('PROTECT_FAILED'));
  assert.deepEqual(irreversibleFrames(reader), []);
  await transport.close();
});

for (const [label, shape] of [
  ['with no C0 object', (tag: number[]) => [0x92, 0x01, 0x00, 0x96, 0x02, 0x00, 0x00, 0x97, tag.length, ...tag, ...OK]],
  ['with the error flag followed by two bytes', () => exchangeAnswer([0x01, 0x0f, 0x00])],
] as const) {
  test(`D4: on the wire, the wrong password answered ${label} leaves the pair locked`, async () => {
    const { reader, transport } = await selected();
    let b3 = 0;
    reader.tag.exchangeOverride = (frame, normal) => {
      const answer = normal();
      return frame[1] === B3 && ++b3 === 1 ? shape([0x01, 0x0f]) : answer;
    };
    assert.equal((await transport.verifyOpcodes()).proven, false);
    for (const [, call] of irreversible) await assert.rejects(() => call(transport), chipCode('PROTECT_FAILED'));
    assert.deepEqual(irreversibleFrames(reader), []);
    await transport.close();
  });
}

test('D4: on the wire, the factory default answered with no C0 object leaves the pair locked', async () => {
  const { reader, transport } = await selected();
  let b3 = 0;
  reader.tag.exchangeOverride = (frame, normal) => {
    const answer = normal();
    return frame[1] === B3 && ++b3 === 2 ? [0x92, 0x01, 0x00, 0x96, 0x02, 0x00, 0x00, 0x97, 0x01, 0x00, ...OK] : answer;
  };
  assert.equal((await transport.verifyOpcodes()).proven, false);
  await transport.close();
});

test('D4: a tag already carrying a password 1 cannot pass the probe', async () => {
  const { reader, transport } = await selected();
  reader.tag.password = Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2]);
  assert.equal((await transport.verifyOpcodes()).proven, false);
  await transport.close();
});

/* ------------------------------------------------------------------------ */
/* DS. The datasheet's commands, byte for byte. DS13304 Rev 7.                */
/* ------------------------------------------------------------------------ */

/** Undoes the cover coding the test way round: data LSB first XOR RND, read MSB first. */
function plain(coded: number[], rnd: number): string {
  return hex(Uint8Array.from(coded.map((b, i) => b ^ (i % 2 === 0 ? rnd & 0xff : rnd >>> 8)).reverse()));
}

test('DS: the probe is B4, B3 wrong, B4, B3 default, B4, B3 configuration, then three ReadConfiguration, all addressed, in one session', async () => {
  const { reader, transport } = await selected();
  const before = reader.tag.sent.length;
  const issuedBefore = reader.tag.randomsIssued.length;
  assert.equal((await transport.verifyOpcodes()).proven, true);
  const sent = reader.tag.sent.slice(before);
  assert.equal(sent.filter((a) => a === 'ff c2 00 00 02 81 00').length, 1, 'one transparent session');
  const frames = sent.map(frameOf).filter((f): f is number[] => f !== null);
  assert.deepEqual(frames.map((f) => f[1]), [B4, B3, B4, B3, B4, B3, A0, A0, A0]);
  for (const f of frames) {
    assert.equal(f[0], 0x22, 'flags 22h');
    assert.equal(f[2], 0x02, 'IC Mfg code 02h');
    assert.deepEqual(f.slice(3, 11), UID_ON_AIR, 'the UID LSB first, after the IC Mfg code');
  }
  const rnds = reader.tag.randomsIssued.slice(issuedBefore);
  assert.equal(rnds.length, 3, 'a fresh random number before each presentation, as 5.1.3 requires after a failed one');
  assert.equal(frames[1]![11], 0x01, 'Password_id 01h, PWD_A1');
  assert.equal(plain(frames[1]!.slice(12), rnds[0]!), 'de ad be ef de ad be ef', 'the wrong password, cover coded');
  assert.equal(frames[3]![11], 0x01);
  assert.equal(plain(frames[3]!.slice(12), rnds[1]!), '00 00 00 00 00 00 00 00', 'the factory default, cover coded');
  assert.equal(frames[5]![11], 0x00, 'Password_id 00h, PWD_CFG');
  assert.equal(frames[5]!.slice(12).length, 4, 'PWD_CFG is 32 bits (Table 27)');
  assert.equal(plain(frames[5]!.slice(12), rnds[2]!), '00 00 00 00');
  assert.deepEqual(frames.slice(6).map((f) => f.slice(11)), [[0x00, 0x00], [0x00, 0x01], [0xff, 0x00]], 'RW_PROTECTION_A1, END_A1, LCK_CONFIG');
  assert.deepEqual(irreversibleFrames(reader), []);
  await transport.close();
});

test('DS: without GetRandomNumber the factory default would be refused, which is why the old probe could never pass', () => {
  const tag = new FakeTag();
  // Present the factory default uncoded, as the old code did, with no B4 since boot.
  assert.deepEqual(tag.datasheetAnswer([0x02, B3, 0x02, 0x01, 0, 0, 0, 0, 0, 0, 0, 0]), [0x01, 0x0f]);
});

test('DS and N1: WritePassword is B4, B3 current, B1 new cover coded with the same random number, then B4 and B3 new, in one session', async () => {
  const { reader, transport } = await proven();
  const before = reader.tag.sent.length;
  const issuedBefore = reader.tag.randomsIssued.length;
  await transport.writePassword(1, TagPassword.fromHex(NEW_PASSWORD, 'new').toBytes());
  const sent = reader.tag.sent.slice(before);
  assert.equal(sent[0], 'ff ca 00 00 00', 'the gate reads the UID first');
  assert.equal(sent.filter((a) => a === 'ff c2 00 00 02 81 00').length, 1);
  const frames = sent.map(frameOf).filter((f): f is number[] => f !== null);
  assert.deepEqual(frames.map((f) => f[1]), [B4, B3, B1, B4, B3]);
  const rnd = reader.tag.randomsIssued[issuedBefore]!;
  assert.deepEqual(frames[2]!.slice(0, 12), [0x22, B1, 0x02, ...UID_ON_AIR, 0x01]);
  assert.deepEqual(frames[2]!.slice(12), coverCode(TagPassword.fromHex(NEW_PASSWORD, 'new').toBytes(), rnd));
  assert.equal(plain(frames[2]!.slice(12), rnd), '0a 1b 2c 3d 4e 5f 60 71', 'the hex characters are the value, most significant byte first');
  // N1: the new value presented straight after, with a fresh random number, must open the tag.
  const check = reader.tag.randomsIssued[issuedBefore + 1]!;
  assert.notEqual(check, rnd);
  assert.deepEqual(frames[4]!.slice(0, 12), [0x22, B3, 0x02, ...UID_ON_AIR, 0x01]);
  assert.equal(plain(frames[4]!.slice(12), check), '0a 1b 2c 3d 4e 5f 60 71');
  assert.equal(hex(reader.tag.password), '0a 1b 2c 3d 4e 5f 60 71');
  await transport.close();
});

test('DS: WritePassword is not sent when the current password is refused in its own session', async () => {
  const { reader, transport } = await proven();
  let b3 = 0;
  reader.tag.tagOverride = (f) => (f[1] === B3 && ++b3 === 1 ? [0x01, 0x0f] : reader.tag.datasheetAnswer(f));
  await assert.rejects(() => transport.writePassword(1, new Uint8Array(8).fill(7)), chipCode('PROTECT_FAILED', (e) => assert.match(e.message, /WritePassword was not sent/)));
  assert.equal(commandsSent(reader.tag).filter((c) => c === B1).length, 0);
  assert.equal(hex(reader.tag.password), '00 00 00 00 00 00 00 00');
  await transport.close();
});

test('DS: WritePassword is refused, nothing sent past the gate, when no current password was presented in this connection', async () => {
  const { reader, transport } = await selected();
  assert.equal((await transport.verifyOpcodes()).proven, true);
  const before = reader.tag.sent.length;
  await assert.rejects(() => transport.writePassword(1, new Uint8Array(8).fill(7)), chipCode('PROTECT_FAILED', (e) => assert.match(e.message, /has not been presented successfully/)));
  assert.deepEqual(reader.tag.sent.slice(before), ['ff ca 00 00 00']);
  await transport.close();
});

test('DS: area protection is B4, B3 with the factory PWD_CFG, then WriteConfiguration FID 00 PID 00 value 01, in one session', async () => {
  const { reader, transport } = await proven();
  const before = reader.tag.sent.length;
  const issuedBefore = reader.tag.randomsIssued.length;
  await transport.setAreaProtection(1, 'write_protected', 1);
  const frames = reader.tag.sent.slice(before).map(frameOf).filter((f): f is number[] => f !== null);
  assert.deepEqual(frames.map((f) => f[1]), [B4, B3, A1]);
  assert.deepEqual(frames[1]!.slice(0, 12), [0x22, B3, 0x02, ...UID_ON_AIR, 0x00]);
  assert.equal(plain(frames[1]!.slice(12), reader.tag.randomsIssued[issuedBefore]!), '00 00 00 00');
  assert.deepEqual(frames[2], [0x22, A1, 0x02, ...UID_ON_AIR, 0x00, 0x00, 0x01]);
  assert.equal(reader.tag.areaProtection, 0x01, 'Table 11, 01b: write allowed if AREA1 security session is open');
  assert.equal(reader.tag.activeAreaProtection, 0x00, 'and not enforced until the next RF boot (Table 10)');
  await transport.close();
});

for (const [label, call] of [
  ['area 2', (t: PcscTransport) => t.setAreaProtection(2, 'write_protected', 1)],
  ['password number 2', (t: PcscTransport) => t.setAreaProtection(1, 'write_protected', 2)],
  ['read protection, which no phone could read', (t: PcscTransport) => t.setAreaProtection(1, 'read_and_write_protected', 1)],
  ['removing protection', (t: PcscTransport) => t.setAreaProtection(1, 'none', 1)],
] as const) {
  test(`DS: setAreaProtection refuses ${label}, sending nothing past the gate`, async () => {
    const { reader, transport } = await proven();
    const before = reader.tag.sent.length;
    await assert.rejects(() => call(transport), chipCode('PROTECT_FAILED', (e) => assert.match(e.message, /This command was not sent/)));
    assert.deepEqual(reader.tag.sent.slice(before), ['ff ca 00 00 00']);
    await transport.close();
  });
}

for (const [label, setUp, why] of [
  ['a configuration password that is not the factory value', (t: FakeTag) => (t.configPassword = Uint8Array.from([1, 2, 3, 4])), /configuration password/],
  ['AREA1 already protected', (t: FakeTag) => (t.areaProtection = 0x01), /RW_PROTECTION_A1 reads 0x01/],
  ['dual area mode, where PWD_A1 is 32 bits', (t: FakeTag) => (t.endA1 = 0x3f), /dual area mode|0x02/],
  ['the AREA1 configuration permanently locked', (t: FakeTag) => (t.lckConfig = 0x0001), /permanently locked/],
] as const) {
  test(`DS: the probe does not pass with ${label}`, async () => {
    const { reader, transport } = await selected();
    setUp(reader.tag);
    const probe = await transport.verifyOpcodes();
    assert.equal(probe.proven, false);
    assert.match(probe.detail, why);
    for (const [, call] of irreversible) await assert.rejects(() => call(transport), chipCode('PROTECT_FAILED'));
    assert.deepEqual(irreversibleFrames(reader), []);
    await transport.close();
  });
}

test('DS: the preconditions judge refuses every bad register value', () => {
  const good = { configPassword: ok(), rwProtectionA1: ok([0x00]), endA1: ok([0x4f]), lckConfig: ok([0x00, 0x00]) };
  assert.equal(judgeProbePreconditions(good).proven, true);
  for (const bad of [
    { configPassword: err(0x0f) },
    { configPassword: none('timeout') },
    { rwProtectionA1: ok([0x02]) },
    { rwProtectionA1: ok([]) },
    { endA1: ok([0x10]) },
    { endA1: err(0x10) },
    { lckConfig: ok([0x02, 0x00]) },
    { lckConfig: ok([0x00]) },
  ]) {
    const verdict = judgeProbePreconditions({ ...good, ...bad });
    assert.equal(verdict.proven, false, JSON.stringify(bad));
    assert.match(verdict.detail, /stay locked/);
  }
  // A lock on another feature group does not matter.
  assert.equal(judgeProbePreconditions({ ...good, lckConfig: ok([0x10, 0x01]) }).proven, true);
});

test('DS: a full --protect never sends BAh, ToggleDiscreetSilent, and never leaves the tag discreet or silent', async () => {
  const reader = new FakeReader(ACR1552U);
  const { result } = await protectOnReader(reader);
  await result;
  assert.equal(commandsSent(reader.tag).filter((c) => c === BA).length, 0);
  assert.equal(reader.tag.discreetOrSilent, false);
});

/* ------------------------------------------------------------------------ */
/* D5. The proof belongs to one physical tag and one connection.              */
/* ------------------------------------------------------------------------ */

for (const [label, call] of irreversible) {
  test(`D5: ${label} is locked again after the same tag is selected again`, async () => {
    const { reader, transport } = await proven();
    await transport.waitForTag(200);
    await assert.rejects(() => call(transport), chipCode('PROTECT_FAILED', (e) => assert.match(e.message, gateRefusal)));
    assert.deepEqual(irreversibleFrames(reader), []);
    await transport.close();
  });

  test(`D5: ${label} is locked when a different tag is selected`, async () => {
    const { reader, transport } = await proven();
    reader.tag.uidLsbFirst = OTHER_UID_LSB_FIRST;
    const identity = await transport.waitForTag(200);
    assert.equal(identity.uid, 'e002112233778899');
    await assert.rejects(() => call(transport), chipCode('PROTECT_FAILED', (e) => assert.match(e.message, gateRefusal)));
    assert.deepEqual(irreversibleFrames(reader), []);
    await transport.close();
  });

  test(`D5: ${label} is locked after release and reconnect`, async () => {
    const { reader, transport } = await proven();
    await transport.releaseTag();
    await transport.waitForTag(200);
    assert.equal(reader.connects, 2);
    await assert.rejects(() => call(transport), chipCode('PROTECT_FAILED', (e) => assert.match(e.message, gateRefusal)));
    assert.deepEqual(irreversibleFrames(reader), []);
    await transport.close();
  });

  test(`D5: ${label} is locked after close and reopen of the same transport`, async () => {
    const { reader, transport } = await proven();
    await transport.close();
    await transport.open();
    await transport.waitForTag(200);
    await assert.rejects(() => call(transport), chipCode('PROTECT_FAILED', (e) => assert.match(e.message, gateRefusal)));
    assert.deepEqual(irreversibleFrames(reader), []);
    await transport.close();
  });

  test(`D5: ${label} refuses a tag swapped in silently, with only a UID read sent`, async () => {
    const { reader, transport } = await proven();
    reader.tag.uidLsbFirst = OTHER_UID_LSB_FIRST;
    const before = reader.tag.sent.length;
    await assert.rejects(
      () => call(transport),
      chipCode('PROTECT_FAILED', (e) => assert.match(e.message, /not the uid e002112233445566/)),
    );
    assert.deepEqual(reader.tag.sent.slice(before), ['ff ca 00 00 00']);
    // And the proof is gone: putting the first tag back does not bring it back.
    reader.tag.uidLsbFirst = UID_LSB_FIRST;
    await assert.rejects(() => call(transport), chipCode('PROTECT_FAILED'));
    assert.deepEqual(irreversibleFrames(reader), []);
    await transport.close();
  });

  test(`D5: ${label} is locked after any transport error`, async () => {
    const { reader, transport } = await proven();
    reader.tag.failTransmit = true;
    await assert.rejects(() => transport.readBlocks(0, 1), chipCode('TRANSPORT_UNAVAILABLE'));
    reader.tag.failTransmit = false;
    await assert.rejects(() => call(transport), chipCode('PROTECT_FAILED', (e) => assert.match(e.message, gateRefusal)));
    assert.deepEqual(irreversibleFrames(reader), []);
    await transport.close();
  });
}

test('D5: with the proof in place, the irreversible frame is preceded by a fresh UID read', async () => {
  const { reader, transport } = await proven();
  const before = reader.tag.sent.length;
  await transport.setAreaProtection(1, 'write_protected', 1);
  const sent = reader.tag.sent.slice(before);
  assert.equal(sent[0], 'ff ca 00 00 00');
  assert.equal(sent.filter((a) => a === 'ff ca 00 00 00').length, 1);
  assert.ok(carriesSt(sent.at(-2)!, A1));
  await transport.close();
});

test('D5: the probe refuses to prove anything with no tag selected', async () => {
  const transport = await openWith(new FakeReader(ACR1552U));
  const probe = await transport.verifyOpcodes();
  assert.equal(probe.proven, false);
  await transport.close();
});

/* ------------------------------------------------------------------------ */
/* D6. The protection read is gated like the irreversible pair.               */
/* ------------------------------------------------------------------------ */

test('D6: readAreaProtection sends NOTHING before the probe, with a tag selected', async () => {
  const { reader, transport } = await selected();
  const before = reader.tag.sent.length;
  await assert.rejects(
    () => transport.readAreaProtection(1),
    chipCode('PROTECT_FAILED', (e) => assert.match(e.message, /Refusing to read area protection/)),
  );
  assert.equal(reader.tag.sent.length, before, 'not one APDU');
  await transport.close();
});

test('D6: readAreaProtection after the probe sends ReadConfiguration FID 00 PID 00 and reads the one data byte', async () => {
  const { reader, transport } = await proven();
  reader.tag.areaProtection = 0x01;
  const state = await transport.readAreaProtection(1);
  assert.deepEqual(state, { protection: 'write_protected', passwordNumber: 1 });
  const frame = framesSent(reader.tag).at(-1);
  assert.deepEqual(frame, [0x22, A0, 0x02, ...UID_ON_AIR, 0x00, 0x00]);
  await transport.close();
});

test('D6: readAreaProtection refuses a value with reserved bits set', async () => {
  const { reader, transport } = await proven();
  reader.tag.areaProtection = 0x11;
  await assert.rejects(() => transport.readAreaProtection(1), chipCode('PROTECT_FAILED', (e) => assert.match(e.message, /reserved bits/)));
  await transport.close();
});

test('D6: readAreaProtection after release is refused', async () => {
  const { reader, transport } = await proven();
  await transport.releaseTag();
  await transport.waitForTag(200);
  const before = reader.tag.sent.length;
  await assert.rejects(() => transport.readAreaProtection(1), chipCode('PROTECT_FAILED'));
  assert.equal(reader.tag.sent.length, before);
  await transport.close();
});

/* ------------------------------------------------------------------------ */
/* D7 and F3. A protection refusal is recognised by the tag's own answer,     */
/* after the field has been cycled.                                           */
/* ------------------------------------------------------------------------ */

test('D7: the proof write is an addressed Write Single Block: 22h, 21h, the UID LSB first, block, four bytes', () => {
  assert.equal(hex(writeSingleBlockFrame(UID_BYTES, 1, Uint8Array.from([0x03, 0x1a, 0xd1, 0x01]))), '22 21 66 55 44 33 22 11 02 e0 01 03 1a d1 01');
  assert.equal(ISO15693_ERROR_BLOCK_LOCKED, 0x12, 'DS13304 Table 107: "12h Write access to requested block is protected and security session is closed"');
});

test('F3: the RF cycle is the manual\'s Manage Session RF Off, Timer, RF On, with Lc checked', () => {
  assert.equal(hex(ACS_RF_CYCLE), 'ff c2 00 00 0b 83 00 5f 46 04 10 27 00 00 84 00');
  assert.equal(ACS_RF_CYCLE[4], ACS_RF_CYCLE.length - 5, 'Lc counts the data field, and there is no Le');
  assert.equal(RF_OFF_US, 10_000);
  assert.ok(RF_OFF_US >= 1000, 'the Manage Session timer range starts at 1000 µs (manual 5.3.5.3)');
  assert.ok(RF_OFF_US >= 2000, 'and the tag needs the field off for tRF_OFF, 2 ms minimum (DS13304 Table 172)');
});

test('F3: the proof is UID read, session start, RF cycle, switch, the write, session end', async () => {
  const { reader, transport } = await selected();
  reader.tag.areaProtection = 0x01;
  const before = reader.tag.sent.length;
  const boots = reader.tag.boots;
  assert.equal(await transport.proveWriteRefused(1, new Uint8Array(4), UID), 'refused');
  const sent = reader.tag.sent.slice(before);
  assert.equal(sent.length, 6);
  assert.equal(sent[0], 'ff ca 00 00 00');
  assert.equal(sent[1], 'ff c2 00 00 02 81 00');
  assert.equal(sent[2], hex(ACS_RF_CYCLE));
  assert.equal(sent[3], hex(ACS_SWITCH_ISO15693));
  assert.deepEqual(frameOf(sent[4]!), [0x22, 0x21, ...UID_ON_AIR, 0x01, 0, 0, 0, 0]);
  assert.equal(sent[5], 'ff c2 00 00 02 82 00');
  assert.equal(reader.tag.boots, boots + 1, 'the tag booted again, so the stored protection is now enforced');
  assert.equal(reader.tag.sent.filter((a) => a.startsWith('ff d6')).length, 0, 'not Update Binary, whose only error is "6X XXh Fail"');
  await transport.close();
});

test('D7: a plain success is an accepted write', async () => {
  const { transport } = await selected();
  assert.equal(await transport.proveWriteRefused(1, new Uint8Array(4), UID), 'accepted');
  await transport.close();
});

for (const [label, setUp] of [
  ['a tag error other than 0x12', (r: FakeReader) => (r.tag.protectedWriteError = 0x0f)],
  ['error 0x10, block not available', (r: FakeReader) => (r.tag.protectedWriteError = 0x10)],
  ['error 0x13, programming failed', (r: FakeReader) => (r.tag.protectedWriteError = 0x13)],
  ['a timeout', (r: FakeReader) => (r.tag.tagOverride = () => null)],
  ['a CRC error', (r: FakeReader) => (r.tag.exchangeOverride = () => [...C0_OK, 0x92, 0x01, 0x00, 0x96, 0x02, 0x01, 0x00, 0x97, 0x02, 0x01, 0x12, ...OK])],
] as const) {
  test(`D7: ${label} on the proof write is never read as protection`, async () => {
    const { reader, transport } = await selected();
    reader.tag.areaProtection = 0x01;
    setUp(reader);
    await assert.rejects(() => transport.proveWriteRefused(1, new Uint8Array(4), UID), chipCode('PROTECT_FAILED'));
    await transport.close();
  });
}

test('D7: the simulator reports refused only for its own AREA_PROTECTED, and rethrows an injected write fault', async () => {
  const sim = new SimulatorTransport({ faults: { 1: 'write-fail' } });
  await sim.open();
  await sim.waitForTag(100);
  await assert.rejects(() => sim.proveWriteRefused(1, new Uint8Array(4), null), chipCode('WRITE_FAILED'));
});

/* ------------------------------------------------------------------------ */
/* F8. proveWriteRefused checks the UID itself.                               */
/* ------------------------------------------------------------------------ */

for (const [label, expected, swap] of [
  ['the unit\'s UID is not the selected one', 'e002112233778899', false],
  ['the tag in the field was swapped silently', UID, true],
  ['the unit has no UID', null, false],
] as const) {
  test(`F8: the proof write is not sent when ${label}`, async () => {
    const { reader, transport } = await selected();
    if (swap) reader.tag.uidLsbFirst = OTHER_UID_LSB_FIRST;
    const before = reader.tag.sent.length;
    await assert.rejects(() => transport.proveWriteRefused(1, new Uint8Array(4), expected), chipCode('TAG_CHANGED', (e) => assert.match(e.message, /The proof write was not sent/)));
    assert.deepEqual(reader.tag.sent.slice(before).filter((a) => !a.startsWith('ff ca')), [], 'nothing but UID reads');
    await transport.close();
  });
}

/* ------------------------------------------------------------------------ */
/* D8. The probe runs inside --protect, before any irreversible command.      */
/* ------------------------------------------------------------------------ */

async function protectOnReader(reader: FakeReader, current = TagPassword.factoryDefault()) {
  const transport = new RecordingTransport(await openWith(reader));
  const session = new UnitSession({ transport, uri: URI, code: 'ps', unlockPassword: current });
  await session.selectTag();
  await session.write();
  const receipt = await session.verify();
  const result = session.protect(receipt, { currentPassword: current, newPassword: TagPassword.fromHex(NEW_PASSWORD, 'new') });
  return { transport, session, result };
}

test('D8: a full --protect on the fake reader runs the probe first and ends protected, proven by the tag refusing a write', async () => {
  const reader = new FakeReader(ACR1552U);
  const { transport, session, result } = await protectOnReader(reader);
  const outcome = await result;
  assert.equal(session.phase, 'protected');
  assert.equal(outcome.refusalProven, true);
  assert.equal(outcome.unlockProven, true);
  assert.equal(outcome.opcodeProbe, 'passed');
  assert.equal(hex(reader.tag.password), '0a 1b 2c 3d 4e 5f 60 71');
  assert.equal(reader.tag.areaProtection, 0x01);
  assert.equal(reader.tag.activeAreaProtection, 0x01);

  const seq = transport.methodSequence();
  const probe = seq.indexOf('verifyOpcodes');
  assert.ok(probe > seq.lastIndexOf('readBlocks', probe), 'after the pre protection read');
  assert.ok(probe < seq.indexOf('writePassword') && probe < seq.indexOf('setAreaProtection'), 'before the irreversible pair');
  assert.ok(seq.indexOf('readAreaProtection') < seq.lastIndexOf('releaseTag'), 'state read while the proof still stands');
  // N2: the readability check comes after the refusal proof, which cycles the field. N1: the unlock proof is last.
  assert.ok(seq.indexOf('proveWriteRefused') < seq.lastIndexOf('readBlocks'), 'read after the RF cycle');
  assert.ok(seq.lastIndexOf('readBlocks') < seq.indexOf('proveWriteUnlocked'));
  assert.equal(seq.at(-1), 'proveWriteUnlocked');

  const st = commandsSent(reader.tag);
  const firstIrreversible = st.findIndex((c) => c === B1 || c === A1);
  assert.deepEqual(st.slice(0, 2), [B4, B3], 'the unlock presentation at select');
  assert.ok(st.slice(2, firstIrreversible).filter((c) => c === B3).length >= 3, 'the probe precedes the first irreversible frame');
  await transport.close();
});

test('D8: a probe that fails refuses --protect with a clear message, and no irreversible frame is sent', async () => {
  const reader = new FakeReader(ACR1552U);
  // The tag accepts every PresentPassword, as a wrong framing could make it seem to.
  reader.tag.tagOverride = (f) => (f[1] === B3 ? [0x00] : reader.tag.datasheetAnswer(f));
  const { transport, session, result } = await protectOnReader(reader);
  await assert.rejects(
    () => result,
    chipCode('PROTECT_FAILED', (e) => {
      assert.match(e.message, /Refusing to protect this tag: the opcode probe did not pass/);
      assert.match(e.remedy, /Nothing has been locked/);
    }),
  );
  assert.equal(session.phase, 'failed');
  assert.equal(transport.countOf('writePassword'), 0);
  assert.equal(transport.countOf('setAreaProtection'), 0);
  assert.deepEqual(irreversibleFrames(reader), []);
  await transport.close();
});

test('D8: a hardware transport with no probe is refused protection outright', async () => {
  const sim = new SimulatorTransport();
  const hardware: TagTransport = {
    name: 'unprobed',
    isHardware: true,
    open: () => sim.open(),
    close: () => sim.close(),
    waitForTag: (ms) => sim.waitForTag(ms),
    readBlocks: (first, count) => sim.readBlocks(first, count),
    writeBlock: (block, data) => sim.writeBlock(block, data),
    presentPassword: (n, pw) => sim.presentPassword(n, pw),
    writePassword: (n, pw) => sim.writePassword(n, pw),
    setAreaProtection: (area, protection, n) => sim.setAreaProtection(area, protection, n),
    readAreaProtection: (area) => sim.readAreaProtection(area),
    proveWriteRefused: (block, data, uid) => sim.proveWriteRefused(block, data, uid),
    proveWriteUnlocked: (block, data, n, pw, uid) => sim.proveWriteUnlocked(block, data, n, pw, uid),
    releaseTag: () => sim.releaseTag(),
    completeUnit: () => sim.completeUnit(),
  };
  const transport = new RecordingTransport(hardware);
  await transport.open();
  const session = new UnitSession({ transport, uri: URI, code: 'ps' });
  await session.selectTag();
  await session.write();
  const receipt = await session.verify();
  await assert.rejects(
    () => session.protect(receipt, { currentPassword: TagPassword.factoryDefault(), newPassword: TagPassword.fromHex(NEW_PASSWORD, 'new') }),
    chipCode('PROTECT_FAILED', (e) => assert.match(e.message, /has no opcode probe/)),
  );
  assert.equal(transport.countOf('setAreaProtection'), 0);
  assert.equal(transport.countOf('writePassword'), 0);
});

test('D8 and F2: the gate refusal says this command was not sent, and no longer that nothing was sent to the tag', async () => {
  const { transport } = await selected();
  await assert.rejects(
    () => transport.setAreaProtection(1, 'write_protected', 1),
    chipCode('PROTECT_FAILED', (e) => {
      assert.match(e.message, /This command was not sent\./);
      assert.doesNotMatch(e.message, /Nothing was sent to the tag/);
      assert.match(e.remedy, /runs automatically as part of --protect/);
      assert.match(e.remedy, /password 1 and configuration password are still the factory default/);
      assert.doesNotMatch(e.remedy, /bare tag/);
      assert.doesNotMatch(e.remedy, /^Run the opcode probe/);
    }),
  );
  await transport.close();
});

test('D8: the simulator path has no probe, and a simulated protect still completes', async () => {
  const sim = new SimulatorTransport();
  assert.equal((sim as TagTransport).verifyOpcodes, undefined);
  const transport = new RecordingTransport(sim);
  assert.equal(transport.verifyOpcodes, undefined, 'wrapping never adds a probe');
  await transport.open();
  const session = new UnitSession({ transport, uri: URI, code: 'ps' });
  await session.selectTag();
  await session.write();
  const outcome = await session.protect(await session.verify(), {
    currentPassword: TagPassword.factoryDefault(),
    newPassword: TagPassword.fromHex(NEW_PASSWORD, 'new'),
  });
  assert.equal(outcome.opcodeProbe, 'not-applicable');
});

/* ------------------------------------------------------------------------ */
/* F1. Every frame addressed, and a second tag in the field is never touched. */
/* ------------------------------------------------------------------------ */

test('F1: every frame of a full --protect is addressed to the selected UID, in the place the datasheet puts it', async () => {
  const reader = new FakeReader(ACR1552U);
  const { result } = await protectOnReader(reader);
  await result;
  const frames = framesSent(reader.tag);
  assert.ok(frames.length >= 15);
  for (const f of frames) {
    assert.equal(f[0], 0x22, `flags of ${hex(Uint8Array.from(f))}`);
    // Custom commands: after the IC Mfg code (Tables 144 to 166). Standard 21h: after the opcode (Table 105).
    const at = f[1] === 0x21 ? 2 : 3;
    assert.deepEqual(f.slice(at, at + 8), UID_ON_AIR, `address of ${hex(Uint8Array.from(f))}`);
  }
});

test('F1: with a second bare tag in the field, it is never written, never has its password changed and is never protected', async () => {
  const reader = new FakeReader(ACR1552U);
  const neighbour = new FakeTag();
  neighbour.uidLsbFirst = OTHER_UID_LSB_FIRST;
  reader.tag.neighbours = [neighbour];
  const { session, result } = await protectOnReader(reader);
  await result;
  assert.equal(session.phase, 'protected');
  assert.equal(hex(reader.tag.password), '0a 1b 2c 3d 4e 5f 60 71');
  assert.equal(hex(neighbour.password), '00 00 00 00 00 00 00 00');
  assert.equal(neighbour.areaProtection, 0x00);
  assert.equal(neighbour.activeAreaProtection, 0x00);
  assert.ok(neighbour.memory.every((b) => b === 0), 'its memory is untouched');
  assert.deepEqual(neighbour.executed, [], 'it executed no frame at all');
});

test('F1: worst case, a second tag whose answers coincide with the selected one\'s, is still never touched', async () => {
  // The review's case: identical answers from two tags need not show as a collision. With
  // cover coding the random numbers would normally differ, so this forces them equal.
  // Without addressing, this neighbour ends with the new password and protection.
  const reader = new FakeReader(ACR1552U);
  const neighbour = new FakeTag();
  neighbour.uidLsbFirst = OTHER_UID_LSB_FIRST;
  Object.defineProperty(neighbour, 'nextRandom', { get: () => reader.tag.randomsIssued.at(-1) ?? 0x1de6, set: () => undefined });
  reader.tag.neighbours = [neighbour];
  const { session, result } = await protectOnReader(reader);
  await result;
  assert.equal(session.phase, 'protected');
  assert.equal(hex(neighbour.password), '00 00 00 00 00 00 00 00');
  assert.equal(neighbour.areaProtection, 0x00);
  assert.deepEqual(neighbour.executed, []);
});

test('F1: the probe proves the addressed framing: a path on which addressed frames get no answer never passes', async () => {
  const { reader, transport } = await selected();
  reader.tag.ignoresAddressed = true;
  const probe = await transport.verifyOpcodes();
  assert.equal(probe.proven, false);
  for (const [, call] of irreversible) await assert.rejects(() => call(transport), chipCode('PROTECT_FAILED'));
  assert.deepEqual(irreversibleFrames(reader), []);
  await transport.close();
});

/* ------------------------------------------------------------------------ */
/* F2 and F4. After Write Password starts, nothing is reported as harmless.   */
/* ------------------------------------------------------------------------ */

const NEW = () => TagPassword.fromHex(NEW_PASSWORD, 'new');
function mayBeLocked(originalCode: string, original: RegExp) {
  return chipCode('PROTECT_FAILED', (e) => {
    assert.match(e.message, /Password 1 may already have been changed by this run/);
    assert.match(e.message, new RegExp(`new password fingerprint ${NEW().fingerprint()}`));
    assert.match(e.message, /Label the tag LOCKED\?/);
    assert.match(e.message, new RegExp(`Original message: ${originalCode}: `));
    assert.match(e.message, original);
    assert.doesNotMatch(e.message, new RegExp(NEW_PASSWORD), 'the password itself is never printed');
    assert.match(e.remedy, /LOCKED\? password discarded/);
    assert.doesNotMatch(e.remedy, /Nothing (has been|was) (locked|sent)/);
    assert.equal(e.detail['mayBeLocked'], true);
    assert.equal(e.detail['originalCode'], originalCode);
  });
}

test('F2 (S1): a reader error on the WritePassword exchange after the tag applied it is reported as LOCKED?, not as a reseat', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.tag.exchangeOverride = (frame, normal) => {
    const answer = normal();
    if (frame[1] === B1) throw new Error('[ RemovedCard ] - Error in native function');
    return answer;
  };
  const { session, result } = await protectOnReader(reader);
  await assert.rejects(() => result, mayBeLocked('TRANSPORT_UNAVAILABLE', /The reader rejected a command/));
  assert.equal(session.phase, 'failed');
  assert.equal(hex(reader.tag.password), '0a 1b 2c 3d 4e 5f 60 71', 'the tag really did take the new password');
});

for (const [label, failing] of [
  ['S2: End Session fails after WritePassword', 'ff c2 00 00 02 82 00'],
  ['S3: the UID read before WriteConfiguration fails', 'ff ca 00 00 00'],
] as const) {
  test(`F2 (${label}): the gate refusal that follows is reported as LOCKED?, and WriteConfiguration is not sent`, async () => {
    const reader = new FakeReader(ACR1552U);
    let sawB1 = false;
    let failed = false;
    reader.tag.exchangeOverride = (frame, normal) => {
      if (frame[1] === B1) sawB1 = true;
      return normal();
    };
    reader.tag.failOn = (apdu) => {
      if (sawB1 && !failed && apdu === failing) return (failed = true);
      return false;
    };
    const { result } = await protectOnReader(reader);
    await assert.rejects(() => result, mayBeLocked('PROTECT_FAILED', /Refusing to apply area protection: .*This command was not sent\./));
    assert.equal(failed, true);
    assert.equal(commandsSent(reader.tag).filter((c) => c === A1).length, 0);
    assert.equal(hex(reader.tag.password), '0a 1b 2c 3d 4e 5f 60 71');
  });
}

test('F2: a WriteConfiguration that is not confirmed is reported as LOCKED? with its own message appended', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.tag.tagOverride = (f) => (f[1] === A1 ? null : reader.tag.datasheetAnswer(f));
  const { result } = await protectOnReader(reader);
  await assert.rejects(() => result, mayBeLocked('PROTECT_FAILED', /Setting protection on area 1 was not confirmed/));
});

test('F4: a protection read of "none" after WriteConfiguration says the tag may already be protected, LOCKED?', async () => {
  const reader = new FakeReader(ACR1552U);
  let sawA1 = false;
  reader.tag.tagOverride = (f) => {
    if (f[1] === A1) sawA1 = true;
    return f[1] === A0 && sawA1 ? [0x00, 0x00] : reader.tag.datasheetAnswer(f);
  };
  const { result } = await protectOnReader(reader);
  await assert.rejects(
    () => result,
    mayBeLocked('PROTECT_FAILED', /reports protection state "none".*The tag may already be protected/),
  );
});

test('F2 and F8 (U1): a different tag after release is TAG_CHANGED, reported LOCKED?, and the new tag gets no ISO 15693 frame', async () => {
  const reader = new FakeReader(ACR1552U);
  const other = new FakeTag();
  other.uidLsbFirst = OTHER_UID_LSB_FIRST;
  reader.onConnect = (n) => {
    if (n === 2) {
      // Same content, so only the UID can tell them apart.
      other.memory.set(reader.tag.memory);
      reader.tag = other;
    }
  };
  const { result } = await protectOnReader(reader);
  await assert.rejects(() => result, mayBeLocked('TAG_CHANGED', /A different tag came back into the field/));
  assert.equal(other.sent.filter((a) => a.startsWith('ff c2 00 01')).length, 0, 'no transceived frame reached the second tag');
  assert.deepEqual(other.executed, []);
});

/* ------------------------------------------------------------------------ */
/* F3. A reader that leaves the field up on unpower still gets a true proof.  */
/* ------------------------------------------------------------------------ */

test('F3 (S4): when releasing the card does not drop the field, the RF cycle still makes the proof true, and the tag is recorded protected', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.tag.unpowerDropsField = false;
  const { session, result } = await protectOnReader(reader);
  const outcome = await result;
  assert.equal(session.phase, 'protected');
  assert.equal(outcome.refusalProven, true);
  assert.equal(reader.tag.activeAreaProtection, 0x01);
});

test('F3: an accepted proof write says the tag may be protected and its password was changed, LOCKED?', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.tag.tagOverride = (f) => (f[1] === 0x21 ? [0x00] : reader.tag.datasheetAnswer(f));
  const { result } = await protectOnReader(reader);
  await assert.rejects(
    () => result,
    mayBeLocked('PROTECT_FAILED', /proof write to block 1 was accepted.*The tag may be protected, and its password was changed by this run/),
  );
});

/* ------------------------------------------------------------------------ */
/* F8 (R1). The probe's own UID re-read.                                      */
/* ------------------------------------------------------------------------ */

test('F8 (R1): a tag swapped after the probe\'s last answer and before its UID read is not proven', async () => {
  const { reader, transport } = await selected();
  reader.tag.tagOverride = (f) => {
    const answer = reader.tag.datasheetAnswer(f);
    if (f[1] === A0 && f[3] === 0xff) reader.tag.uidLsbFirst = OTHER_UID_LSB_FIRST;
    return answer;
  };
  const probe = await transport.verifyOpcodes();
  assert.equal(probe.proven, false);
  assert.match(probe.detail, /the tag in the field now reads uid e002112233778899/);
  for (const [, call] of irreversible) await assert.rejects(() => call(transport), chipCode('PROTECT_FAILED'));
  assert.deepEqual(irreversibleFrames(reader), []);
  await transport.close();
});

test('F8 (R1): in a full --protect, a tag swapped before the probe\'s UID read stops the run with nothing irreversible sent', async () => {
  const reader = new FakeReader(ACR1552U);
  let swapped = false;
  reader.tag.tagOverride = (f) => {
    const answer = reader.tag.datasheetAnswer(f);
    if (!swapped && f[1] === A0 && f[3] === 0xff) {
      swapped = true;
      reader.tag.uidLsbFirst = OTHER_UID_LSB_FIRST;
    }
    return answer;
  };
  const { transport, result } = await protectOnReader(reader);
  await assert.rejects(() => result, chipCode('PROTECT_FAILED', (e) => assert.match(e.message, /opcode probe did not pass.*tag in the field now reads uid/)));
  assert.equal(transport.countOf('writePassword'), 0);
  assert.deepEqual(irreversibleFrames(reader), []);
});

test('F8 (R1): a tag swapped straight after the second PresentPassword is not proven either', async () => {
  const { reader, transport } = await selected();
  let b3 = 0;
  reader.tag.tagOverride = (f) => {
    const answer = reader.tag.datasheetAnswer(f);
    if (f[1] === B3 && ++b3 === 2) reader.tag.uidLsbFirst = OTHER_UID_LSB_FIRST;
    return answer;
  };
  assert.equal((await transport.verifyOpcodes()).proven, false);
  await transport.close();
});

/* ------------------------------------------------------------------------ */
/* F7. The batch never retries a unit that failed after its probe passed.     */
/* ------------------------------------------------------------------------ */

async function batchOnReader(reader: FakeReader) {
  const journalPath = join(mkdtempSync(join(tmpdir(), 'chip-cli-lock2-')), 'run.jsonl');
  const events: BatchEvent[] = [];
  const transport = new PcscTransport(undefined, { loadBinding: async () => new FakeBinding([reader]), readerTimeoutMs: 50 });
  const summary = await runBatch({
    table: RedirectTable.load(),
    code: 'ps',
    count: 1,
    journalPath,
    transport,
    dryRun: false,
    protect: true,
    currentPassword: TagPassword.factoryDefault(),
    newPassword: NEW(),
    toolVersion: 'test',
    operator: 'test-operator',
    attemptsPerUnit: 2,
    tagTimeoutMs: 200,
    onEvent: (e) => events.push(e),
  });
  return { summary, events, journal: readJournal(journalPath) };
}

test('F7: a unit that fails after WritePassword started is journalled once and never retried', async () => {
  const reader = new FakeReader(ACR1552U);
  reader.tag.exchangeOverride = (frame, normal) => {
    const answer = normal();
    if (frame[1] === B1) throw new Error('[ RemovedCard ] - Error in native function');
    return answer;
  };
  const { summary, events, journal } = await batchOnReader(reader);
  assert.deepEqual(summary.failed, [1]);
  assert.equal(journal.units.length, 1);
  assert.equal(events.filter((e) => e.type === 'unit-retry').length, 0);
  assert.equal(commandsSent(reader.tag).filter((c) => c === B1).length, 1, 'WritePassword went out once');
});

test('F7: a unit that fails after the probe passed but before any irreversible command is not retried either', async () => {
  const reader = new FakeReader(ACR1552U);
  // The presentation UnitSession makes after the probe is the fifth B3 of the unit.
  let b3 = 0;
  reader.tag.tagOverride = (f) => (f[1] === B3 && ++b3 === 5 ? [0x01, 0x0f] : reader.tag.datasheetAnswer(f));
  const { summary, events, journal } = await batchOnReader(reader);
  assert.deepEqual(summary.failed, [1]);
  assert.equal(journal.units.length, 1);
  assert.equal(journal.units[0]?.error?.code, 'PASSWORD_REJECTED');
  assert.equal(events.filter((e) => e.type === 'unit-retry').length, 0);
  assert.equal(irreversibleFrames(reader).length, 0);
});

test('F7: a unit that fails before the probe is still retried, as before', async () => {
  const reader = new FakeReader(ACR1552U);
  // The first unlock presentation at select times out; the retry goes through.
  let b3 = 0;
  reader.tag.tagOverride = (f) => (f[1] === B3 && ++b3 === 1 ? null : reader.tag.datasheetAnswer(f));
  const { summary, events, journal } = await batchOnReader(reader);
  assert.equal(events.filter((e) => e.type === 'unit-retry').length, 1);
  assert.equal(journal.units.length, 2);
  assert.deepEqual(summary.succeeded, [1]);
});
