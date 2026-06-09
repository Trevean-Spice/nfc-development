import { GetStaticProps, GetStaticPaths } from 'next';
import Head from 'next/head';
import Image from 'next/image';
import Layout from '@/components/Layout';
import FreshnessIndicator from '@/components/FreshnessIndicator';
import RecipeCard from '@/components/RecipeCard';

interface Recipe {
  id: string;
  title: string;
  prepTime: number;
  servings: number;
  description: string;
  ingredients: string[];
}

interface Grower {
  id: string;
  name: string;
  location: string;
  bio: string;
  imageUrl: string;
}

interface Blend {
  id: string;
  name: string;
  origin: string;
  description: string;
  originStory: string;
  keyIngredients: string[];
  harvestDate: string;
  freshnessWindowDays: number;
  imageUrl: string;
  gpsLat: number;
  gpsLng: number;
  grower: Grower;
  recipes: Recipe[];
}

interface BlendDetailProps {
  blend: Blend;
}

export default function BlendDetail({ blend }: BlendDetailProps) {
  if (!blend) {
    return (
      <Layout>
        <div className="text-center py-12">
          <p className="text-amber-700 text-lg">Blend not found</p>
        </div>
      </Layout>
    );
  }

  return (
    <>
      <Head>
        <title>{blend.name} - Trevean Spice</title>
        <meta name="description" content={`${blend.name} from ${blend.origin}. ${blend.description}`} />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta property="og:title" content={blend.name} />
        <meta property="og:description" content={blend.description} />
      </Head>

      <Layout>
        {/* Hero Section */}
        <section className="relative h-80 bg-gradient-to-b from-amber-100 to-amber-50 overflow-hidden">
          <div className="absolute inset-0 bg-amber-900 opacity-5"></div>
          <div className="relative h-full flex items-center justify-center">
            <div className="text-center">
              <h1 className="text-5xl md:text-6xl font-bold text-amber-900 mb-2">
                {blend.name}
              </h1>
              <p className="text-2xl text-amber-700">{blend.origin}</p>
            </div>
          </div>
        </section>

        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {/* Main Content Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
            {/* Left Column */}
            <div className="lg:col-span-2">
              {/* Blend Image */}
              <div className="relative w-full aspect-square rounded-lg overflow-hidden mb-8 bg-amber-100">
                <Image
                  src={blend.imageUrl}
                  alt={blend.name}
                  fill
                  className="object-cover"
                />
              </div>

              {/* Description */}
              <div className="prose prose-amber max-w-none mb-8">
                <h2 className="text-3xl font-bold text-amber-900 mb-4">Origin Story</h2>
                <p className="text-lg text-amber-800 leading-relaxed whitespace-pre-wrap">
                  {blend.originStory}
                </p>
              </div>

              {/* Key Ingredients */}
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-amber-900 mb-4">Key Ingredients</h2>
                <div className="flex flex-wrap gap-2">
                  {blend.keyIngredients.map((ingredient, idx) => (
                    <span
                      key={idx}
                      className="bg-amber-100 text-amber-900 px-4 py-2 rounded-full font-medium"
                    >
                      {ingredient}
                    </span>
                  ))}
                </div>
              </div>

              {/* Map Placeholder */}
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-amber-900 mb-4">Growing Region</h2>
                <div className="w-full h-64 bg-gradient-to-br from-green-50 to-blue-50 rounded-lg border-2 border-amber-200 flex items-center justify-center">
                  <div className="text-center">
                    <p className="text-2xl mb-2">📍</p>
                    <p className="text-amber-700 font-semibold">
                      {blend.gpsLat.toFixed(4)}°N, {blend.gpsLng.toFixed(4)}°E
                    </p>
                    <p className="text-amber-600 text-sm mt-2">{blend.origin}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column - Sidebar */}
            <div className="lg:col-span-1">
              {/* Freshness Indicator */}
              <div className="bg-amber-50 rounded-lg p-6 mb-8 sticky top-4">
                <h3 className="text-xl font-bold text-amber-900 mb-4">Freshness</h3>
                <FreshnessIndicator
                  harvestDate={blend.harvestDate}
                  freshnessWindowDays={blend.freshnessWindowDays}
                />
                <p className="text-sm text-amber-600 mt-4">
                  Harvested: {new Date(blend.harvestDate).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </p>
              </div>

              {/* Grower Profile */}
              <div className="bg-white border-2 border-amber-200 rounded-lg p-6">
                <h3 className="text-xl font-bold text-amber-900 mb-4">Meet the Grower</h3>
                <div className="relative w-full aspect-square rounded-lg overflow-hidden mb-4 bg-amber-100">
                  <Image
                    src={blend.grower.imageUrl}
                    alt={blend.grower.name}
                    fill
                    className="object-cover"
                  />
                </div>
                <h4 className="text-lg font-semibold text-amber-900 mb-1">
                  {blend.grower.name}
                </h4>
                <p className="text-sm text-amber-700 mb-3">{blend.grower.location}</p>
                <p className="text-sm text-amber-800 leading-relaxed">
                  {blend.grower.bio}
                </p>
              </div>
            </div>
          </div>

          {/* Recipes Section */}
          <div className="mb-12">
            <h2 className="text-3xl font-bold text-amber-900 mb-6">Featured Recipes</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {blend.recipes.map((recipe) => (
                <RecipeCard key={recipe.id} recipe={recipe} />
              ))}
            </div>
          </div>
        </div>
      </Layout>
    </>
  );
}

export const getStaticPaths: GetStaticPaths = async () => {
  // Generate paths for MVP blend IDs
  const blendIds = [
    'persian-sunrise',
    'north-african-night-market',
    'caribbean-sunset',
    'the-silk-road',
    'kyoto-garden',
  ];

  return {
    paths: blendIds.map((id) => ({
      params: { id },
    })),
    fallback: 'blocking', // Use ISR for new blends
  };
};

export const getStaticProps: GetStaticProps<BlendDetailProps> = async ({
  params,
}) => {
  try {
    const id = params?.id as string;

    // Mock blend data with correct MVP blends
    const blendData: Record<string, Blend> = {
      'persian-sunrise': {
        id: 'persian-sunrise',
        name: 'Persian Sunrise',
        origin: 'Isfahan, Iran',
        description: 'Golden spice blend with floral notes',
        originStory: `In the heart of Isfahan, where the Zayandeh River flows through centuries of Persian tradition, a master of spice cultivation brings together the finest ingredients for Persian Sunrise.

Saffron from the Khorasan region represents the soul of this blend—each delicate crimson thread hand-harvested at peak potency. The cardamom pods come from the lush gardens of northern Iran, where the cool mountain air nurtures their aromatic properties. Rose petals are carefully dried to preserve their fragrant essence, while the lime provides a bright, citrusy counterpoint to the warm spices.

This blend captures the essence of Persian hospitality and the golden light of sunrise over the ancient city, bringing warmth and elegance to every meal.`,
        keyIngredients: ['Saffron', 'Cardamom', 'Rose Petals', 'Lime'],
        harvestDate: '2025-12-15',
        freshnessWindowDays: 200,
        imageUrl: 'https://images.unsplash.com/photo-1596040174668-a4f3442a8415?w=600&h=600&fit=crop',
        gpsLat: 32.6546,
        gpsLng: 51.6680,
        grower: {
          id: 'g1',
          name: 'Kaveh Shirazi',
          location: 'Isfahan, Iran',
          bio: 'Fifth-generation master spice cultivator specializing in premium saffron and traditional Persian spice blending with 35 years of expertise.',
          imageUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop',
        },
        recipes: [
          {
            id: 'r1',
            title: 'Persian Saffron Rice',
            prepTime: 40,
            servings: 4,
            description: 'Fragrant basmati rice infused with saffron and rose water',
            ingredients: ['Basmati rice', 'Saffron', 'Rose water', 'Butter', 'Saffron threads', 'Almonds'],
          },
          {
            id: 'r2',
            title: 'Jeweled Chicken with Persian Sunrise',
            prepTime: 50,
            servings: 4,
            description: 'Tender chicken with dried fruits and Persian spices',
            ingredients: ['Chicken breast', 'Dried apricots', 'Pomegranate seeds', 'Persian Sunrise', 'Onions', 'Chicken broth'],
          },
        ],
      },
      'north-african-night-market': {
        id: 'north-african-night-market',
        name: 'North African Night Market',
        origin: 'Fez, Morocco',
        description: 'Warm and vibrant blend with citrus notes',
        originStory: `Walking through the narrow medinas of Fez at dusk, the air fills with the aroma of spice stalls preparing for the evening market. North African Night Market captures this essence perfectly.

The Aleppo pepper brings heat and fruity depth from the ancient Syrian highlands, cumin from the sun-scorched soils of Morocco adds earthiness, and preserved lemon provides a bright, tangy counterpoint. Each ingredient is sourced directly from family spice merchants who have maintained their stalls in the Fez marketplace for generations.

This blend transports you to the bustling souks at twilight, where vendors call out their wares and the magic of North African cuisine comes alive.`,
        keyIngredients: ['Aleppo Pepper', 'Cumin', 'Preserved Lemon'],
        harvestDate: '2025-11-20',
        freshnessWindowDays: 180,
        imageUrl: 'https://images.unsplash.com/photo-1596689341823-fad85f432e5e?w=600&h=600&fit=crop',
        gpsLat: 34.0731,
        gpsLng: -4.9898,
        grower: {
          id: 'g2',
          name: 'Amina Bennani',
          location: 'Fez, Morocco',
          bio: 'Third-generation spice merchant and blender with deep connections to the Fez medina markets and expertise in North African flavor combinations.',
          imageUrl: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=400&h=400&fit=crop',
        },
        recipes: [
          {
            id: 'r3',
            title: 'Spiced Harissa',
            prepTime: 20,
            servings: 4,
            description: 'Fiery Moroccan chili paste with North African spices',
            ingredients: ['Aleppo pepper', 'Red chili', 'Garlic', 'Caraway', 'Preserved lemon', 'Olive oil'],
          },
          {
            id: 'r4',
            title: 'Zaalouk - Moroccan Eggplant Salad',
            prepTime: 30,
            servings: 4,
            description: 'Smoky eggplant salad with North African Night Market blend',
            ingredients: ['Eggplant', 'Tomatoes', 'Garlic', 'North African Night Market', 'Olive oil', 'Cilantro'],
          },
        ],
      },
      'caribbean-sunset': {
        id: 'caribbean-sunset',
        name: 'Caribbean Sunset',
        origin: 'Trinidad & Tobago',
        description: 'Bold and fiery island blend',
        originStory: `From the volcanic islands of Trinidad and Tobago comes Caribbean Sunset—a blend as vibrant and bold as the sunsets that paint the sky over the Caribbean Sea.

Scotch bonnet peppers, among the hottest in the world, grow abundantly in the tropical climate of these islands, bringing intense heat and fruity complexity. Allspice, native to the Caribbean, adds warmth and subtle sweetness, while fresh thyme from island gardens provides herbal brightness. This blend represents the fearless, vibrant spirit of Caribbean cuisine.

Each ingredient is sourced from family farms that have cultivated these plants for generations, bringing the authentic heat and flavor of the islands to your kitchen.`,
        keyIngredients: ['Scotch Bonnet', 'Allspice', 'Thyme'],
        harvestDate: '2026-01-10',
        freshnessWindowDays: 170,
        imageUrl: 'https://images.unsplash.com/photo-1596040174668-a4f3442a8415?w=600&h=600&fit=crop',
        gpsLat: 10.6918,
        gpsLng: -61.2225,
        grower: {
          id: 'g3',
          name: 'Marcus Williams',
          location: 'Port of Spain, Trinidad & Tobago',
          bio: 'Caribbean spice specialist with 28 years of experience growing and blending authentic Trinidadian pepper and spice varieties on island farms.',
          imageUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&h=400&fit=crop',
        },
        recipes: [
          {
            id: 'r5',
            title: 'Caribbean Jerk Marinade',
            prepTime: 15,
            servings: 4,
            description: 'Bold marinade for chicken, pork, or fish',
            ingredients: ['Caribbean Sunset', 'Lime juice', 'Ginger', 'Garlic', 'Soy sauce', 'Olive oil'],
          },
          {
            id: 'r6',
            title: 'Trinidad Doubles',
            prepTime: 45,
            servings: 4,
            description: 'Street food favorite with spiced chickpea curry',
            ingredients: ['Chickpeas', 'Caribbean Sunset', 'Turmeric', 'Onion', 'Garlic', 'Flour'],
          },
        ],
      },
      'the-silk-road': {
        id: 'the-silk-road',
        name: 'The Silk Road',
        origin: 'Central Asia (multi-origin)',
        description: 'Ancient trade route spice blend',
        originStory: `The Silk Road was not a single path but a vast network of trade routes connecting East and West, carrying not just goods but knowledge, culture, and flavor across continents. The Silk Road blend honors this history.

Cumin from the deserts of Kazakhstan brings earthy depth, coriander from the steppes of Kyrgyzstan adds brightness and subtle sweetness, fenugreek from the mountains of Tajikistan provides maple-like warmth, and turmeric from the southern routes adds golden color and warming properties. Each ingredient represents a different leg of the ancient trade route.

This blend connects you to centuries of commerce, cultural exchange, and culinary tradition that shaped the flavors of the world.`,
        keyIngredients: ['Cumin', 'Coriander', 'Fenugreek', 'Turmeric'],
        harvestDate: '2025-10-05',
        freshnessWindowDays: 190,
        imageUrl: 'https://images.unsplash.com/photo-1596689341823-fad85f432e5e?w=600&h=600&fit=crop',
        gpsLat: 43.2557,
        gpsLng: 76.9449,
        grower: {
          id: 'g4',
          name: 'Amir Toleev',
          location: 'Almaty, Kazakhstan',
          bio: 'Master blender with 32 years of expertise sourcing spices from across the Central Asian republics following ancient Silk Road trade routes.',
          imageUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&h=400&fit=crop',
        },
        recipes: [
          {
            id: 'r7',
            title: 'Plov - Central Asian Rice Pilaf',
            prepTime: 50,
            servings: 4,
            description: 'Aromatic rice dish with meat and vegetables',
            ingredients: ['Rice', 'Lamb', 'Carrots', 'Onions', 'The Silk Road', 'Vegetable oil', 'Garlic'],
          },
          {
            id: 'r8',
            title: 'Spiced Chickpea Stew',
            prepTime: 35,
            servings: 4,
            description: 'Warming stew with The Silk Road blend',
            ingredients: ['Chickpeas', 'The Silk Road', 'Tomatoes', 'Onions', 'Vegetable broth', 'Spinach'],
          },
        ],
      },
      'kyoto-garden': {
        id: 'kyoto-garden',
        name: 'Kyoto Garden',
        origin: 'Kyoto, Japan',
        description: 'Umami-rich Japanese blend',
        originStory: `In the tranquil gardens of Kyoto, where ancient temples overlook cultivated landscapes, the art of flavor reaches its highest expression. Kyoto Garden blend embodies the Japanese principle of balance and harmony.

Sesame seeds are carefully toasted to bring out nutty depth, nori (seaweed) adds oceanic umami, yuzu brings bright citrus notes reminiscent of winter gardens, and green tea provides delicate grassy tones. Each ingredient is sourced from traditional cultivators who maintain centuries-old farming practices.

This blend represents the intersection of land and sea, tradition and refinement—the very essence of Japanese culinary philosophy captured in a jar.`,
        keyIngredients: ['Sesame', 'Nori', 'Yuzu', 'Green Tea'],
        harvestDate: '2025-12-01',
        freshnessWindowDays: 160,
        imageUrl: 'https://images.unsplash.com/photo-1596040174668-a4f3442a8415?w=600&h=600&fit=crop',
        gpsLat: 35.0116,
        gpsLng: 135.7681,
        grower: {
          id: 'g5',
          name: 'Yuki Yamamoto',
          location: 'Kyoto, Japan',
          bio: 'Artisanal spice blender with 25 years dedicated to preserving traditional Japanese flavor combinations and working with heritage crop growers in Kyoto.',
          imageUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=400&fit=crop',
        },
        recipes: [
          {
            id: 'r9',
            title: 'Furikake - Japanese Rice Seasoning',
            prepTime: 10,
            servings: 4,
            description: 'Simple yet flavorful rice seasoning with Kyoto Garden blend',
            ingredients: ['Kyoto Garden', 'Sesame seeds', 'Nori strips', 'Bonito flakes', 'Salt'],
          },
          {
            id: 'r10',
            title: 'Miso-Yuzu Glazed Salmon',
            prepTime: 25,
            servings: 2,
            description: 'Delicate salmon with miso and Kyoto Garden spices',
            ingredients: ['Salmon fillet', 'Miso', 'Yuzu juice', 'Kyoto Garden', 'Maple syrup', 'Soy sauce'],
          },
        ],
      },
    };

    const blend = blendData[id];

    if (!blend) {
      return {
        notFound: true,
      };
    }

    return {
      props: {
        blend,
      },
      revalidate: 3600, // ISR: revalidate every hour
    };
  } catch (error) {
    console.error('Error fetching blend details:', error);
    return {
      notFound: true,
    };
  }
};
