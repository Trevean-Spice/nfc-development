/**
 * Default configuration object for Trevean NFC project
 * Loads environment variables with fallbacks
 */

interface Config {
  nodeEnv: string;
  port: number;
  apiUrl: string;
  aws: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
  dynamodb: {
    tablePrefix: string;
    endpoint?: string;
  };
  redis: {
    url: string;
  };
  shopify: {
    apiKey: string;
    apiSecret: string;
  };
  mixpanel: {
    token: string;
  };
  nfc: {
    baseUrl: string;
    chipType: string;
  };
  jwt: {
    secret: string;
  };
  features: {
    enableQrFallback: boolean;
    enableBatchProgramming: boolean;
    enableAnalytics: boolean;
  };
}

/**
 * Load configuration from environment variables
 */
const config: Config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  apiUrl: process.env.API_URL || 'http://localhost:4000',

  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },

  dynamodb: {
    tablePrefix: process.env.DYNAMODB_TABLE_PREFIX || 'trevean-dev-',
    endpoint:
      process.env.NODE_ENV === 'development'
        ? process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000'
        : undefined,
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  shopify: {
    apiKey: process.env.SHOPIFY_API_KEY || '',
    apiSecret: process.env.SHOPIFY_API_SECRET || '',
  },

  mixpanel: {
    token: process.env.MIXPANEL_TOKEN || '',
  },

  nfc: {
    baseUrl: process.env.NFC_BASE_URL || 'https://trevean.com/blend',
    chipType: process.env.NFC_CHIP_TYPE || 'NTAG216',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'development-secret-key-change-in-production',
  },

  features: {
    enableQrFallback: process.env.ENABLE_QR_FALLBACK === 'true',
    enableBatchProgramming: process.env.ENABLE_BATCH_PROGRAMMING === 'true',
    enableAnalytics: process.env.ENABLE_ANALYTICS === 'true',
  },
};

/**
 * Validate required configuration
 */
function validateConfig(): void {
  const requiredFields: (keyof Config)[] = ['nodeEnv', 'port'];

  if (config.nodeEnv === 'production') {
    // Production requires AWS and JWT secret
    if (!config.aws.accessKeyId || !config.aws.secretAccessKey) {
      throw new Error(
        'AWS credentials are required in production (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)'
      );
    }

    if (
      config.jwt.secret === 'development-secret-key-change-in-production'
    ) {
      throw new Error('JWT_SECRET must be changed for production');
    }
  }
}

try {
  validateConfig();
} catch (error) {
  console.error('Configuration validation failed:', error);
  process.exit(1);
}

export default config;
