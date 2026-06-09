import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import NfcManager, { Ndef } from 'react-native-nfc-manager';

import NFCService from '../services/NFCService';

interface ScannerScreenProps {
  navigation: any;
}

interface NFCReadResult {
  uid: string;
  url?: string;
  blendId?: string;
  success: boolean;
  error?: string;
}

/**
 * ScannerScreen handles NFC tag reading and navigation to blend detail
 */
const ScannerScreen: React.FC<ScannerScreenProps> = ({ navigation }) => {
  const [isScanning, setIsScanning] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [lastScannedId, setLastScannedId] = useState<string | null>(null);

  useEffect(() => {
    initializeNFC();

    return () => {
      cleanupNFC();
    };
  }, []);

  /**
   * Initialize NFC manager and service
   */
  const initializeNFC = async () => {
    try {
      await NFCService.initialize();
      setIsInitialized(true);
      console.log('NFC service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize NFC:', error);
      Alert.alert('NFC Error', 'Failed to initialize NFC. Please check permissions.');
      setIsInitialized(false);
    }
  };

  /**
   * Cleanup NFC resources
   */
  const cleanupNFC = async () => {
    try {
      await NFCService.cleanup();
    } catch (error) {
      console.error('Error during NFC cleanup:', error);
    }
  };

  /**
   * Handle NFC tag reading
   */
  const handleScanTag = async () => {
    if (!isInitialized) {
      Alert.alert('NFC Not Ready', 'NFC service is not initialized.');
      return;
    }

    setIsScanning(true);
    try {
      const result: NFCReadResult = await NFCService.readTag();

      if (result.success && result.blendId) {
        setLastScannedId(result.blendId);
        console.log('Successfully read blend ID:', result.blendId);

        setTimeout(() => {
          navigation.navigate('Home');
          navigation.navigate('BlendDetail', { blendId: result.blendId });
        }, 500);
      } else if (result.error) {
        Alert.alert('Scan Failed', result.error);
      }
    } catch (error) {
      console.error('Error reading NFC tag:', error);
      Alert.alert('NFC Read Error', 'Failed to read NFC tag. Please try again.');
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Text style={styles.icon}>📱</Text>
        </View>

        <Text style={styles.title}>Scan NFC Tag</Text>
        <Text style={styles.subtitle}>
          Hold your device near an NFC-enabled Trevean Spice package
        </Text>

        <View style={styles.infoBox}>
          <Text style={styles.infoText}>
            Place the back of your phone near the NFC tag on the spice package to read blend
            information and unlock exclusive recipes.
          </Text>
        </View>

        {lastScannedId && (
          <View style={styles.successBox}>
            <Text style={styles.successText}>Last scanned: {lastScannedId}</Text>
          </View>
        )}
      </View>

      <TouchableOpacity
        style={[styles.scanButton, isScanning && styles.scanButtonDisabled]}
        onPress={handleScanTag}
        disabled={isScanning || !isInitialized}
        activeOpacity={0.7}
      >
        {isScanning ? (
          <ActivityIndicator size="small" color="#fff" style={styles.spinner} />
        ) : null}
        <Text style={styles.scanButtonText}>
          {isScanning ? 'Scanning...' : 'Start Scan'}
        </Text>
      </TouchableOpacity>

      <Text style={styles.footerText}>
        {isInitialized ? 'NFC Ready' : 'NFC Not Available'}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    justifyContent: 'space-between',
    padding: 20,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: 32,
  },
  icon: {
    fontSize: 80,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
  infoBox: {
    backgroundColor: '#f5f5f5',
    borderLeftColor: '#8B4513',
    borderLeftWidth: 4,
    padding: 16,
    borderRadius: 4,
    marginBottom: 20,
  },
  infoText: {
    fontSize: 14,
    color: '#555',
    lineHeight: 20,
  },
  successBox: {
    backgroundColor: '#e8f5e9',
    borderColor: '#4caf50',
    borderWidth: 1,
    padding: 12,
    borderRadius: 4,
    marginBottom: 20,
  },
  successText: {
    fontSize: 13,
    color: '#2e7d32',
    fontWeight: '500',
  },
  scanButton: {
    backgroundColor: '#8B4513',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 20,
    flexDirection: 'row',
    justifyContent: 'center',
    elevation: 3,
  },
  scanButtonDisabled: {
    backgroundColor: '#bbb',
    opacity: 0.6,
  },
  scanButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  spinner: {
    marginRight: 12,
  },
  footerText: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
  },
});

export default ScannerScreen;
