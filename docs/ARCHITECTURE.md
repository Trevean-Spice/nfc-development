# Trevean NFC System Architecture

High-level system design and data flow documentation for the Trevean Spice smart packaging NFC solution.

## System Overview

The Trevean NFC system connects physical spice packaging to digital experiences through NFC technology:

```
User scans NFC tag on package
         |
         v
Mobile app detects NDEF URL record
         |
         v
Extracts blend ID from URL
         |
         v
Queries GraphQL API
         |
         v
Retrieves blend details from DynamoDB
         |
         v
Displays rich content (story, recipes, grower info)
         |
         v
Records scan event for analytics
```

## Component Architecture

### Frontend Layer

#### Mobile App (React Native)
- **Responsibility**: NFC tag reading, user interface, offline support
- **Key Components**:
  - `NFCService`: Handles iOS CoreNFC and Android NFC API abstraction
  - `APIService`: GraphQL client wrapper with caching
  - Navigation: Bottom tab navigator + stack navigators
  - Screens: Home (blend list), Scanner (NFC), BlendDetail (full content)
- **Data Flow**: User interactions → NFC reading → URL extraction → API queries

#### Web Dashboard (React/Next.js)
- **Responsibility**: Admin panel, blend management, analytics
- **Key Features**:
  - Blend CRUD operations
  - Scan analytics and reporting
  - Grower management
  - Recipe publishing
- **Data Flow**: Admin actions → GraphQL mutations → DynamoDB updates

### API Layer

#### GraphQL API (Apollo Server on Lambda)
- **Responsibility**: Data querying, mutation handling, business logic
- **Key Features**:
  - Blend and recipe queries
  - Scan event recording
  - Favorite management
  - User profiles
- **Architecture**: Serverless Lambda functions behind API Gateway

### Data Layer

#### DynamoDB
Provides scalable, NoSQL storage with the following tables:

**SpiceBlends**
- Partition Key: `blendId`
- Contains: name, origin, story, ingredients, grower reference
- GSI: createdAt for listing recent blends

**ScanEvents**
- Partition Key: `chipUid`
- Sort Key: `timestamp`
- Tracks: blend ID, user, metadata
- Purpose: Analytics and engagement tracking

**Recipes**
- Partition Key: `blendId`
- Sort Key: `recipeId`
- Contains: full recipe data with ingredients
- Purpose: Serve recipes linked to blends

**Growers**
- Partition Key: `growerId`
- Contains: farmer details, certifications, locations
- Purpose: Transparency and brand storytelling

**NFCTags**
- Partition Key: `chipUid`
- Tracks: programming status, blend reference
- Purpose: Chip inventory and programming history

#### Redis
- **Purpose**: Caching and session management
- **Data**: Frequently accessed blends, user sessions
- **TTL Strategy**: Blends cached for 24 hours, sessions for 7 days

### NFC Programming Layer

#### Chip Programmer
- **Input**: Blend ID, chip type (NTAG216/NTAG213)
- **Process**:
  1. Generate target URL: `https://trevean.com/blend/{blendId}`
  2. Create NDEF URL record
  3. Validate payload fits in chip memory
  4. Generate programming report
- **Output**: Ready-to-program chip configuration
- **Storage**: NDEF message (120-150 bytes per chip)

#### Chip Validator
- **Validates**: Memory constraints, URL format, payload size
- **Checks**:
  - URL length < 300 characters
  - Payload fits in NTAG216 (888 bytes) or NTAG213 (180 bytes)
  - Protocol is http/https
- **Reports**: Detailed validation results with memory breakdown

## Data Flow Patterns

### Scan and Display Flow
```
1. User holds phone to package
   ├─ iOS: Triggers NFC reader UI
   └─ Android: Automatic detection if NFC enabled

2. App reads NDEF message
   ├─ Decodes status byte to find URI prefix
   ├─ Extracts full URL
   └─ Parses blend ID from path

3. App queries API
   ├─ Apollo client sends GraphQL query
   ├─ Checks Redis cache first
   └─ Falls back to DynamoDB on miss

4. API returns data
   ├─ Blend details, grower info, recipes
   └─ Records scan event asynchronously

5. App displays content
   ├─ Shows blend story and origin
   ├─ Lists recipes
   └─ Displays grower certifications
```

### Programming Flow
```
1. Programmer tool receives blend ID
   ├─ Validates blend exists
   └─ Confirms chip type

2. Generates NDEF record
   ├─ Creates URL record
   ├─ Encodes to binary
   └─ Calculates payload size

3. Validates against chip specs
   ├─ Checks memory capacity
   ├─ Confirms URL format
   └─ Generates report

4. Output ready for NFC writer
   ├─ Binary NDEF data
   ├─ Memory layout info
   └─ Verification data
```

### Analytics Flow
```
1. App records scan event
   ├─ Captures chipUid, blendId, timestamp
   ├─ Includes device/location metadata (optional)
   └─ Sends async mutation

2. API receives event
   ├─ Validates data
   ├─ Writes to ScanEvents table
   └─ Updates blend engagement metrics

3. Dashboard queries analytics
   ├─ Aggregates scan count by blend
   ├─ Tracks unique users
   └─ Shows temporal trends
```

## Caching Strategy

### Redis Cache Hierarchy
```
Level 1: In-App Cache
└─ AsyncStorage (mobile)
└─ LocalStorage (web)
└─ TTL: Session duration

Level 2: Redis Server Cache
└─ Hot data (popular blends)
└─ User sessions
└─ TTL: 24 hours for blends, 7 days for sessions

Level 3: DynamoDB
└─ Authoritative data source
└─ Searched on cache misses
└─ Write-through cache updates
```

### Cache Invalidation
- **Manual**: Admin invalidates blend cache after edits
- **Automatic**: TTL expiration for time-based data
- **Cascade**: Invalidate related caches (blend → recipes)

## Security Model

### Authentication
- JWT tokens issued on login
- Stored securely in AsyncStorage (mobile) or localStorage (web)
- Included in Authorization header for API requests
- Validate on each request with secret key

### Authorization
- Public: Blend browsing, recipe viewing
- Authenticated: Favorites, user preferences
- Admin: Blend management, analytics

### Data Protection
- HTTPS/TLS for all API communications
- AWS KMS encryption for sensitive data at rest
- No PII in NFC tags (only blend ID and URL)
- Scan event user IDs encrypted when stored

### NFC-Specific Security
- URLs are publicly guessable (no tokens in URL)
- QR code fallback for offline scenarios
- Chip UID not sensitive (widely available on physical tag)
- Rate limiting on API endpoints prevents abuse

## Scalability Considerations

### Horizontal Scaling
- **Lambda**: Auto-scales on demand, pay per invocation
- **DynamoDB**: On-demand billing, scales automatically
- **Redis**: Cluster mode for sharding across nodes
- **CloudFront**: Automatic global distribution

### Performance Optimization
- Lazy load images in blend list
- Cache API responses client-side
- Compress NDEF payloads for chip storage
- Use connection pooling for database queries

### Monitoring & Observability
- CloudWatch logs for Lambda errors
- DynamoDB capacity monitoring
- Redis command latency metrics
- Application Performance Monitoring (APM) for mobile

## Disaster Recovery

### Backup Strategy
- Daily DynamoDB snapshots to S3
- Redis persistence enabled
- Source code in Git with multiple remotes
- Configuration backed up to AWS Secrets Manager

### Recovery Procedures
- RTO (Recovery Time Objective): < 1 hour
- RPO (Recovery Point Objective): < 24 hours
- Test restore procedures quarterly
- Documented runbooks for each component

## Infrastructure as Code

Deployment uses CloudFormation/Terraform:
- Lambda function definitions
- API Gateway configuration
- DynamoDB table creation
- S3 buckets and policies
- CloudFront distributions
- VPC and networking setup

All infrastructure is version controlled and reproducible.
