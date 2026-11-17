import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { dynamoDBClient, initializeTables, tables } from '../config/database';

/**
 * Database seeder for MVP spice blends with full data
 * Seeds SpiceBlends, Recipes, Growers, and NFCTags tables
 */

interface Blend {
  blendId: string;
  name: string;
  origin: string;
  description: string;
  originStory: string;
  freshness: number;
  ingredients: string[];
  growerId: string;
  createdAt: string;
}

interface Recipe {
  blendId: string;
  recipeId: string;
  name: string;
  description: string;
  servings: number;
  cookTime: number;
  difficulty: 'easy' | 'medium' | 'hard';
  instructions: string[];
  ingredients: Array<{ name: string; amount: number; unit: string }>;
}

interface Grower {
  growerId: string;
  name: string;
  region: string;
  country: string;
  certifications: string[];
  description: string;
}

/**
 * MVP blend data
 */
const mvpBlends: Blend[] = [
  {
    blendId: 'blend-001',
    name: 'Golden Sunrise',
    origin: 'Indian Subcontinent',
    description: 'Warm and aromatic morning blend with turmeric and cardamom',
    originStory:
      'Inspired by the spice markets of Kerala, this blend captures the essence of traditional Indian mornings with its vibrant golden hue.',
    freshness: 92,
    ingredients: ['Turmeric', 'Cardamom', 'Cinnamon', 'Clove', 'Ginger'],
    growerId: 'grower-001',
    createdAt: new Date().toISOString(),
  },
  {
    blendId: 'blend-002',
    name: 'Midnight Dream',
    origin: 'Eastern Mediterranean',
    description: 'Deep and mysterious blend perfect for evening cuisine',
    originStory:
      'Drawn from centuries-old trading routes, this blend combines the richness of Mediterranean and Middle Eastern spice traditions.',
    freshness: 88,
    ingredients: ['Black Pepper', 'Cumin', 'Coriander', 'Fenugreek', 'Nutmeg'],
    growerId: 'grower-002',
    createdAt: new Date().toISOString(),
  },
  {
    blendId: 'blend-003',
    name: 'Forest Fire',
    origin: 'Southeast Asian Highlands',
    description: 'Bold and spicy blend with smoky undertones',
    originStory:
      'Sourced from highland growers in Vietnam and Indonesia, this blend celebrates the complex spice profiles of Southeast Asian cuisine.',
    freshness: 95,
    ingredients: ['Chili', 'Star Anise', 'Clove', 'Cinnamon', 'Black Pepper'],
    growerId: 'grower-003',
    createdAt: new Date().toISOString(),
  },
  {
    blendId: 'blend-004',
    name: 'Citrus Harmony',
    origin: 'Central America',
    description: 'Fresh and zesty blend with citrus notes',
    originStory:
      'Infused with dried citrus peel and aromatic spices from Guatemala and Mexico, bringing brightness to any dish.',
    freshness: 90,
    ingredients: ['Coriander', 'Cumin', 'Dried Lime', 'Cilantro', 'Jalapeño'],
    growerId: 'grower-004',
    createdAt: new Date().toISOString(),
  },
  {
    blendId: 'blend-005',
    name: 'Emerald Garden',
    origin: 'North African Atlas',
    description: 'Herbaceous blend with green and floral notes',
    originStory:
      'Celebrating the lush spice gardens of Morocco and Algeria, this blend brings fresh, green aromatics to traditional and modern cooking.',
    freshness: 87,
    ingredients: ['Coriander Seed', 'Cumin', 'Fennel', 'Caraway', 'Mint'],
    growerId: 'grower-005',
    createdAt: new Date().toISOString(),
  },
];

/**
 * Grower data
 */
const growers: Grower[] = [
  {
    growerId: 'grower-001',
    name: 'Kerala Spice Gardens',
    region: 'Kerala',
    country: 'India',
    certifications: ['Fair Trade', 'Organic'],
    description: 'Family-owned spice plantation with 50+ years of expertise',
  },
  {
    growerId: 'grower-002',
    name: 'Mediterranean Heritage',
    region: 'Crete',
    country: 'Greece',
    certifications: ['Organic', 'EU Protected Designation of Origin'],
    description: 'Sustainable farming practices passed down through generations',
  },
  {
    growerId: 'grower-003',
    name: 'Mekong Valley Spices',
    region: 'Northern Vietnam',
    country: 'Vietnam',
    certifications: ['Fair Trade', 'Rainforest Alliance'],
    description: 'Community-supported agriculture with focus on biodiversity',
  },
  {
    growerId: 'grower-004',
    name: 'Highland Harvest Collective',
    region: 'Huehuetenango',
    country: 'Guatemala',
    certifications: ['Fair Trade', 'Organic', 'Kosher'],
    description: 'Cooperative of small farmers dedicated to sustainable practices',
  },
  {
    growerId: 'grower-005',
    name: 'Atlas Mountain Spices',
    region: 'Atlas Mountains',
    country: 'Morocco',
    certifications: ['Organic', 'Fair Trade'],
    description: 'Traditional spice cultivation in partnership with local communities',
  },
];

/**
 * Recipe data
 */
const recipes: Recipe[] = [
  {
    blendId: 'blend-001',
    recipeId: 'recipe-001',
    name: 'Golden Turmeric Latte',
    description: 'Warm wellness drink with anti-inflammatory benefits',
    servings: 1,
    cookTime: 10,
    difficulty: 'easy',
    instructions: [
      'Heat milk in saucepan',
      'Add spice blend and honey',
      'Whisk until frothy',
      'Pour into cup and serve',
    ],
    ingredients: [
      { name: 'Milk', amount: 1, unit: 'cup' },
      { name: 'Honey', amount: 1, unit: 'tbsp' },
      { name: 'Golden Sunrise Blend', amount: 0.5, unit: 'tsp' },
    ],
  },
  {
    blendId: 'blend-002',
    recipeId: 'recipe-002',
    name: 'Midnight Dream Rice Pilaf',
    description: 'Fragrant rice dish perfect as a side',
    servings: 4,
    cookTime: 30,
    difficulty: 'medium',
    instructions: [
      'Toast blend in butter',
      'Add rice and stir',
      'Add broth and bring to boil',
      'Reduce heat and simmer covered',
      'Fluff with fork',
    ],
    ingredients: [
      { name: 'Basmati Rice', amount: 2, unit: 'cups' },
      { name: 'Vegetable Broth', amount: 4, unit: 'cups' },
      { name: 'Butter', amount: 2, unit: 'tbsp' },
      { name: 'Midnight Dream Blend', amount: 1.5, unit: 'tsp' },
    ],
  },
  {
    blendId: 'blend-003',
    recipeId: 'recipe-003',
    name: 'Forest Fire Grilled Vegetables',
    description: 'Charred vegetables with bold spice coating',
    servings: 4,
    cookTime: 20,
    difficulty: 'easy',
    instructions: [
      'Mix blend with oil',
      'Coat vegetables',
      'Grill until charred',
      'Serve immediately',
    ],
    ingredients: [
      { name: 'Assorted Vegetables', amount: 2, unit: 'lbs' },
      { name: 'Olive Oil', amount: 3, unit: 'tbsp' },
      { name: 'Forest Fire Blend', amount: 2, unit: 'tsp' },
    ],
  },
];

/**
 * Seed the database with MVP data
 */
async function seedDatabase(): Promise<void> {
  try {
    console.log('Starting database seeding...\n');

    // Initialize tables
    console.log('Initializing DynamoDB tables...');
    await initializeTables(dynamoDBClient);
    console.log('Tables initialized\n');

    // Create document client
    const docClient = DynamoDBDocumentClient.from(dynamoDBClient);

    // Seed growers
    console.log('Seeding growers...');
    for (const grower of growers) {
      await docClient.send(
        new PutCommand({
          TableName: tables.growers.name,
          Item: grower,
        })
      );
      console.log(`  - ${grower.name}`);
    }
    console.log('');

    // Seed blends
    console.log('Seeding spice blends...');
    for (const blend of mvpBlends) {
      await docClient.send(
        new PutCommand({
          TableName: tables.spiceBlends.name,
          Item: blend,
        })
      );
      console.log(`  - ${blend.name}`);
    }
    console.log('');

    // Seed recipes
    console.log('Seeding recipes...');
    for (const recipe of recipes) {
      await docClient.send(
        new PutCommand({
          TableName: tables.recipes.name,
          Item: recipe,
        })
      );
      console.log(`  - ${recipe.name}`);
    }
    console.log('');

    console.log('Database seeding completed successfully!');
  } catch (error) {
    console.error('Failed to seed database:', error);
    process.exit(1);
  }
}

// Run seeder
seedDatabase();
