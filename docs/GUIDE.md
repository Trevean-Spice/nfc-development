# Trevean NFC Smart Packaging - Development Guide

Complete guide for developing, deploying, and managing the Trevean Spice NFC smart packaging system.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Environment Setup](#environment-setup)
3. [API Reference](#api-reference)
4. [Web App Development](#web-app-development)
5. [Mobile SDK Setup](#mobile-sdk-setup)
6. [NFC Chip Programming](#nfc-chip-programming)
7. [Database Schema](#database-schema)
8. [Deployment Guide](#deployment-guide)
9. [Troubleshooting](#troubleshooting)

## Architecture Overview

Trevean NFC uses a modern, scalable architecture:

- **Frontend**: React Native mobile app + React web dashboard
- **Backend**: REST API on AWS Lambda
- **Database**: DynamoDB for storage, Redis for caching
- **NFC**: NTAG216 chips with NDEF URL encoding
- **Infrastructure**: AWS (Lambda, S3, CloudFront, DynamoDB)

## Environment Setup

### Prerequisites

- Node.js 18+
- npm 9+
- Docker (for local DynamoDB)
- AWS CLI (for deployment)
- Git

### Initial Setup

```bash
# Clone repository
git clone <repo-url>
cd nfc-prototype

# Install dependencies
npm install

# Copy environment template
cp config/.env.example config/.env.development
cp config/.env.example config/.env.staging
cp config/.env.example config/.env.production

# Edit .env files with your values
```

### Local Development

```bash
# Start DynamoDB Local
bash scripts/db-local.sh

# In another terminal, seed database
npm run seed

# Start development server
npm run dev
```

## API Reference

### GraphQL Queries

#### GetBlends
```graphql
query GetBlends {
  blends {
    id
    name
    origin
    description
    imageUrl
    spiceCount
  }
}
```

#### GetBlend
```graphql
query GetBlend($id: ID!) {
  blend(id: $id) {
    id
    name
    origin
    description
    originStory
    freshness
    ingredients
    imageUrl
    grower {
      id
      name
      region
      certifications
    }
    recipes {
      id
      name
      servings
      cookTime
    }
  }
}
```

#### GetRecipes
```graphql
query GetRecipes($blendId: ID!) {
  recipes(blendId: $blendId) {
    id
    name
    description
    servings
    cookTime
    difficulty
    instructions
    ingredients {
      name
      amount
      unit
    }
  }
}
```

### GraphQL Mutations

#### RecordScanEvent
```graphql
mutation RecordScan($blendId: ID!, $tagUid: String!) {
  recordScanEvent(blendId: $blendId, tagUid: $tagUid) {
    id
    timestamp
    success
  }
}
```

#### SaveFavorite
```graphql
mutation SaveFavorite($blendId: ID!) {
  saveFavorite(blendId: $blendId) {
    id
    isFavorite
  }
}
```

## Web App Development

### Project Structure
```
src/web/
├── pages/          # Next.js pages
├── components/     # React components
├── services/       # API clients
├── hooks/          # Custom React hooks
├── styles/         # CSS/SCSS
└── public/         # Static assets
```

### Running Locally
```bash
cd src/web
npm install
npm run dev
# Accessible at http://localhost:3000
```

### Building for Production
```bash
npm run build
npm start
```

## Mobile SDK Setup

### Project Structure
```
src/mobile/
├── src/
│   ├── screens/    # Screen components
│   ├── services/   # NFC and API services
│   ├── hooks/      # Custom hooks
│   └── components/ # Reusable components
├── android/        # Native Android code
├── ios/            # Native iOS code
└── App.tsx         # Root component
```

### iOS Setup
```bash
cd src/mobile
npm install

# Install pods
cd ios
pod install
cd ..

# Run on iOS simulator
npm run ios
```

### Android Setup
```bash
cd src/mobile
npm install

# Build and run on Android
npm run android
```

### NFC Permissions

#### iOS (ios/TreveanNFC/Info.plist)
```xml
<key>NFCReaderUsageDescription</key>
<string>We use NFC to read blend information from spice packages</string>
```

#### Android (android/app/src/main/AndroidManifest.xml)
```xml
<uses-permission android:name="android.permission.NFC" />
```

## NFC Chip Programming

### Using the Programmer CLI

```bash
# Program a single chip
npx ts-node src/nfc/programmer.ts program \
  --blend-id blend-001 \
  --chip-type NTAG216 \
  --base-url https://trevean.com/blend

# Validate chip configuration
npx ts-node src/nfc/programmer.ts validate \
  --blend-id blend-001 \
  --chip-type NTAG216

# Estimate memory usage
npx ts-node src/nfc/programmer.ts estimate \
  --blend-id blend-001 \
  --base-url https://trevean.com/blend
```

### NTAG Specifications

- **NTAG216**: 888 bytes total, 729 bytes user memory
- **NTAG213**: 180 bytes total, 64 bytes user memory
- **NDEF Format**: Standard NFC Forum Type 2
- **Max URL Length**: 300 characters

## Database Schema

### SpiceBlends Table
```
blendId (PK): String
name: String
origin: String
description: String
originStory: String
freshness: Number (0-100)
ingredients: StringSet
growerId: String (FK)
createdAt: String (ISO 8601)
updatedAt: String (ISO 8601)
```

### ScanEvents Table
```
chipUid (PK): String
timestamp (SK): String (ISO 8601)
blendId: String
userId: String (optional)
metadata: Map
```

### Recipes Table
```
blendId (PK): String
recipeId (SK): String
name: String
description: String
servings: Number
cookTime: Number
difficulty: String (easy|medium|hard)
instructions: List
ingredients: List<Map>
```

### Growers Table
```
growerId (PK): String
name: String
region: String
country: String
certifications: StringSet
description: String
contactEmail: String
```

### NFCTags Table
```
chipUid (PK): String
blendId: String
programmingDate: String
programmingStatus: String (success|pending|failed)
memoryUsage: Number
```

## Deployment Guide

### Prerequisites
- AWS account with appropriate permissions
- AWS CLI configured
- Docker credentials (if using ECR)

### Staging Deployment
```bash
bash scripts/deploy.sh staging
```

### Production Deployment
```bash
bash scripts/deploy.sh production
# Will require confirmation
```

### Environment Configuration

Edit `config/.env.production`:
```
NODE_ENV=production
AWS_REGION=us-east-1
DYNAMODB_TABLE_PREFIX=trevean-prod-
# Add other production values
```

### Manual Lambda Deployment
```bash
# Build and package
npm run build
cd dist/api
zip -r ../api-lambda.zip .
cd ../..

# Deploy
aws lambda update-function-code \
  --function-name trevean-nfc-api-production \
  --zip-file fileb://dist/api-lambda.zip
```

### CloudFront Cache Invalidation
```bash
aws cloudfront create-invalidation \
  --distribution-id YOUR_DISTRIBUTION_ID \
  --paths "/*"
```

## Troubleshooting

### NFC Tag Not Detected
1. Ensure NFC is enabled on device
2. Check permissions are granted
3. Verify chip has power
4. Try tag with different phone

### DynamoDB Connection Issues
```bash
# Check DynamoDB Local is running
docker ps | grep dynamodb

# Restart DynamoDB Local
bash scripts/db-local.sh
```

### Deployment Failures
```bash
# Check Lambda logs
aws logs tail /aws/lambda/trevean-nfc-api-production --follow

# Verify environment variables
aws lambda get-function-configuration --function-name trevean-nfc-api-production
```

### Mobile App Issues

**iOS Build Errors**
```bash
cd ios
pod repo update
pod install
cd ..
npm run ios
```

**Android Build Errors**
```bash
cd android
./gradlew clean
./gradlew build
cd ..
npm run android
```

### Redis Connection Problems
```bash
# Check Redis is running
redis-cli ping

# Check connection string
echo $REDIS_URL
```

## Support

For issues and questions:
- GitHub Issues: [repo]/issues
- Documentation: /docs
- Email: dev@trevean.com
