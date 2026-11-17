import NfcManager, { Ndef, NfcTech } from 'react-native-nfc-manager';
import { Platform } from 'react-native';

/**
 * Result type for NFC tag reading operations
 */
export interface NFCReadResult {
  uid: string;
  url?: string;
  blendId?: string;
  success: boolean;
  error?: string;
}

/**
 * NFCService wraps react-native-nfc-manager with application-specific logic
 */
class NFCService {
  private isInitialized = false;

  /**
   * Initialize NFC manager with platform-specific setup
   * Handles iOS CoreNFC and Android NFC API initialization
   */
  async initialize(): Promise<void> {
    try {
      if (this.isInitialized) {
        return;
      }

      await NfcManager.start();
      this.isInitialized = true;
      console.log('NFC Manager started successfully');
    } catch (error) {
      console.error('NFC initialization failed:', error);
      throw new Error(`NFC initialization error: ${error}`);
    }
  }

  /**
   * Clean up NFC resources
   */
  async cleanup(): Promise<void> {
    try {
      if (this.isInitialized) {
        await NfcManager.stop();
        this.isInitialized = false;
        console.log('NFC Manager stopped');
      }
    } catch (error) {
      console.error('NFC cleanup error:', error);
    }
  }

  /**
   * Read NDEF tag and extract blend ID from URL record
   * Returns NFCReadResult with uid, url, and extracted blendId
   */
  async readTag(): Promise<NFCReadResult> {
    if (!this.isInitialized) {
      return {
        uid: '',
        success: false,
        error: 'NFC service not initialized',
      };
    }

    try {
      await NfcManager.requestTechnology([NfcTech.Ndef]);

      const tag = await NfcManager.getTag();
      if (!tag) {
        return {
          uid: '',
          success: false,
          error: 'Failed to read tag',
        };
      }

      const uid = this._bytesToHex(tag.ndefMessage ? tag.id : tag.ndefMessage?.id || []);

      let blendId: string | undefined;
      let url: string | undefined;

      if (tag.ndefMessage && tag.ndefMessage.length > 0) {
        for (const record of tag.ndefMessage) {
          if (
            record.tnf === Ndef.TNF_WELL_KNOWN &&
            record.type === Ndef.RTD_URI
          ) {
            url = this._decodeUrl(record);
            blendId = this._extractBlendIdFromUrl(url);
            break;
          }
        }
      }

      if (!blendId) {
        return {
          uid,
          success: false,
          error: 'No blend ID found in NFC tag',
        };
      }

      return {
        uid,
        url,
        blendId,
        success: true,
      };
    } catch (error) {
      console.error('Error reading NFC tag:', error);
      return {
        uid: '',
        success: false,
        error: `Failed to read tag: ${error}`,
      };
    } finally {
      await NfcManager.cancelTechnologyRequest();
    }
  }

  /**
   * Convert byte array to hex string
   */
  private _bytesToHex(bytes: number[]): string {
    return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Decode URL from NDEF record
   */
  private _decodeUrl(record: any): string {
    const payload = record.payload;
    if (!payload || payload.length === 0) {
      return '';
    }

    const statusByte = payload[0];
    const uriPrefix = this._getUriPrefix(statusByte);
    const uriData = String.fromCharCode(...payload.slice(1));

    return uriPrefix + uriData;
  }

  /**
   * Get URI prefix based on status byte
   */
  private _getUriPrefix(statusByte: number): string {
    const prefixes: { [key: number]: string } = {
      0x00: '',
      0x01: 'http://www.',
      0x02: 'https://www.',
      0x03: 'http://',
      0x04: 'https://',
      0x05: 'tel:',
      0x06: 'mailto:',
      0x07: 'ftp://anonymous:anonymous@',
      0x08: 'ftp://ftp.',
      0x09: 'ftps://',
      0x0a: 'sftp://',
      0x0b: 'smb://',
      0x0c: 'nfs://',
      0x0d: 'ftp://',
      0x0e: 'dav://',
      0x0f: 'news:',
      0x10: 'telnet://',
      0x11: 'imap:',
      0x12: 'rtsp://',
      0x13: 'urn:',
      0x14: 'pop:',
      0x15: 'sip:',
      0x16: 'sips:',
      0x17: 'tftp:',
      0x18: 'btspp://',
      0x19: 'btl2cap://',
      0x1a: 'btgoep://',
      0x1b: 'tcpobex://',
      0x1c: 'irdaobex://',
      0x1d: 'file://',
      0x1e: 'urn:epc:id:',
      0x1f: 'urn:epc:tag:',
      0x20: 'urn:epc:pat:',
      0x21: 'urn:epc:raw:',
      0x22: 'urn:epc:',
      0x23: 'urn:nfc:',
    };

    return prefixes[statusByte] || '';
  }

  /**
   * Extract blend ID from URL
   * Expected URL format: https://trevean.com/blend/[blendId]
   */
  private _extractBlendIdFromUrl(url: string): string | undefined {
    try {
      const urlObj = new URL(url);
      const pathSegments = urlObj.pathname.split('/').filter((segment) => segment);

      const blendIndex = pathSegments.indexOf('blend');
      if (blendIndex !== -1 && blendIndex + 1 < pathSegments.length) {
        return pathSegments[blendIndex + 1];
      }

      return undefined;
    } catch (error) {
      console.error('Failed to parse URL:', error);
      return undefined;
    }
  }
}

export default new NFCService();
