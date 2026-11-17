import { GetStaticProps } from 'next';
import Head from 'next/head';
import Link from 'next/link';
import BlendCard from '@/components/BlendCard';
import Layout from '@/components/Layout';

interface Blend {
  id: string;
  name: string;
  origin: string;
  keyIngredients: string[];
  harvestDate: string;
  description: string;
  imageUrl: string;
}

interface IndexProps {
  blends: Blend[];
}

export default function Home({ blends }: IndexProps) {
  return (
    <>
      <Head>
        <title>Trevean Spice - Premium Artisan Spice Blends</title>
        <meta name="description" content="Discover Trevean Spice - traceable, fresh, and sustainably sourced spice blends from around the world." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#8B6F47" />
      </Head>

      <Layout>
        {/* Hero Section */}
        <section className="relative bg-gradient-to-b from-amber-50 to-white py-20 px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center">
            <h1 className="text-5xl md:text-6xl font-bold text-amber-900 mb-6">
              Trevean Spice
            </h1>
            <p className="text-xl text-amber-800 mb-4">
              Discover the Story Behind Every Blend
            </p>
            <p className="text-lg text-amber-700 mb-8 max-w-2xl mx-auto">
              Tap your spice jar with an NFC tag to explore the origin story, meet the growers, 
              and discover fresh recipes from sustainably sourced, traceable spices.
            </p>
            <div className="flex gap-4 justify-center flex-wrap">
              <a href="#blends" className="inline-block bg-amber-700 text-white px-8 py-3 rounded-lg hover:bg-amber-800 transition">
                Explore Blends
              </a>
              <a href="#" className="inline-block border-2 border-amber-700 text-amber-700 px-8 py-3 rounded-lg hover:bg-amber-50 transition">
                Learn More
              </a>
            </div>
          </div>
        </section>

        {/* Blends Grid */}
        <section id="blends" className="py-16 px-4 sm:px-6 lg:px-8 bg-white">
          <div className="max-w-6xl mx-auto">
            <h2 className="text-4xl font-bold text-amber-900 mb-4 text-center">
              MVP Blend Collection
            </h2>
            <p className="text-center text-amber-700 mb-12">
              Start with our signature blends. Tap to explore more.
            </p>

            {blends && blends.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                {blends.map((blend) => (
                  <Link key={blend.id} href={`/blend/${blend.id}`}>
                    <a>
                      <BlendCard blend={blend} />
                    </a>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-amber-700 text-lg">Loading blends...</p>
              </div>
            )}
          </div>
        </section>

        {/* Features Section */}
        <section className="py-16 px-4 sm:px-6 lg:px-8 bg-amber-50">
          <div className="max-w-6xl mx-auto">
            <h2 className="text-3xl font-bold text-amber-900 mb-12 text-center">
              Why Trevean Spice?
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="bg-white p-8 rounded-lg shadow-sm">
                <div className="text-3xl mb-4">🌍</div>
                <h3 className="text-xl font-semibold text-amber-900 mb-2">Traceable Origins</h3>
                <p className="text-amber-700">Know exactly where your spices come from with GPS coordinates and grower profiles.</p>
              </div>
              <div className="bg-white p-8 rounded-lg shadow-sm">
                <div className="text-3xl mb-4">✨</div>
                <h3 className="text-xl font-semibold text-amber-900 mb-2">Guaranteed Freshness</h3>
                <p className="text-amber-700">Real-time freshness indicators tell you exactly how fresh your spices are.</p>
              </div>
              <div className="bg-white p-8 rounded-lg shadow-sm">
                <div className="text-3xl mb-4">♻️</div>
                <h3 className="text-xl font-semibold text-amber-900 mb-2">Sustainable</h3>
                <p className="text-amber-700">Supporting small farms and sustainable practices around the world.</p>
              </div>
            </div>
          </div>
        </section>
      </Layout>
    </>
  );
}

export const getStaticProps: GetStaticProps<IndexProps> = async () => {
  try {
    // Mock data for MVP with correct 5 blends
    const mockBlends: Blend[] = [
      {
        id: 'persian-sunrise',
        name: 'Persian Sunrise',
        origin: 'Isfahan, Iran',
        keyIngredients: ['Saffron', 'Cardamom', 'Rose Petals', 'Lime'],
        harvestDate: '2025-12-15',
        description: 'Golden spice blend with floral notes',
        imageUrl: 'https://images.unsplash.com/photo-1596040174668-a4f3442a8415?w=400&h=400&fit=crop',
      },
      {
        id: 'north-african-night-market',
        name: 'North African Night Market',
        origin: 'Fez, Morocco',
        keyIngredients: ['Aleppo Pepper', 'Cumin', 'Preserved Lemon'],
        harvestDate: '2025-11-20',
        description: 'Warm and vibrant blend with citrus notes',
        imageUrl: 'https://images.unsplash.com/photo-1596689341823-fad85f432e5e?w=400&h=400&fit=crop',
      },
      {
        id: 'caribbean-sunset',
        name: 'Caribbean Sunset',
        origin: 'Trinidad & Tobago',
        keyIngredients: ['Scotch Bonnet', 'Allspice', 'Thyme'],
        harvestDate: '2026-01-10',
        description: 'Bold and fiery island blend',
        imageUrl: 'https://images.unsplash.com/photo-1596040174668-a4f3442a8415?w=400&h=400&fit=crop',
      },
      {
        id: 'the-silk-road',
        name: 'The Silk Road',
        origin: 'Central Asia (multi-origin)',
        keyIngredients: ['Cumin', 'Coriander', 'Fenugreek', 'Turmeric'],
        harvestDate: '2025-10-05',
        description: 'Ancient trade route spice blend',
        imageUrl: 'https://images.unsplash.com/photo-1596689341823-fad85f432e5e?w=400&h=400&fit=crop',
      },
      {
        id: 'kyoto-garden',
        name: 'Kyoto Garden',
        origin: 'Kyoto, Japan',
        keyIngredients: ['Sesame', 'Nori', 'Yuzu', 'Green Tea'],
        harvestDate: '2025-12-01',
        description: 'Umami-rich Japanese blend',
        imageUrl: 'https://images.unsplash.com/photo-1596040174668-a4f3442a8415?w=400&h=400&fit=crop',
      },
    ];

    return {
      props: {
        blends: mockBlends,
      },
      revalidate: 3600, // ISR: revalidate every hour
    };
  } catch (error) {
    console.error('Error fetching blends:', error);
    return {
      props: {
        blends: [],
      },
      revalidate: 60,
    };
  }
};
