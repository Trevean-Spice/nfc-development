# NFC Technical Specifications

**Project:** Trevean Spice Connected Pantry  
**Production chip:** STMicroelectronics **ST25TV02KC**  
**Document revision:** 2.0 • November 12, 2026  
**Purpose:** NFC tag selection, URI/NDEF encoding, programming, validation, mobile compatibility, packaging, security, and QR fallback.

> **Design change:** This specification supersedes the earlier NTAG213/NTAG216 implementation. The ST25TV02KC communicates using **ISO/IEC 15693 / NFC Forum Type 5**, not ISO/IEC 14443-A / NFC Forum Type 2. NTAG page offsets, command sequences, memory capacities, and timing assumptions must not be reused.

## 1. ST25TV02KC chip specifications

| Attribute                   | ST25TV02KC specification                                     |
| --------------------------- | ------------------------------------------------------------ |
| Manufacturer                | STMicroelectronics                                           |
| Device                      | ST25TV02KC                                                   |
| NFC tag class               | NFC Forum Type 5                                             |
| RF protocol                 | ISO/IEC 15693                                                |
| Operating frequency         | 13.56 MHz                                                    |
| EEPROM                      | 2,560 bits (320 bytes)                                       |
| RF access granularity       | 4-byte blocks                                                |
| RF commands                 | Single-block read/write; multiple-block read; ISO 15693 inventory/selection and supported ST commands |
| Supported RF data rate      | Up to 26 kbit/s                                              |
| Typical block write time    | 5 ms per block, excluding protocol/reader overhead           |
| EEPROM endurance            | Minimum 100,000 write cycles                                 |
| Data retention              | 60 years at 55 °C                                            |
| Operating temperature       | −40 °C to +85 °C                                             |
| Internal tuning capacitance | 23 pF or 99.7 pF, dependent on ordered option                |
| Identification/security     | Factory UID, TruST25 digital signature, configurable protected areas and privacy modes |
| Additional features         | Augmented NDEF, 3-digit unique tap code                      |
| Optional tamper detection   | Supported by **ST25TV02KC-T**, not **ST25TV02KC-A**          |

**Memory distinction:** The 320-byte figure describes the device EEPROM. It is **not** equivalent to 320 bytes of NDEF payload. Actual writable NDEF space depends on the Type 5 capability container, memory mapping, configuration and TLV overhead. The firmware or provisioning tool must obtain the usable capacity from the configured tag, rather than hardcoding it from the datasheet headline.

**Read-range distinction:** No fixed 5–10 cm production range is guaranteed. Read performance depends on the tag antenna, tuning, lid geometry, spice jar contents, nearby metal, phone orientation and reader sensitivity. Characterize the fully assembled packaging.

### 1.1 Selection and variant control

- **ST25TV02KC-A:** no tamper-detection interface.
- **ST25TV02KC-T:** tamper-detection interface; evaluate it if physical lid-opening or resealing detection becomes a product requirement.
- Confirm the **complete orderable part number**, antenna capacitance, inlay/antenna assembly, packaging and supplier programming state before release.
- The ST25TV02KC is **not the ST25TV02K**; confirm that procurement and embedded software consistently specify the **KC** version.

## 2. NDEF format specification

Trevean tags carry a single NFC Forum **Well-Known URI record (RTD_URI)** that directs consumers to blend-specific web content. A standard NDEF URI can be opened by compatible phones without a dedicated Trevean app.

### 2.1 NDEF record header bits

```text
Bit 7: MB   Message Begin
Bit 6: ME   Message End
Bit 5: CF   Chunk Flag
Bit 4: SR   Short Record
Bit 3: IL   ID Length Present
Bits 2–0: TNF   Type Name Format
```

For one short Well-Known URI record, the header is **0xD1** (MB=1, ME=1, CF=0, **SR=1**, IL=0, TNF=001). Note that the previous specification incorrectly described the SR bit as 0.

### 2.2 TNF values

| TNF    | Meaning                 |
| ------ | ----------------------- |
| `0x00` | Empty                   |
| `0x01` | NFC Forum Well-Known    |
| `0x02` | Media type              |
| `0x03` | Absolute URI            |
| `0x04` | NFC Forum external type |
| `0x05` | Unknown                 |
| `0x06` | Unchanged               |
| `0x07` | Reserved                |

### 2.3 URI record encoding

| Field       | Value                                                   |
| ----------- | ------------------------------------------------------- |
| TNF         | `0x01` (Well-Known)                                     |
| Type length | `0x01`                                                  |
| Type        | `0x55` (`U`)                                            |
| Payload     | One URI identifier-code byte followed by UTF-8 URI text |

Common URI identifier codes:

```text
0x00 = no abbreviation
0x01 = http://www.
0x02 = https://www.
0x03 = http://
0x04 = https://
0x05 = tel:
0x06 = mailto:
```

### 2.4 Trevean URL example (fully recalculated)

**Canonical URL:** `https://trevean.com/blend/blend-001`  
**URI identifier code:** `0x04` (`https://`)  
**Remaining string:** `trevean.com/blend/blend-001` = **27 ASCII / UTF-8 bytes**.  
**URI payload:** 1 + 27 = **28 bytes** (`0x1C`).

```text
NDEF bytes                    Meaning
---------------------------------------------------------------
D1                            MB=1, ME=1, SR=1, TNF=Well-Known
01                            Type length = 1
1C                            URI payload length = 28
55                            Type = 'U'
04                            URI identifier = 'https://'
74 72 65 76 65 61 6E 2E ...  UTF-8 'trevean.com/blend/blend-001'
```

The record is **32 bytes total**: 1-byte header + 1-byte type length + 1-byte payload length + 1-byte type + 28-byte payload. For an ordinary short NDEF TLV, the encoded TLV sequence is:

```text
03 20 [32-byte NDEF record] FE
│  │                         └─ Terminator TLV
│  └─ NDEF value length = 32 bytes (0x20)
└─ NDEF Message TLV
```

**Total NDEF TLV footprint = 35 bytes**, excluding Type 5 capability-container bytes and any other mapping/configuration overhead. The `0xFE` terminates the TLV area; it is not an additional byte inside the NDEF message.

## 3. Type 5 memory organization

Unlike an NTAG page layout, the ST25TV02KC is accessed through **4-byte ISO 15693 blocks**. The NFC Forum Type 5 mapping contains a **Capability Container (CC)** and TLVs that locate the NDEF content. The exact CC bytes, starting block and usable NDEF capacity must be determined using the configured chip and the applicable NFC Forum mapping rules.

```text
Schematic layout, NOT fixed physical offsets

+-----------------------------------------------+
| NFC Forum Type 5 Capability Container (CC)    |
+-----------------------------------------------+
| Optional TLVs / tag-specific mapped content   |
+-----------------------------------------------+
| NDEF TLV type (0x03)                          |
| NDEF TLV length (0x20 in this example)         |
+-----------------------------------------------+
| 32-byte NDEF URI record                       |
+-----------------------------------------------+
| Terminator TLV (0xFE)                         |
+-----------------------------------------------+
| Remaining user-area bytes, where available    |
+-----------------------------------------------+
```

**Implementation rule:** Do not assume that NDEF starts at byte 10 or that an 888-byte NTAG216 address space exists. Read/validate the CC and the Type 5 mapping before writing. For a partial-block update, preserve the other bytes of the 4-byte block. Do not overwrite system or protection areas.

### 3.1 Payload calculation

For a single short URI record using a prefix code:

```text
R = UTF-8 byte count of URI text after the identifier-code prefix
URI payload length = 1 + R
NDEF record length = 4 + URI payload length = 5 + R
Short NDEF TLV footprint (with terminator) = 2 + (5 + R) + 1
                                          = 8 + R
Example: R=27  =>  35 bytes of NDEF TLV storage
```

This formula assumes a single short record, one-byte NDEF TLV length and a terminator. Extended lengths, additional records or extra TLVs require separate calculations. Even when an NDEF record fits in the advertised EEPROM size, it must also fit in the **configured NDEF data area**.

## 4. Trevean URL scheme

### 4.1 Consumer URL

```text
https://trevean.com/blend/{blendId}
```

Use lowercase blend identifiers containing letters, digits and hyphens. Examples: `blend-001`, `blend-042`.

The domain above reflects the existing documentation and **must be verified against the production web property before tag programming**. Once printed and locked, URLs are expensive to change. Redirects should remain stable for the lifetime of the packaging.

### 4.2 Optional analytics

Prefer collecting tap/visit attribution server-side after resolving the canonical URL. Optional parameters could be used for a defined campaign or diagnostic purpose, but **do not treat a raw UID or public query parameter as a secret**. Avoid exposing persistent tag identifiers in consumer URLs unless there is a justified privacy and data-handling policy.

## 5. Standard read procedure (ISO 15693 / NFC-V)

```text
1. Poll for NFC-V / ISO 15693 tags (not Type 2 / ISO 14443-A).
2. Execute INVENTORY / anti-collision; obtain the tag's factory UID.
3. Address/select the intended tag as needed by the reader.
4. Read the NFC Type 5 Capability Container and determine mapping.
5. READ SINGLE BLOCK or READ MULTIPLE BLOCKS (4-byte blocks).
6. Locate and parse the NDEF Message TLV (0x03).
7. Decode its RTD_URI record (including identifier code).
8. Validate the HTTPS destination and blend identifier.
9. Navigate to the blend URL or present it in the application UI.
```

The previous NTAG `SENS_REQ`, `SELECT_REQ` and 16-byte/page read assumptions **do not apply** to this IC. A tag UID can identify an inventory record but is not sufficient to authenticate the chip or detect all cloning.

## 6. Standard write / provisioning procedure

```text
1. Confirm complete ST25TV02KC ordering code and writable configuration.
2. INVENTORY tag and record factory UID.
3. Read CC, existing TLVs, available area and access-protection state.
4. Construct and size the canonical NDEF URI message.
5. Format the tag as NFC Type 5 if required using a verified formatter.
6. Write NDEF using ISO 15693 WRITE SINGLE BLOCK operations.
   - Each RF block is 4 bytes.
   - Preserve unrelated bytes when changing a partially used block.
   - Follow applicable NDEF-safe write ordering / anti-tearing guidance.
7. Read back all affected blocks and decode the complete NDEF message.
8. Verify UID, URL, CC, record structure, length and terminator.
9. Write backend inventory record: UID, SKU, batch, variant, timestamp,
   programming station, test result and traceability fields.
10. Apply planned access protection or permanent locks only after validation.
11. Perform final scan in the assembled lid/jar with supported phones.
```

**Locking warning:** Some protection settings are irreversible. Do not perform blanket locks during development. There is no universal “full erase” recovery from a permanently locked or password-protected tag. Provisioning tools must use the correct ST25TV02KC protection model and securely manage passwords if enabled.

## 7. QR code fallback

The QR code should contain the same canonical HTTPS destination as NFC:

```text
https://trevean.com/blend/{blendId}
```

- Place the QR code visibly on the spice label or packaging.
- Select QR version and error correction from the **final encoded URL** and physical print/scanning tests, rather than a fixed version for every SKU.
- Maintain at least a four-module quiet zone.
- Validate readability on curved packaging, under normal kitchen lighting, and after handling/abrasion.
- Display a human-readable destination or short fallback path where space allows.

QR codes do not rely on NFC hardware and offer a fallback for devices or settings where NFC taps do not open the URL.

## 8. Performance and compatibility

### 8.1 Read/write timing

**Datasheet value:** The ST25TV02KC's typical RF write time is about **5 ms per 4-byte block**. This is not the latency of writing a complete NDEF URL, and is not a guarantee of end-to-end phone-tap speed. Total latency depends on reader setup, inventory, block count, command overhead, retries and antenna coupling.

Establish benchmarks with the actual lid/inlay, spice jar, production fixture and representative phones. Record median, 95th-percentile time, failure rate and read distance as measured results, not copied NTAG estimates.

### 8.2 Consumer device compatibility

| Platform                                            | Expectations and constraints                                 |
| --------------------------------------------------- | ------------------------------------------------------------ |
| Compatible recent iPhones                           | NFC Type 5/ISO 15693 support exists on supported hardware; background URL handling and app-based reads depend on model, OS and device state. |
| NFC-capable Android phones                          | NFC-V support is device-dependent; verify with representative models. Android NFC APIs can access Type 5 tags when the device supports NFC-V. |
| Devices without NFC-V or usable background scanning | Use QR code fallback.                                        |
| Browser experience                                  | A valid NDEF HTTPS URI can route to Trevean web content without a Trevean-specific app. |

Do **not** repeat the old broad statements “iOS 13+ read only” or “Android 4.4+ write supported” as universal compatibility rules. Verify the actual required feature against device support and current OS APIs.

## 9. Security, authenticity and privacy

### 9.1 Data integrity

- Read-back verification is mandatory after programming.
- Validate URL format, blend ID and backend record association.
- Treat tag memory as untrusted input; reject unexpected schemes, oversized records, malformed TLVs and unauthorized redirects.
- Protect the manufacturing UID-to-product mapping and keep an audit of any provisioning failures.

### 9.2 Authenticity and anti-counterfeiting

- The UID alone is **not cryptographic proof** that a jar is authentic.
- ST's **TruST25 digital signature** may help establish chip origin if an implemented verification service checks the signature and trusted verification material correctly.
- **Augmented NDEF** and the chip's unique tap-code capability may support later interaction design; these features require deliberate configuration and server-side handling.
- A valid HTTPS URL or one-time database match should not be described as proof against all copying, relay or replay attacks.

### 9.3 Privacy and protection

- Basic NDEF should not include personally identifiable information or reusable application secrets.
- Use HTTPS and server-side access controls for account-specific data.
- Decide whether area password protection, temporary lock, permanent lock, Silent/Discreet modes or kill features are needed before mass programming.
- Evaluate retention and privacy risks before including tag identifiers in web analytics.
- Tamper detection requires the **-T** variant and a suitable physical tamper circuit/assembly. No tamper capability should be promised for the **-A** variant.

## 10. Error handling

| Symptom                  | Potential cause                                       | Response                                               |
| ------------------------ | ----------------------------------------------------- | ------------------------------------------------------ |
| No tag detected          | Weak coupling, metal/liquid effects, non-NFC-V reader | Reposition, verify antenna/inlay and NFC-V support     |
| CRC error / read timeout | Interference or marginal RF field                     | Bounded retry, log failed reads, inspect packaging     |
| Invalid CC / NDEF        | Unformatted tag, invalid TLV, interrupted write       | Check memory map; reformat only if authorized/writable |
| Incorrect destination    | Encoding bug, prefix bug, outdated domain             | Re-decode bytes and test HTTPS redirect                |
| Write denied             | Password protection, locked area, wrong address       | Inspect configuration; stop unsafe retries             |
| Unexpected duplicate UID | Inventory/data error or attempted spoofing            | Escalate for traceability and authenticity review      |

Use bounded retry/backoff (for example, at most three read retries with short delays). Tune retry and timeout policies from measurements. Do not claim a fixed chip-level latency without laboratory evidence.

## 11. Testing and release qualification

### 11.1 Unit and encoding tests

- [ ] URI encoding/decoding preserves the exact canonical URL.
- [ ] Example produces header `D1 01 1C 55 04` and a **35-byte** short NDEF TLV including terminator.
- [ ] CC and Type 5 mapping are parsed correctly.
- [ ] Memory boundary, full-block and partial-block writes are verified.
- [ ] Long URLs, malformed TLVs, invalid schemes and interrupted writes are rejected or handled.
- [ ] Both writable and protected tags behave as designed.

### 11.2 Integration tests

- [ ] Tag UID is associated with the intended SKU and production batch.
- [ ] Read/write operations use NFC-V/ISO 15693 commands.
- [ ] NDEF can be scanned by representative iOS and Android models.
- [ ] Tap opens the correct site and the server routes the blend ID correctly.
- [ ] QR fallback reaches the same destination.
- [ ] Any signature/unique-tap/augmented-NDEF features are tested independently if enabled.

### 11.3 Packaging and manufacturing tests

- [ ] Confirm exact -A or -T device and antenna-tuning option from supplier.
- [ ] Test NFC with the real spice-filled jar and installed lid.
- [ ] Measure read distance, orientation sensitivity and failure rates.
- [ ] Test handling, moisture/temperature exposure and potential metal interference.
- [ ] Verify programming fixture reproducibility and production traceability.
- [ ] Validate irreversible lock settings on sacrificial tags before production.
- [ ] Validate physical tamper sensing only when using a -T variant with supporting hardware.

## 12. Implementation decisions still to confirm

1. **Exact orderable SKU and inlay:** -A versus -T, tuning capacitance, antenna and installation geometry.
2. **Canonical production domain:** verify `trevean.com` versus any current branded domain before encoding 1,000 production jars.
3. **NDEF mapping details:** use the actual CC and manufacturer provisioning guidance to finalize memory offsets and protection settings.
4. **Security model:** decide whether a simple public URL suffices for the first release, or whether digital signature / augmented-NDEF features require implementation now.
5. **Phone and package acceptance criteria:** define tested devices, scan success threshold, read range and maximum acceptable time.

## 13. Primary references

- STMicroelectronics, [ST25TV02KC product overview](https://www.st.com/en/nfc/st25tv02kc.html).
- STMicroelectronics, [ST25TV02KC/ST25TV512C datasheet, DS13304 Rev. 7 (February 2025)](https://www.st.com/resource/en/datasheet/st25tv02kc.pdf).
- STMicroelectronics, [ST25TV series documentation](https://www.st.com/en/nfc/st25tv-series-nfc-tags/documentation.html), including AN5091, *NDEF management with ST25TVxxx products*.
- NFC Forum, applicable *NFC Forum Type 5 Tag Operation Specification* and *NFC Data Exchange Format (NDEF)* specifications.

---

*This document replaces the earlier NTAG chip comparison, NTAG216 memory map, ISO 14443-A read/write workflow, and inaccurate URI length calculations. Validate all production parameters on the actual ST25TV02KC configuration before committing to locked tags or bulk manufacturing.*
