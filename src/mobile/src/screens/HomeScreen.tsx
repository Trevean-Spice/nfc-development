import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  FlatList,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import APIService from '../services/APIService';

interface Blend {
  id: string;
  name: string;
  origin: string;
  description: string;
  imageUrl?: string;
  keyIngredients: string[];
}

interface HomeScreenProps {
  navigation: any;
}

/**
 * HomeScreen displays a list of spice blends with a floating action button for NFC scanning
 */
const HomeScreen: React.FC<HomeScreenProps> = ({ navigation }) => {
  const [blends, setBlends] = useState<Blend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBlends = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await APIService.fetchBlends();
      setBlends((data as any).items || []);
    } catch (err) {
      setError('Failed to load blends');
      console.error('Failed to fetch blends:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBlends();
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchBlends();
    }, [])
  );

  const handleBlendPress = (blendId: string) => {
    navigation.navigate('BlendDetail', { blendId });
  };

  const handleScanPress = () => {
    navigation.navigate('Scanner');
  };

  const BlendCard: React.FC<{ blend: Blend }> = ({ blend }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => handleBlendPress(blend.id)}
      activeOpacity={0.7}
    >
      {blend.imageUrl && (
        <Image
          source={{ uri: blend.imageUrl }}
          style={styles.cardImage}
          resizeMode="cover"
        />
      )}
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle}>{blend.name}</Text>
        <Text style={styles.cardOrigin}>{blend.origin}</Text>
        <Text style={styles.cardDescription} numberOfLines={2}>
          {blend.description}
        </Text>
        <Text style={styles.ingredientCount}>
          {blend.keyIngredients.length} key ingredients
        </Text>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#8B4513" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={fetchBlends}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={blends}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <BlendCard blend={item} />}
        contentContainerStyle={styles.listContent}
        numColumns={1}
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={handleScanPress}
        activeOpacity={0.8}
      >
        <Text style={styles.fabText}>Scan NFC</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fafafa',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    padding: 12,
    paddingBottom: 80,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 12,
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  cardImage: {
    width: '100%',
    height: 150,
    backgroundColor: '#e0e0e0',
  },
  cardContent: {
    padding: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  cardOrigin: {
    fontSize: 14,
    color: '#8B4513',
    fontWeight: '600',
    marginBottom: 8,
  },
  cardDescription: {
    fontSize: 13,
    color: '#666',
    lineHeight: 18,
    marginBottom: 8,
  },
  ingredientCount: {
    fontSize: 12,
    color: '#999',
  },
  fab: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#8B4513',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  fabText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 16,
    color: '#d32f2f',
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#8B4513',
    borderRadius: 6,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
});

export default HomeScreen;
