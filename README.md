# Trevean Spice — NFC Smart Packaging Prototype

**The Spice Intelligence Platform**

An NFC-enabled smart packaging system that connects consumers with the authentic stories behind premium spices. Tap a spice jar lid with your phone to instantly discover origin stories, grower profiles, harvest details, freshness tracking, and curated recipes.

---

## Overview

Trevean Spice is building a premium spice subscription service differentiated through NFC-enabled smart packaging. This repository houses the prototype codebase for the full platform — from chip-level integration through cloud APIs to consumer-facing web and mobile experiences.

This project is a collaboration between **Trevean Spice** (product vision, content, and brand) and **Microgroove** (NFC technology, platform development, and technical architecture).

### Key Features

| Feature | Description | Priority |
|---------|-------------|----------|
| **NFC Tap-to-Discover** | Tap phone on jar lid to view origin story, grower info, GPS coordinates, harvest date | P0 — Must Have |
| **Dynamic Content** | Cloud-hosted content updated without reprogramming chips (recipes, tips, seasonal) | P0 — Must Have |
| **QR Code Fallback** | Printed QR on label for devices without NFC; identical content experience | P0 — Must Have |
| **Freshness Timeline** | Visual spice-age indicator with alerts near optimal use window | P1 — Should Have |
| **Recipe Library** | 5–10 curated recipes per spice blend, accessible via tap | P1 — Should Have |
| **Scan Analytics** | Backend dashboard for scan rates, engagement, and geographic distribution | P1 — Should Have |
| **Mobile App SDK** | React Native module for native NFC reads with inventory sync | P2 — Nice to Have |

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| NFC Hardware | NTAG 216 (888 bytes) | Adhesive mount on bamboo lid underside |
| Cloud Backend | Node.js / TypeScript | GraphQL API, DynamoDB, Redis cache |
| Web Experience | Next.js (PWA) | Brand-matched, mobile-first landing pages |
| Mobile SDK | React Native | iOS CoreNFC + Android NFC API bridges |
| E-Commerce | Shopify Plus | Subscription management and order tracking |
| Analytics | Mixpanel / Custom | Real-time scan tracking and engagement |
| Infrastructure | AWS / GCP with CDN | Multi-region, 99.9% uptime SLA target |

## Repository Structure

```
nfc-prototype/
├── src/
│   ├── api/            # GraphQL API server (Node.js / TypeScript)
│   ├── web/            # PWA landing pages (Next.js)
│   ├── mobile/         # React Native NFC SDK and app modules
│   ├── nfc/            # NFC chip programming tools and utilities
│   └── shared/         # Shared types, constants, and utilities
├── docs/               # Project documentation and guides
├── tests/
│   ├── unit/           # Unit tests
│   ├── integration/    # Integration tests
│   └── e2e/            # End-to-end tests
├── scripts/            # Build, deploy, and utility scripts
├── config/             # Environment and service configuration
└── .github/            # GitHub Actions workflows and issue templates
```

## Getting Started

### Prerequisites

- **Node.js** >= 18.x — [download](https://nodejs.org/)
- **npm** >= 9.x or **yarn** >= 1.22.x
- **AWS CLI** >= 2.x — [install guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) (required for DynamoDB access)
- **DynamoDB Local** >= 3.0.0 — optional for offline dev; run via Docker (`docker run -p 8000:8000 amazon/dynamodb-local`) or [download the JAR](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.DownloadingAndRunning.html) (requires JRE 11+)
- **Redis** >= 7.x — local install or managed instance
- **React Native CLI** — for mobile development only
- **Xcode** >= 15 — iOS builds, macOS only
- **Android Studio** >= Flamingo — Android builds

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/Trevean-Spice/nfc-prototype.git
cd nfc-prototype

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp config/.env.example config/.env
# Edit config/.env with your local settings (see docs/GUIDE.md)

# 4. Configure AWS credentials (for DynamoDB)
aws configure
# Enter your AWS Access Key ID, Secret Access Key, and region (us-east-1)
# Or set AWS_PROFILE in config/.env to use a named profile

# 5. (Optional) Start DynamoDB Local for offline development
npm run db:local

# 6. Seed the database with initial spice blend data
npm run db:seed

# 7. Start the API server
npm run dev:api

# 8. In a separate terminal, start the web app
npm run dev:web

# 9. Run the test suite
npm test
```

### Mobile Development

See the full [Mobile SDK Guide](docs/GUIDE.md#mobile-sdk-setup) for detailed instructions.

```bash
# iOS
cd src/mobile && npx pod-install && npx react-native run-ios

# Android
cd src/mobile && npx react-native run-android
```

## MVP Spice Blends

The prototype supports five signature blends, each with a unique origin story and content experience:

| Blend | Origin | Key Ingredients |
|-------|--------|----------------|
| Persian Sunrise | Isfahan, Iran | Saffron, cardamom, rose petals, lime |
| North African Night Market | Fez, Morocco | Aleppo pepper, cumin, preserved lemon |
| Caribbean Sunset | Trinidad & Tobago | Scotch bonnet, allspice, thyme |
| The Silk Road | Central Asia (multi-origin) | Cumin, coriander, fenugreek, turmeric |
| Kyoto Garden | Kyoto, Japan | Sesame, nori, yuzu, green tea |

## Development Phases

| Phase | Timeline | Focus |
|-------|----------|-------|
| 1. Discovery & Prototyping | Weeks 1–4 | Physical feasibility, chip selection, architecture design, content schema |
| 2. Core Development | Weeks 5–12 | Cloud infrastructure, API, web templates, admin CMS |
| 3. Integration & Testing | Weeks 13–16 | Mobile SDK, device matrix testing, security audit |
| 4. Pilot Production | Weeks 17–20 | 500-unit batch, beta testing, iteration, handoff |

## Contributing

We welcome contributions from all team members. Please read our [Contributing Guidelines](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before getting started.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

## Contact

- **Project Sponsor:** Dan Blizinski — [dblizinski@pm.me](mailto:dblizinski@pm.me)
- **Organization:** [Trevean Spice](https://github.com/Trevean-Spice)
- **Technical Partner:** [Microgroove](https://microgroove.com)
