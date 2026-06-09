#!/bin/bash
# Build script for TypeScript compilation and production build

set -e

echo "Building Trevean NFC project..."
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check Node.js version
echo -e "${BLUE}Checking environment...${NC}"
node_version=$(node -v)
echo "  Node.js: $node_version"
echo ""

# Clean previous builds
echo -e "${BLUE}Cleaning previous builds...${NC}"
rm -rf dist/
echo "  Cleaned dist/"
echo ""

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "${BLUE}Installing dependencies...${NC}"
    npm install
    echo ""
fi

# Compile TypeScript
echo -e "${BLUE}Compiling TypeScript...${NC}"
npx tsc --project tsconfig.json
echo "  Compiled TypeScript"
echo ""

# Build NFC CLI tools
echo -e "${BLUE}Building NFC CLI tools...${NC}"
npx tsc src/nfc/*.ts --outDir dist/nfc --target ES2020 --module commonjs --declaration
echo "  Built NFC tools"
echo ""

# Build configuration modules
echo -e "${BLUE}Building configuration modules...${NC}"
npx tsc config/*.ts --outDir dist/config --target ES2020 --module commonjs --declaration
echo "  Built configuration modules"
echo ""

# Create output directory structure
mkdir -p dist/{mobile,nfc,config,scripts}
echo -e "${BLUE}Created output directories${NC}"
echo ""

# Copy static assets and scripts
cp scripts/*.sh dist/scripts/ 2>/dev/null || true
echo -e "${BLUE}Copied deployment scripts${NC}"
echo ""

echo -e "${GREEN}Build completed successfully!${NC}"
echo ""
echo "Output location: dist/"
echo ""
echo "Next steps:"
echo "  - Mobile: npm run start --prefix src/mobile"
echo "  - API: npm run start --prefix src/api"
echo "  - Deploy: bash scripts/deploy.sh"
