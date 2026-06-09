import React, { useState, useEffect } from 'react';
import {
  View,
  ScrollView,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  Alert,
} from 'react-native';
import APIService from '../services/APIService';

interface Recipe {
  id: string;
  title: string;
  servings: number;
  prepTimeMinutes: number;
  description: string;
}

interface Grower {
  id: string;
  name: string;
  region: string;
  bio: string;
}

interface Blend {
  id: string;
  name: string;
  origin: string;
  description: string;
  storyMarkdown: string;
  freshnessWindowDays: number;
  keyIngredients: string[];
  imageUrl?: string;
  growerProfile: Grower;
  recipes: Recipe[];
}

interface BlendDetailScreenProps {
  navigation: any;
  route: {
    params: {
      blendId: string;
    };
  };
}

/**
 * BlendDetailScreen displays detailed information about a spice blend
 */
const BlendDetailScreen: React.FC<BlendDetailScreenProps> = ({ route }) => {
  const { blendId } = route.params;
  const [blend, setBlend] = useState<Blend | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchBlend = async () => {
      try {
        setLoading(true);
        const data = await APIService.fetchBlend(blendId);
        setBlend(data as Blend);
      } catch (err) {
        setError('Failed to load blend details');
        console.error('Failed to fetch blend:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchBlend();
  }, [blendId]);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#8B4513" />
      </View>
    );
  }

  if (error || !blend) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>{error || 'Blend not found'}</Text>
      </View>
    );
  }

  const handleRecipePress = (recipe: Recipe) => {
    Alert.alert(recipe.title, `${recipe.description}\n\nServings: ${recipe.servings}\nPrep time: ${recipe.prepTimeMinutes} min`);
  };

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {blend.imageUrl && (
        <Image source={{ uri: blend.imageUrl }} style={styles.heroImage} />
      )}

      <View style={styles.content}>
        <Text style={styles.title}>{blend.name}</Text>
        <Text style={styles.origin}>{blend.origin}</Text>

        <View style={styles.freshnessContainer}>
          <Text style={styles.freshnessLabel}>Freshness Window</Text>
          <Text style={styles.freshnessValue}>{blend.freshnessWindowDays} days</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Origin Story</Text>
          <Text style={styles.sectionText}>{blend.storyMarkdown}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Key Ingredients</Text>
          <View style={styles.ingredientsList}>
            {blend.keyIngredients.map((ingredient, index) => (
              <View key={index} style={styles.ingredientItem}>
                <Text style={styles.ingredientBullet}>•</Text>
                <Text style={styles.ingredientText}>{ingredient}</Text>
              </View>
            ))}
          </View>
        </View>

        {blend.growerProfile && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Meet the Grower</Text>
            <View style={styles.growerCard}>
              <Text style={styles.growerName}>{blend.growerProfile.name}</Text>
              <Text style={styles.growerRegion}>{blend.growerProfile.region}</Text>
              <Text style={styles.growerBio}>{blend.growerProfile.bio}</Text>
            </View>
          </View>
        )}

        {blend.recipes && blend.recipes.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Featured Recipes</Text>
            {blend.recipes.map((recipe) => (
              <TouchableOpacity
                key={recipe.id}
                style={styles.recipeCard}
                onPress={() => handleRecipePress(recipe)}
                activeOpacity={0.7}
              >
                <Text style={styles.recipeName}>{recipe.title}</Text>
                <Text style={styles.recipeInfo}>
                  {recipe.servings} servings · {recipe.prepTimeMinutes} min
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.bottomSpacer} />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroImage: {
    width: '100%',
    height: 250,
    backgroundColor: '#e0e0e0',
  },
  content: {
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  origin: {
    fontSize: 16,
    color: '#8B4513',
    fontWeight: '600',
    marginBottom: 20,
  },
  freshnessContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f5f0eb',
    padding: 12,
    borderRadius: 8,
    marginBottom: 24,
  },
  freshnessLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  freshnessValue: {
    fontSize: 14,
    color: '#8B4513',
    fontWeight: '600',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 12,
  },
  sectionText: {
    fontSize: 14,
    color: '#555',
    lineHeight: 20,
  },
  ingredientsList: {
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 12,
  },
  ingredientItem: {
    flexDirection: 'row',
    paddingVertical: 6,
  },
  ingredientBullet: {
    fontSize: 16,
    color: '#8B4513',
    marginRight: 10,
    fontWeight: 'bold',
  },
  ingredientText: {
    fontSize: 14,
    color: '#555',
    flex: 1,
  },
  growerCard: {
    backgroundColor: '#fafafa',
    borderRadius: 8,
    padding: 16,
    borderLeftColor: '#8B4513',
    borderLeftWidth: 4,
  },
  growerName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  growerRegion: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  growerBio: {
    fontSize: 13,
    color: '#555',
    lineHeight: 18,
  },
  recipeCard: {
    backgroundColor: '#fff',
    borderColor: '#e0e0e0',
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
  },
  recipeName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  recipeInfo: {
    fontSize: 13,
    color: '#999',
  },
  errorText: {
    fontSize: 16,
    color: '#d32f2f',
  },
  bottomSpacer: {
    height: 40,
  },
});

export default BlendDetailScreen;
