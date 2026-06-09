# NFC Technical Specifications

Complete technical reference for NFC chip programming and NDEF message format used in Trevean smart packaging.

## NTAG Chip Specifications

### NTAG216
- **Total Memory**: 888 bytes
- **User Memory**: 729 bytes (after TLV overhead)
- **Read Speed**: ~130 ms
- **Write Speed**: ~340 ms per page
- **Range**: 5-10 cm typical
- **Recommended Use**: Standard spice packaging

### NTAG213
- **Total Memory**: 180 bytes
- **User Memory**: 64 bytes (after TLV overhead)
- **Read Speed**: ~110 ms
- **Write Speed**: ~220 ms per page
- **Range**: 5-10 cm typical
- **Recommended Use**: Small packages or cost-sensitive

### NTAG Comparison
```
Feature              NTAG216    NTAG213
--------------------------------------------
Total Memory         888 bytes  180 bytes
User Memory          729 bytes  64 bytes
Max NDEF Payload     888 bytes  180 bytes
Cost (relative)      100%       60%
Suitable for         Long URLs  Short URLs
```

## NDEF Format Specification

### NDEF Message Structure
```
┌─────────────────────────────────────┐
│  NDEF Message Header (3 bytes)      │
├─────────────────────────────────────┤
│  Record 1 Header                    │
├─────────────────────────────────────┤
│  Record 1 Type Length               │
│  Record 1 Payload Length            │
│  Record 1 Type                      │
│  Record 1 Payload                   │
├─────────────────────────────────────┤
│  Record N (if present)              │
├─────────────────────────────────────┤
│  End of Message (0x00)              │
└─────────────────────────────────────┘
```

### NDEF Record Header Byte
```
Bit 7: MB (Message Begin)
Bit 6: ME (Message End)
Bit 5: CF (Chunk Flag)
Bit 4: SR (Short Record)
Bit 3: IL (ID Length Present)
Bits 2-0: TNF (Type Name Format)
```

### TNF Values
```
0x00: Empty Record
0x01: Well-Known Record (standard types like U, T, etc)
0x02: Media Type (RFC 2045 media type)
0x03: Absolute URI
0x04: External Type (NFC Forum External Type)
0x05: Unknown
0x06: Unchanged
0x07: Reserved
```

## URL Record (RTD_URI) Encoding

### Record Type
- **Type Name Format**: 0x01 (Well-Known)
- **Record Type**: 0x55 (ASCII 'U' for URI)
- **Payload Format**: 1 byte prefix + URI string

### URI Prefix Byte
```
0x00 = <empty>
0x01 = http://www.
0x02 = https://www.
0x03 = http://
0x04 = https://
0x05 = tel:
0x06 = mailto:
0x07-0x23 = (various other protocols)
```

### Example Encoding

**Input**: `https://trevean.com/blend/blend-001`

**Breakdown**:
- Prefix byte: `0x04` (https://)
- URI data: `trevean.com/blend/blend-001` (32 bytes)
- Total payload: 33 bytes

**NDEF Record**:
```
Header:      0xD1 (MB=1, ME=1, SR=0, TNF=0x01)
Type Length: 0x01
Payload Len: 0x21 (33 in decimal)
Type:        0x55 ('U')
Payload:     0x04 "trevean.com/blend/blend-001"
```

## Trevean URL Scheme

### URL Format
```
https://trevean.com/blend/{blendId}
```

### Query Parameters (Optional)
```
https://trevean.com/blend/{blendId}?utm_source=nfc&chipUid={chipUid}
```

### Blend ID Format
- **Format**: `blend-NNN` (lowercase)
- **Example**: `blend-001`, `blend-042`
- **Validation**: Alphanumeric + hyphen only
- **Length**: 8-12 characters typical

## Memory Layout for Trevean NTAG216

### Standard Configuration
```
Offset  Size  Purpose
──────────────────────────────────
0-9     10    Manufacturer/Lock bytes
10-12   3     TLV Header
13-42   30    NDEF Type (0x55)
43-74   32    URI Data
75-887  813   Unused/Available
```

### Actual Usage Example
```
Bytes 0-9:   Reserved (chip configuration)
Bytes 10-11: TLV Header (0xD1, 0x01)
Byte 12:     Payload Length (0x21 = 33)
Byte 13:     URI Prefix (0x04)
Bytes 14-45: URL Data (32 bytes)
Bytes 46-887: Free space (842 bytes available)
```

## Payload Size Calculation

### Formula
```
Total Size = 2 (NDEF message header)
           + 2 (Record header + type length)
           + 1 (Payload length byte)
           + 1 (URI prefix byte)
           + URL_LENGTH
           + 1 (Message end byte)
```

### Example
For URL `https://trevean.com/blend/blend-001`:
```
Message header:     2 bytes
Record header:      2 bytes
Type length:        1 byte
Payload length:     1 byte
URI prefix:         1 byte
URL data:          32 bytes
Message end:        1 byte
─────────────────────────
Total:             40 bytes (out of 888 NTAG216 capacity)
Usage:             4.5%
```

## QR Code Fallback

### Purpose
- Offline scanning without NFC capability
- Backup for non-NFC devices
- QR code placement on package label

### QR Code Content
```
https://trevean.com/blend/{blendId}
```

### QR Code Specifications
- **Version**: 5 (37x37 modules)
- **Error Correction**: L (7%)
- **Module Size**: 2mm typical
- **Quiet Zone**: 4 modules minimum

### QR Code Size Comparison
```
Blend ID Length  URL Length  QR Version
─────────────────────────────────────
8                35          2-3
12               39          3-4
```

## Read/Write Procedures

### Standard Read Procedure (ISO 14443-3A)
```
1. Poll for Type 2 tag
   - Send SENS_REQ
   - Wait for SENS_RES

2. Anti-collision
   - Send SELECT_REQ
   - Get tag UID

3. Read NDEF
   - Send READ command for block containing NDEF
   - Receive 16 bytes per block
   - Continue until message end (0x00)

4. Parse NDEF
   - Extract record headers
   - Decode URL from payload
   - Extract blend ID
```

### Standard Write Procedure
```
1. Same anti-collision as read

2. Write NDEF Data
   - WRITE command for each block
   - 16 bytes per block
   - Verify write with READ

3. Write Lock Bytes
   - Lock critical memory areas
   - Prevent accidental modification

4. Verify Programming
   - Read full tag data
   - Compare with expected
   - Generate report
```

## Error Handling

### Common Issues
```
Issue               Cause                Solution
──────────────────────────────────────────────────
CRC Error          Noise/interference    Retry read
Timeout            Out of range          Move closer
Bad NDEF           Corrupted data        Reprogram
Lock Collision     Partial write         Full erase + reprogram
```

### Retry Strategy
```
Attempt  Delay   Backoff
───────────────────────
1        0ms     Immediate
2        100ms   Linear
3        200ms   Linear
4        500ms   Exponential
5        1000ms  Exponential
```

## Performance Metrics

### Read Performance
```
Operation          Time       Variance
─────────────────────────────────────
Anti-collision     2-5ms      Low
Read NDEF          20-50ms    Medium
URL extraction     <1ms       Very low
─────────────────────────────────────
Total              25-60ms    Medium
```

### Write Performance
```
Operation          Time       Variance
─────────────────────────────────────
Anti-collision     2-5ms      Low
Write block        10-30ms    Medium
Verify write       20-50ms    Medium
Lock bytes         5-10ms     Low
─────────────────────────────────────
Total              40-100ms   High
```

## Compatibility

### Device Support
```
Platform     NFC Support  Read  Write  URL Handler
──────────────────────────────────────────────────
iOS 13+      Core NFC     Yes   No     Custom
iOS 6-12     None         No    No     -
Android 4.4+ NFC API      Yes   Yes    Custom
Android <4.4 None         No    No     -
```

### Browser Fallback
- Direct URL navigation: `https://trevean.com/blend/{blendId}`
- QR code scanning: Opens same URL
- Manual entry: URL visible on package

## Security Considerations

### Data Integrity
- No checksum in basic NDEF
- Use application-level verification
- Chip UID included in database record
- Timestamp verification in API

### Privacy
- No PII in NDEF message
- No encryption (URLs are public)
- User identification happens server-side
- Optional: Include `chipUid` in analytics query

### Anti-Counterfeiting
- Chip UID embedded in NDEF (optional)
- URL routes to central server
- Server validates chip authenticity
- Rate limiting on API endpoints

## Testing Procedures

### Unit Tests
```
1. URL encoding/decoding
2. NDEF record generation
3. Payload size calculation
4. Memory validation
```

### Integration Tests
```
1. Program test chips
2. Read with multiple devices
3. Verify URL extraction
4. Test analytics recording
```

### Field Testing
```
1. Real-world read range
2. Interference scenarios
3. Device compatibility
4. Performance under load
```
