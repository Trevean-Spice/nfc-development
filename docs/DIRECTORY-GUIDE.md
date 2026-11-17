# Trevean Spice NFC Prototype — Directory & File Guide

> **Audience:** New developers joining the repository
> **Last updated:** February 2026

This document explains every directory and file in the project so you can orient yourself quickly. The prototype implements NFC-enabled smart packaging for Trevean Spice blends — when a customer taps their phone on a spice jar, they see origin stories, freshness data, grower profiles, and recipes.

---

## Tech Stack at a Glance

| Layer | Technology |
|-------|-----------|
| API | Node.js + Express (REST) with TypeScript |
| Database | DynamoDB (with a local Docker option) |
| Cache | Redis |
| Web | Next.js (PWA, mobile-first) with Tailwind CSS |
| Mobile | React Native with `react-native-nfc-manager` |
| NFC | NTAG 216 chips (888 bytes, NDEF URL records) |
| Testing | Jest + Supertest |
| CI/CD | GitHub Actions |

---

## Root Files

| File | Purpose |
|------|---------|
| `README.md` | Project overview, MVP blend list, architecture summary, and getting-started instructions. **Read this first.** |
| `package.json` | Root-level dependencies and workspace scripts (build, test, lint, dev). |
| `tsconfig.json` | Base TypeScript config shared across `src/api`, `src/nfc`, and `src/shared`. Each sub-project may extend it. |
| `jest.config.ts` | Global Jest config — maps path aliases and sets TypeScript transform. |
| `.gitignore` | Standard ignores for `node_modules`, `.env`, build artifacts, and OS files. |
| `LICENSE` | MIT license. |
| `CODE_OF_CONDUCT.md` | Contributor Covenant code of conduct. |
| `CONTRIBUTING.md` | Contribution guidelines (branching, PR process, code style). |

---

## `src/shared/` — Shared Code

Code in this directory is imported by the API, web, mobile, and NFC packages. It has **zero external dependencies** so it stays portable.

```
src/shared/
├── constants/
│   └── index.ts      # App-wide constants
├── types/
│   ├── index.ts       # Core domain interfaces
│   └── api.ts         # API-layer types
└── utils/
    └── index.ts       # Pure utility functions
```

### `constants/index.ts`
Defines the five MVP blends with their IDs, names, origins, descriptions, key ingredients, and freshness windows. Also contains NFC hardware constants (`NTAG216_MEMORY_BYTES = 888`, `MAX_URL_LENGTH = 840`, `NDEF_HEADER_SIZE = 48`) and the base URL for tag scans.

### `types/index.ts`
Core domain interfaces used everywhere:

- **`SpiceBlend`** — id, name, origin, description, story markdown, key ingredients, freshness window, image URL, grower profile, recipes, timestamps.
- **`NFCTag`** — id, blend ID, encoded URL, chip type, manufacture date, active flag.
- **`ScanEvent`** — id, tag ID, blend ID, timestamp, device type, location.
- **`Recipe`** — id, blend ID, title, description, ingredients, steps, prep/cook time, servings, image URL.
- **`Grower`** — id, name, region, bio, image URL, blend IDs, joined date.
- **`FreshnessStatus`** enum — `FRESH`, `GOOD`, `AGING`, `EXPIRED`.
- **`DeviceType`** enum — `IOS`, `ANDROID`, `WEB`.

### `types/api.ts`
Types for the API layer: `APIContext`, `DataSources`, `RedisClient`, `CurrentUser`, `PaginationInput`, `PaginatedResponse<T>`, and `SortOrder` enum.

### `utils/index.ts`
Pure functions with no side effects:

- **`calculateFreshnessStatus(harvestDate, windowDays)`** — Returns a `FreshnessStatus` based on how far the current date is through the freshness window (≤25% → FRESH, ≤50% → GOOD, ≤100% → AGING, >100% → EXPIRED).
- **`formatNfcUrl(blendId, tagId)`** — Builds the scan URL: `https://trevean.com/scan/{blendId}?tag={tagId}`.
- **`encodeNdefUrl(url)`** — Returns a `Buffer` with the NDEF URI record (prefix byte `0x04` for `https://`).
- **`validateNfcPayloadSize(url)`** — Checks the encoded payload fits in 888 bytes.
- **`generateTagId()`** — Creates a `TRV-{8 hex chars}` tag identifier.

---

## `src/api/` — REST API Server

The backend is a standard Express REST API. No GraphQL.

```
src/api/
├── server.ts              # Express app setup, middleware, route mounting
├── routes/
│   ├── index.ts           # Aggregates all route files under /api/v1
│   ├── blend.routes.ts    # GET /blends, GET /blends/:id
│   ├── scan.routes.ts     # POST /scans, GET /scans
│   ├── recipe.routes.ts   # GET /recipes, GET /recipes/:id
│   └── tag.routes.ts      # POST /tags, GET /tags/:id, PUT /tags/:id
├── controllers/
│   ├── index.ts           # Re-exports all controllers
│   ├── blend.controller.ts
│   ├── scan.controller.ts
│   ├── recipe.controller.ts
│   └── tag.controller.ts
├── models/
│   ├── blend.model.ts     # DynamoDB operations for blends
│   ├── scan.model.ts      # DynamoDB operations for scan events
│   └── recipe.model.ts    # DynamoDB operations for recipes
└── middleware/
    ├── auth.ts            # JWT authentication middleware
    └── cache.ts           # Redis caching middleware
```

### How it fits together
`server.ts` creates the Express app, applies JSON body parsing, CORS, auth middleware, and mounts the route index at `/api/v1`. Each route file defines endpoints and delegates to a controller. Controllers call models for database access and return JSON responses.

### Key endpoints
- `GET  /api/v1/blends` — List blends (paginated)
- `GET  /api/v1/blends/:id` — Single blend with grower + recipes
- `POST /api/v1/scans` — Record an NFC scan event
- `GET  /api/v1/scans` — List scan events (filterable by blend/tag)
- `GET  /api/v1/recipes` — List recipes (filterable by blend)
- `GET  /api/v1/recipes/:id` — Single recipe
- `POST /api/v1/tags` — Register a new NFC tag
- `GET  /api/v1/tags/:id` — Look up a tag
- `PUT  /api/v1/tags/:id` — Update tag status

---

## `src/web/` — Next.js Progressive Web App

The consumer-facing web experience. When someone taps an NFC tag, the URL resolves here. Built as a mobile-first PWA with Tailwind CSS.

```
src/web/
├── package.json           # Next.js + Tailwind dependencies
├── tsconfig.json          # TypeScript config extending root
├── next.config.js         # Next.js settings (PWA, image domains)
├── tailwind.config.js     # Tailwind theme (Trevean brand colors)
├── postcss.config.js      # PostCSS with Tailwind plugin
├── .env.example           # Environment variable template
├── .gitignore             # Next.js-specific ignores (.next, out)
├── public/
│   └── manifest.json      # PWA manifest (app name, icons, theme color)
├── styles/
│   └── globals.css        # Tailwind directives + global styles
├── lib/
│   └── api-client.ts      # Fetch-based REST client for the API
├── components/
│   ├── Layout.tsx          # Page shell (header, footer, meta tags)
│   ├── BlendCard.tsx       # Blend preview card for list pages
│   ├── FreshnessIndicator.tsx  # Visual freshness status badge
│   └── RecipeCard.tsx      # Recipe preview card
└── pages/
    ├── _app.tsx            # Next.js app wrapper (global layout)
    ├── index.tsx           # Home page — blend listing
    ├── blend/
    │   └── [id].tsx        # Dynamic blend detail page
    └── api/
        └── health.ts       # Health-check API route
```

### `lib/api-client.ts`
A thin wrapper around `fetch()` that points at the REST API base URL. Provides typed methods like `getBlend(id)`, `getBlends()`, `recordScan()`, etc.

### `components/`
Reusable React components styled with Tailwind. `FreshnessIndicator` takes a `FreshnessStatus` and renders a color-coded badge (green/yellow/orange/red).

### `pages/`
Next.js file-based routing. `index.tsx` fetches and displays all blends. `blend/[id].tsx` uses `getServerSideProps` to fetch a single blend and renders the full detail view with grower info, ingredients, freshness, and recipes.

---

## `src/mobile/` — React Native Mobile App

A standalone React Native app that reads NFC tags and displays blend content natively.

```
src/mobile/
├── package.json           # React Native + NFC manager dependencies
├── App.tsx                # Root component — navigation setup
└── src/
    ├── screens/
    │   ├── HomeScreen.tsx         # Blend list with FAB to open scanner
    │   ├── ScannerScreen.tsx      # NFC tag scanning UI
    │   └── BlendDetailScreen.tsx  # Full blend detail view
    └── services/
        ├── APIService.ts          # Fetch-based REST client
        └── NFCService.ts          # NFC read/write via react-native-nfc-manager
```

### `App.tsx`
Sets up React Navigation with a bottom tab navigator (Blends tab + Scan NFC tab). The Blends tab contains a stack navigator for the blend list and detail screens.

### `services/APIService.ts`
Fetch-based client with methods: `fetchBlends()`, `fetchBlend(id)`, `recordScanEvent(data)`, `fetchRecipes(blendId)`, `fetchTag(tagId)`. Points at a configurable API base URL.

### `services/NFCService.ts`
Wraps `react-native-nfc-manager` to handle NFC hardware initialization, reading NDEF URL records from tags, and extracting blend/tag IDs from the encoded URL.

### `screens/`
- **HomeScreen** — Fetches blends from the API on focus, renders them as tappable cards. Has a floating action button that navigates to the scanner.
- **ScannerScreen** — Starts an NFC session, reads the tag, extracts the blend ID, and navigates to the detail screen.
- **BlendDetailScreen** — Fetches full blend data by ID, displays origin story, freshness window, key ingredients, grower profile, and featured recipes.

---

## `src/nfc/` — NFC Chip Programming Tools

Low-level utilities for encoding and writing data to NTAG 216 chips. Used in manufacturing/packaging, not at runtime.

```
src/nfc/
├── encoder.ts     # NDEF URL record encoding
├── programmer.ts  # Chip write operations
├── types.ts       # NFC-specific TypeScript types
└── validator.ts   # Payload size and format validation
```

### `encoder.ts`
Converts a blend URL into an NDEF binary payload. Handles the URI record type definition (RTD), prefix compression (`https://` → byte `0x04`), and payload length encoding.

### `programmer.ts`
Connects to an NFC writer device, authenticates with the chip, and writes the NDEF message. Includes retry logic and write-verification.

### `validator.ts`
Pre-write validation: checks that the encoded payload fits within the NTAG 216's 888-byte user memory, validates URL format, and verifies chip compatibility.

### `types.ts`
NFC-specific types: `NdefRecord`, `ChipType`, `WriteResult`, `ProgrammerConfig`.

---

## `config/` — Configuration Files

```
config/
├── .env.example   # Template for environment variables
├── default.ts     # Default configuration values
├── database.ts    # DynamoDB client setup
└── redis.ts       # Redis client setup
```

### `.env.example`
Copy to `.env` and fill in your values. Includes: `PORT`, `NODE_ENV`, `AWS_REGION`, `DYNAMODB_TABLE_PREFIX`, `DYNAMODB_ENDPOINT` (for local), `REDIS_URL`, `JWT_SECRET`, `BASE_URL`.

### `default.ts`
Reads from `process.env` with sensible defaults. Exports a typed config object used throughout the API.

### `database.ts`
Creates and exports a DynamoDB `DocumentClient`. In development, points at `localhost:8000` (DynamoDB Local via Docker).

### `redis.ts`
Creates and exports a Redis client with connection retry logic.

---

## `tests/` — Test Suite

All tests use Jest. The test files are organized by scope.

```
tests/
├── unit/
│   ├── blend.resolver.test.ts   # Blend controller unit tests
│   ├── scan.resolver.test.ts    # Scan controller unit tests
│   ├── encoder.test.ts          # NFC encoder unit tests
│   └── utils.test.ts            # Shared utility function tests
├── integration/
│   ├── api.test.ts              # REST endpoint integration tests (supertest)
│   └── database.test.ts         # DynamoDB model integration tests
└── e2e/
    ├── nfc-flow.test.ts         # Full NFC scan → API → response flow
    └── web-navigation.test.ts   # Web app page navigation tests
```

### Unit tests (`tests/unit/`)
Test individual functions and controllers in isolation with mocked dependencies. `utils.test.ts` covers freshness calculation, URL formatting, NDEF encoding, and tag ID generation.

### Integration tests (`tests/integration/`)
`api.test.ts` spins up the Express server and uses `supertest` to hit real endpoints (GET /api/v1/blends, POST /api/v1/scans, etc.) against a test database. `database.test.ts` tests DynamoDB model CRUD operations against DynamoDB Local.

### End-to-end tests (`tests/e2e/`)
`nfc-flow.test.ts` simulates the full journey: encode a tag → scan it → API records the event → response contains blend data. `web-navigation.test.ts` tests page rendering and navigation in the Next.js app.

> **Note:** The unit test files are named `blend.resolver.test.ts` and `scan.resolver.test.ts` for historical reasons — they actually test REST controllers, not GraphQL resolvers. Feel free to rename them.

---

## `scripts/` — Developer Scripts

```
scripts/
├── build.sh       # Build all packages
├── deploy.sh      # Deploy to AWS (API + web)
├── db-local.sh    # Start DynamoDB Local via Docker
└── seed.ts        # Seed the database with the 5 MVP blends
```

### `db-local.sh`
Starts a DynamoDB Local Docker container on port 8000 and creates the required tables. Run this before local development.

### `seed.ts`
Populates the local database with the five MVP blends (Persian Sunrise, North African Night Market, Caribbean Sunset, The Silk Road, Kyoto Garden), sample grower profiles, and starter recipes.

### `build.sh`
Compiles TypeScript for the API and NFC packages, and runs `next build` for the web app.

### `deploy.sh`
Deploys the API to AWS (Lambda or ECS depending on config) and the web app to Vercel/S3+CloudFront.

---

## `docs/` — Documentation

```
docs/
├── ARCHITECTURE.md      # System architecture and data flow diagrams
├── GUIDE.md             # Developer getting-started guide
├── NFC-SPECS.md         # NTAG 216 technical specifications
└── DIRECTORY-GUIDE.md   # This file
```

### `ARCHITECTURE.md`
High-level system diagram showing how the NFC tag, mobile app, REST API, DynamoDB, Redis, and web PWA connect. Includes the data flow for a tag scan.

### `GUIDE.md`
Step-by-step setup instructions: prerequisites, cloning, installing dependencies, running DynamoDB Local, seeding data, starting the dev server, and running tests.

### `NFC-SPECS.md`
Technical reference for the NTAG 216 chip: memory layout, NDEF format, URL encoding scheme, and payload size limits.

---

## `.github/` — GitHub Configuration

```
.github/
├── workflows/
│   ├── ci.yml              # CI pipeline (lint, test, build)
│   └── deploy.yml          # Deployment pipeline (staging + production)
└── ISSUE_TEMPLATE/
    ├── bug_report.md       # Bug report template
    └── feature_request.md  # Feature request template
```

### `ci.yml`
Runs on every push and PR: installs dependencies, runs linting, runs the full test suite (unit + integration + e2e), and builds all packages. Uses a DynamoDB Local service container for integration tests.

### `deploy.yml`
Triggered on merge to `main`. Deploys to staging first, runs smoke tests, then promotes to production.

### Issue templates
Standardized forms for bug reports (steps to reproduce, expected vs. actual behavior) and feature requests (problem statement, proposed solution).

---

## MVP Blend Reference

These are the five blends defined in `src/shared/constants/index.ts` and seeded by `scripts/seed.ts`:

| Blend | Origin | Key Ingredients | Freshness Window |
|-------|--------|-----------------|-----------------|
| Persian Sunrise | Isfahan, Iran | Saffron, cardamom, rose petals, lime | 180 days |
| North African Night Market | Marrakech, Morocco | Aleppo pepper, cumin, preserved lemon | 150 days |
| Caribbean Sunset | Kingston, Jamaica | Scotch bonnet, allspice, thyme | 120 days |
| The Silk Road | Central Asia (multi-origin) | Cumin, coriander, fenugreek, turmeric | 200 days |
| Kyoto Garden | Kyoto, Japan | Sesame, nori, yuzu, green tea | 90 days |

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start local DynamoDB
./scripts/db-local.sh

# 3. Seed test data
npx ts-node scripts/seed.ts

# 4. Start API server
npm run dev:api

# 5. Start web app (separate terminal)
cd src/web && npm run dev

# 6. Run tests
npm test
```

See `docs/GUIDE.md` for detailed setup instructions.
