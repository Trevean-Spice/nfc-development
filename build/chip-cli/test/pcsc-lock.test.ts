/**
 * The protection path of the PC/SC transport against the ACS ACR1552U reference manual,
 * and the D66 gate made stricter. Written Sunday 25 October 2026, for findings D1 to D8
 * of the reader setup report.
 *
 * **These tests do not prove anything about silicon.** They prove the bytes the tool
 * sends are the bytes the manual (REF-ACR1552U-Series 1.09, section 5.3.5) lays out, that
 * every answer is read the strict way, and that the irreversible pair and the 0xBA read
 * form send nothing unless the probe passed on the tag in the field now. The fake tag
 * behind them is a model of the documents. README section 6 says what is still unproven.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACS_SESSION_END,
  ACS_SESSION_START,
  ACS_SWITCH_ISO15693,
  ISO15693_ERROR_BLOCK_LOCKED,
  PcscTransport,
  TRANSCEIVE_TIMEOUT_US,
  c0Problem,
  judgeOpcodeProbe,
  parseBerTlv,
  parseTransceiveAnswer,
  transparentExchangeApdu,
  writeSingleBlockFrame,
  type TagAnswer,
} from '../src/transport/pcsc.js';
import { isChipError } from '../src/chip/errors.js';
import { TagPassword } from '../src/chip/password.js';
import { ST_COMMANDS } from '../src/chip/st-custom.js';
import { SimulatorTransport } from '../src/transport/simulator.js';
import { RecordingTransport, type TagTransport } from '../src/transport/transport.js';
import { UnitSession } from '../src/workflow/unit.js';
import {
  ACR1552U,
  C0_NO_RESPONSE_FROM_TAG,
  C0_OK,
  FakeBinding,
  FakeReader,
  OK,
  OTHER_UID_LSB_FIRST,
  carriesSt,
  exchangeAnswer,
  frameOf,
  hex,
} from './fake-acr1552u.js';

const B3 = ST_COMMANDS.PRESENT_PASSWORD.code;
const B1 = ST_COMMANDS.WRITE_PASSWORD.code;
const BA = ST_COMMANDS.SET_MEMORY_PROTECTION.code;
const URI = 'https://treveanspice.com/t/ps';
const NEW_PASSWORD = '0a1b2c3d4e5f6071';

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

async function proven(reader = new FakeReader(ACR1552U)): Promise<{ reader: FakeReader; transport: PcscTransport }> {
  const ctx = await selected(reader);
  const probe = await ctx.transport.verifyOpcodes();
  assert.equal(probe.proven, true, probe.detail);
  return ctx;
}

function chipCode(code: string, also?: (e: { message: string; remedy: string }) => void) {
  return (error: unknown) => {
    assert.ok(isChipError(error), 'must be a ChipError so the CLI can render a remedy');
    assert.equal(error.code, code, error.message);
    also?.(error);
    return true;
  };
}

const irreversibleFrames = (reader: FakeReader) => reader.tag.sent.filter((a) => carriesSt(a, B1) || carriesSt(a, BA));
const ok = (data: number[] = []): TagAnswer => ({ kind: 'ok', data: Uint8Array.from(data) });
const err = (errorCode: number): TagAnswer => ({ kind: 'error', errorCode });
const none = (reason: string): TagAnswer => ({ kind: 'no-answer', reason });

const irreversible = [
  ['writePassword', (t: PcscTransport) => t.writePassword(1, TagPassword.fromHex(NEW_PASSWORD, 'new').toBytes())],
  ['setAreaProtection', (t: PcscTransport) => t.setAreaProtection(1, 'write_protected', 1)],
] as const;

/* ------------------------------------------------------------------------ */
/* D1. Switch Protocol selects ISO 15693. Manual 5.3.5.5 and 5.3.5.5.1.       */
/* ------------------------------------------------------------------------ */

test('D1: Switch Protocol carries 8F 02 02 03 (RF 02h ISO15693, layer 3) and Le 00, per manual 5.3.5.5', () => {
  assert.equal(hex(ACS_SWITCH_ISO15693), 'ff c2 00 02 04 8f 02 02 03 00');
  // The RF byte. 00h is ISO14443A, which is what the tool used to send.
  assert.equal(ACS_SWITCH_ISO15693[7], 0x02);
});

test('D1: session start and end are the manual example bytes, 5.3.5.6 steps 1 and 7', () => {
  assert.equal(hex(ACS_SESSION_START), 'ff c2 00 00 02 81 00');
  assert.equal(hex(ACS_SESSION_END), 'ff c2 00 00 02 82 00');
});

test('D1: one ST command is session start, switch to ISO 15693, one exchange, session end, in that order', async () => {
  const { reader, transport } = await selected();
  const before = reader.tag.sent.length;
  await transport.presentPassword(1, new Uint8Array(8));
  const sent = reader.tag.sent.slice(before);
  assert.equal(sent.length, 4);
  assert.equal(sent[0], 'ff c2 00 00 02 81 00');
  assert.equal(sent[1], 'ff c2 00 02 04 8f 02 02 03 00');
  assert.ok(sent[2]!.startsWith('ff c2 00 01 '));
  assert.equal(sent[3], 'ff c2 00 00 02 82 00');
  await transport.close();
});

test('D1: a switch refused inside the C0 object under 90 00 stops the command before the exchange', async () => {
  // The manual's own answer for "no card present", 5.3.5.6 step 4: C0 03 01 64 01 90 00.
  const { reader, transport } = await selected();
  reader.tag.switchOverride = [0xc0, 0x03, 0x01, 0x64, 0x01, ...OK];
  const before = reader.tag.sent.length;
  await assert.rejects(() => transport.presentPassword(1, new Uint8Array(8)), chipCode('PROTECT_FAILED'));
  const sent = reader.tag.sent.slice(before);
  assert.equal(sent.filter((a) => a.startsWith('ff c2 00 01')).length, 0, 'no exchange after a failed switch');
  assert.equal(sent.at(-1), 'ff c2 00 00 02 82 00', 'and the session is still ended');
  await transport.close();
});

test('D1: a switch answer carrying an object the manual does not list for it is a failure', async () => {
  const { reader, transport } = await selected();
  reader.tag.switchOverride = [...C0_OK, 0x97, 0x01, 0x00, ...OK];
  await assert.rejects(() => transport.presentPassword(1, new Uint8Array(8)), chipCode('PROTECT_FAILED'));
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
/* D3. The C0 status and the ISO 15693 flags are read, not only the SW.       */
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
] as const) {
  test(`D3: ${label} is no answer from the tag`, () => {
    const answer = parseTransceiveAnswer(Uint8Array.from(bytes));
    assert.equal(answer.kind, 'no-answer');
    assert.match(answer.kind === 'no-answer' ? answer.reason : '', why);
  });
}

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

test('D3: a password refused by the tag under SW 90 00 is PASSWORD_REJECTED, where the old check saw success', async () => {
  const { reader, transport } = await selected();
  reader.tag.password = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
  await assert.rejects(() => transport.presentPassword(1, new Uint8Array(8)), chipCode('PASSWORD_REJECTED'));
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
  reader.tag.tagOverride = () => [0x00, 0x12, 0x34];
  await assert.rejects(() => transport.presentPassword(1, new Uint8Array(8)), chipCode('PROTECT_FAILED'));
  await transport.close();
});

for (const [label, call] of irreversible) {
  test(`D3: ${label} refused by the tag under SW 90 00 is PROTECT_FAILED, after the probe passed`, async () => {
    const { reader, transport } = await proven();
    reader.tag.tagOverride = () => [0x01, 0x0f];
    await assert.rejects(() => call(transport), chipCode('PROTECT_FAILED', (e) => assert.match(e.message, /not confirmed by the tag/)));
    await transport.close();
  });
}

/* ------------------------------------------------------------------------ */
/* D4. The probe proves "correct", not "different".                           */
/* ------------------------------------------------------------------------ */

test('D4: the probe is proven only by an explicit error for the wrong password and an explicit bare success for the default', () => {
  assert.equal(judgeOpcodeProbe(err(0x0f), ok()).proven, true);
  assert.equal(judgeOpcodeProbe(err(0x10), ok()).proven, true);
});

for (const [label, wrong, right] of [
  ['a timeout and a CRC error, which differ and proved the path under the old rule', none('timeout'), none('CRC')],
  ['a timeout on the wrong password', none('timeout'), ok()],
  ['a timeout on the factory default', err(0x0f), none('timeout')],
  ['a CRC error on the factory default', err(0x0f), none('response status 01 00')],
  ['both refused', err(0x0f), err(0x0f)],
  ['both refused with different codes', err(0x0f), err(0x10)],
  ['both accepted', ok(), ok()],
  ['the factory default accepted with extra bytes', err(0x0f), ok([0x00, 0x00])],
  ['the wrong password "refused" as command not supported', err(0x01), ok()],
  ['the wrong password "refused" as command not recognised', err(0x02), ok()],
  ['the wrong password "refused" as option not supported', err(0x03), ok()],
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
  reader.tag.tagOverride = (frame) => (frame.slice(4).every((b) => b === 0) ? [0x00] : null);
  assert.equal((await transport.verifyOpcodes()).proven, false);
  for (const [, call] of irreversible) await assert.rejects(() => call(transport), chipCode('PROTECT_FAILED'));
  assert.deepEqual(irreversibleFrames(reader), []);
  await transport.close();
});

test('D4: on the wire, a CRC error on the factory default leaves the pair locked', async () => {
  const { reader, transport } = await selected();
  reader.tag.exchangeOverride = (frame) =>
    frame.slice(4).every((b) => b === 0)
      ? [...C0_OK, 0x96, 0x02, 0x01, 0x00, 0x97, 0x01, 0x00, ...OK]
      : exchangeAnswer([0x01, 0x0f]);
  assert.equal((await transport.verifyOpcodes()).proven, false);
  await assert.rejects(() => transport.setAreaProtection(1, 'write_protected', 1), chipCode('PROTECT_FAILED'));
  assert.deepEqual(irreversibleFrames(reader), []);
  await transport.close();
});

test('D4: on the wire, a transport error during the probe leaves the pair locked', async () => {
  const { reader, transport } = await selected();
  let exchanges = 0;
  reader.tag.exchangeOverride = (frame) => {
    exchanges += 1;
    // The tag leaves the field after the first answer, so the second attempt cannot be sent.
    if (exchanges === 1) reader.tag.failTransmit = true;
    return exchangeAnswer(frame.slice(4).every((b) => b === 0) ? [0x00] : [0x01, 0x0f]);
  };
  const probe = await transport.verifyOpcodes();
  assert.equal(probe.proven, false);
  assert.match(probe.detail, /did not complete/);
  reader.tag.failTransmit = false;
  await assert.rejects(() => transport.writePassword(1, new Uint8Array(8).fill(7)), chipCode('PROTECT_FAILED'));
  assert.deepEqual(irreversibleFrames(reader), []);
  await transport.close();
});

test('D4: a tag already carrying a password cannot pass the probe', async () => {
  const { reader, transport } = await selected();
  reader.tag.password = Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2]);
  assert.equal((await transport.verifyOpcodes()).proven, false);
  await transport.close();
});

test('D4: the probe sends Present Password twice, wrong first, with password number 1, and nothing else from the ST set', async () => {
  const { reader, transport } = await selected();
  const before = reader.tag.sent.length;
  await transport.verifyOpcodes();
  const frames = reader.tag.sent.slice(before).map(frameOf).filter((f): f is number[] => f !== null);
  assert.equal(frames.length, 2);
  assert.deepEqual(frames[0]!.slice(0, 4), [0x02, B3, 0x02, 0x01]);
  assert.equal(hex(Uint8Array.from(frames[0]!.slice(4))), 'de ad be ef de ad be ef');
  assert.equal(hex(Uint8Array.from(frames[1]!.slice(4))), '00 00 00 00 00 00 00 00');
  await transport.close();
});

/* ------------------------------------------------------------------------ */
/* D5. The proof belongs to one physical tag and one connection.              */
/* ------------------------------------------------------------------------ */

for (const [label, call] of irreversible) {
  test(`D5: ${label} is locked again after the same tag is selected again`, async () => {
    const { reader, transport } = await proven();
    await transport.waitForTag(200);
    await assert.rejects(() => call(transport), chipCode('PROTECT_FAILED'));
    assert.deepEqual(irreversibleFrames(reader), []);
    await transport.close();
  });

  test(`D5: ${label} is locked when a different tag is selected`, async () => {
    const { reader, transport } = await proven();
    reader.tag.uidLsbFirst = OTHER_UID_LSB_FIRST;
    const identity = await transport.waitForTag(200);
    assert.equal(identity.uid, 'e002112233778899');
    await assert.rejects(() => call(transport), chipCode('PROTECT_FAILED'));
    assert.deepEqual(irreversibleFrames(reader), []);
    await transport.close();
  });

  test(`D5: ${label} is locked after release and reconnect`, async () => {
    const { reader, transport } = await proven();
    await transport.releaseTag();
    await transport.waitForTag(200);
    assert.equal(reader.connects, 2);
    await assert.rejects(() => call(transport), chipCode('PROTECT_FAILED'));
    assert.deepEqual(irreversibleFrames(reader), []);
    await transport.close();
  });

  test(`D5: ${label} is locked after close and reopen of the same transport`, async () => {
    const { reader, transport } = await proven();
    await transport.close();
    await transport.open();
    await transport.waitForTag(200);
    await assert.rejects(() => call(transport), chipCode('PROTECT_FAILED'));
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
    reader.tag.uidLsbFirst = [0x66, 0x55, 0x44, 0x33, 0x22, 0x11, 0x02, 0xe0];
    await assert.rejects(() => call(transport), chipCode('PROTECT_FAILED'));
    assert.deepEqual(irreversibleFrames(reader), []);
    await transport.close();
  });

  test(`D5: ${label} is locked after any transport error`, async () => {
    const { reader, transport } = await proven();
    reader.tag.failTransmit = true;
    await assert.rejects(() => transport.readBlocks(0, 1), chipCode('TRANSPORT_UNAVAILABLE'));
    reader.tag.failTransmit = false;
    await assert.rejects(() => call(transport), chipCode('PROTECT_FAILED'));
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
  assert.ok(carriesSt(sent[3]!, BA));
  await transport.close();
});

test('D5: the probe refuses to prove anything with no tag selected', async () => {
  const transport = await openWith(new FakeReader(ACR1552U));
  const probe = await transport.verifyOpcodes();
  assert.equal(probe.proven, false);
  await transport.close();
});

/* ------------------------------------------------------------------------ */
/* D6. The 0xBA read form is gated like the irreversible pair.                */
/* ------------------------------------------------------------------------ */

test('D6: readAreaProtection sends NOTHING before the probe, with a tag selected', async () => {
  const { reader, transport } = await selected();
  const before = reader.tag.sent.length;
  await assert.rejects(
    () => transport.readAreaProtection(1),
    chipCode('PROTECT_FAILED', (e) => assert.match(e.message, /undocumented 0xBA read form/)),
  );
  assert.equal(reader.tag.sent.length, before, 'not one APDU');
  await transport.close();
});

test('D6: readAreaProtection after the probe sends 0xBA with the one area parameter and reads the one data byte', async () => {
  const { reader, transport } = await proven();
  reader.tag.areaProtection = 0x11;
  const state = await transport.readAreaProtection(1);
  assert.deepEqual(state, { protection: 'write_protected', passwordNumber: 1 });
  const frame = reader.tag.sent.map(frameOf).filter((f) => f !== null && f[1] === BA).at(-1);
  assert.deepEqual(frame, [0x02, BA, 0x02, 0x01]);
  await transport.close();
});

test('D6: readAreaProtection after release is refused, so it can never reach an SO4731 tag the probe cannot pass on', async () => {
  const { reader, transport } = await proven();
  await transport.releaseTag();
  await transport.waitForTag(200);
  const before = reader.tag.sent.length;
  await assert.rejects(() => transport.readAreaProtection(1), chipCode('PROTECT_FAILED'));
  assert.equal(reader.tag.sent.length, before);
  await transport.close();
});

/* ------------------------------------------------------------------------ */
/* D7. A protection refusal is recognised by the tag's own answer.            */
/* ------------------------------------------------------------------------ */

test('D7: the proof write is ISO 15693 Write Single Block, flags 02, 21h, block, four bytes', () => {
  assert.equal(hex(writeSingleBlockFrame(1, Uint8Array.from([0x03, 0x1a, 0xd1, 0x01]))), '02 21 01 03 1a d1 01');
  assert.equal(ISO15693_ERROR_BLOCK_LOCKED, 0x12);
});

test('D7: error 0x12 from the tag is a protection refusal', async () => {
  const { reader, transport } = await selected();
  reader.tag.areaProtection = 0x11;
  assert.equal(await transport.proveWriteRefused(1, new Uint8Array(4)), 'refused');
  const last = reader.tag.sent.filter((a) => a.startsWith('ff c2 00 01')).at(-1)!;
  assert.deepEqual(frameOf(last), [0x02, 0x21, 0x01, 0, 0, 0, 0]);
  assert.equal(reader.tag.sent.filter((a) => a.startsWith('ff d6')).length, 0, 'not Update Binary, whose only error is "6X XXh Fail"');
  await transport.close();
});

test('D7: a plain success is an accepted write', async () => {
  const { transport } = await selected();
  assert.equal(await transport.proveWriteRefused(1, new Uint8Array(4)), 'accepted');
  await transport.close();
});

for (const [label, setUp] of [
  ['a tag error other than 0x12', (r: FakeReader) => (r.tag.protectedWriteError = 0x0f)],
  ['a timeout', (r: FakeReader) => (r.tag.tagOverride = () => null)],
  ['a CRC error', (r: FakeReader) => (r.tag.exchangeOverride = () => [...C0_OK, 0x96, 0x02, 0x01, 0x00, 0x97, 0x02, 0x01, 0x12, ...OK])],
] as const) {
  test(`D7: ${label} on the proof write is never read as protection`, async () => {
    const { reader, transport } = await selected();
    reader.tag.areaProtection = 0x11;
    setUp(reader);
    await assert.rejects(() => transport.proveWriteRefused(1, new Uint8Array(4)), chipCode('PROTECT_FAILED'));
    await transport.close();
  });
}

test('D7: the simulator reports refused only for its own AREA_PROTECTED, and rethrows an injected write fault', async () => {
  const sim = new SimulatorTransport({ faults: { 1: 'write-fail' } });
  await sim.open();
  await sim.waitForTag(100);
  await assert.rejects(() => sim.proveWriteRefused(1, new Uint8Array(4)), chipCode('WRITE_FAILED'));
});

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
  assert.equal(outcome.opcodeProbe, 'passed');
  assert.equal(hex(reader.tag.password), '0a 1b 2c 3d 4e 5f 60 71');
  assert.equal(reader.tag.areaProtection, 0x11);

  const seq = transport.methodSequence();
  const probe = seq.indexOf('verifyOpcodes');
  assert.ok(probe > seq.lastIndexOf('readBlocks', probe), 'after the pre protection read');
  assert.ok(probe < seq.indexOf('writePassword') && probe < seq.indexOf('setAreaProtection'), 'before the irreversible pair');
  assert.ok(seq.indexOf('readAreaProtection') < seq.lastIndexOf('releaseTag'), 'state read while the proof still stands');
  assert.equal(seq.at(-1), 'proveWriteRefused');

  const st = reader.tag.sent.map(frameOf).filter((f): f is number[] => f !== null && f[2] === 0x02).map((f) => f[1]);
  const firstIrreversible = st.findIndex((c) => c === B1 || c === BA);
  assert.deepEqual(st.slice(0, 1), [B3], 'the unlock presentation at select');
  assert.ok(st.slice(1, firstIrreversible).filter((c) => c === B3).length >= 2, 'the probe pair precedes the first irreversible frame');
  await transport.close();
});

test('D8: a probe that fails refuses --protect with a clear message, and no irreversible frame is sent', async () => {
  const reader = new FakeReader(ACR1552U);
  // The tag answers every Present Password the same way, as a wrong framing could.
  reader.tag.tagOverride = (frame) => (frame[1] === B3 ? [0x00] : [0x01, 0x0f]);
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
    proveWriteRefused: (block, data) => sim.proveWriteRefused(block, data),
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

test('D8: the gate remedy no longer sends the operator to a probe command that does not exist', async () => {
  const { transport } = await selected();
  await assert.rejects(
    () => transport.setAreaProtection(1, 'write_protected', 1),
    chipCode('PROTECT_FAILED', (e) => {
      assert.match(e.remedy, /runs automatically as part of --protect/);
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
