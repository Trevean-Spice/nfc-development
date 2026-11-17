#!/bin/bash
# Deployment script for Trevean NFC project
# Supports staging and production environments

set -e

ENVIRONMENT=${1:-staging}
DEPLOY_REGION=${AWS_REGION:-us-east-1}

# Color output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}=== Trevean NFC Deployment ===${NC}"
echo "Environment: $ENVIRONMENT"
echo "Region: $DEPLOY_REGION"
echo ""

# Validate environment
if [ "$ENVIRONMENT" != "staging" ] && [ "$ENVIRONMENT" != "production" ]; then
    echo -e "${RED}Error: Invalid environment. Must be 'staging' or 'production'${NC}"
    exit 1
fi

# Confirm production deployment
if [ "$ENVIRONMENT" = "production" ]; then
    echo -e "${YELLOW}WARNING: You are about to deploy to PRODUCTION${NC}"
    read -p "Type 'yes' to confirm: " confirm
    if [ "$confirm" != "yes" ]; then
        echo "Deployment cancelled"
        exit 1
    fi
fi

# Load environment variables
echo -e "${BLUE}Loading environment configuration...${NC}"
ENV_FILE="config/.env.$ENVIRONMENT"
if [ ! -f "$ENV_FILE" ]; then
    echo -e "${YELLOW}Warning: $ENV_FILE not found, using defaults${NC}"
else
    source "$ENV_FILE"
fi
echo ""

# Run tests
echo -e "${BLUE}Running tests...${NC}"
npm test --if-present || {
    echo -e "${RED}Tests failed. Deployment aborted.${NC}"
    exit 1
}
echo -e "${GREEN}Tests passed${NC}"
echo ""

# Build project
echo -e "${BLUE}Building project...${NC}"
bash scripts/build.sh
echo -e "${GREEN}Build completed${NC}"
echo ""

# Deploy API to AWS Lambda
if [ -d "src/api" ]; then
    echo -e "${BLUE}Deploying API...${NC}"
    
    # Package API
    cd dist/api
    zip -r ../api-lambda.zip . > /dev/null 2>&1
    cd ../..
    
    # Deploy to Lambda
    FUNCTION_NAME="trevean-nfc-api-$ENVIRONMENT"
    echo "  Deploying Lambda function: $FUNCTION_NAME"
    
    aws lambda update-function-code \
        --function-name "$FUNCTION_NAME" \
        --zip-file fileb://dist/api-lambda.zip \
        --region "$DEPLOY_REGION" > /dev/null
    
    echo -e "${GREEN}API deployed${NC}"
    echo ""
fi

# Deploy web app to CloudFront/S3
if [ -d "src/web" ]; then
    echo -e "${BLUE}Deploying web app...${NC}"
    
    S3_BUCKET="trevean-nfc-web-$ENVIRONMENT"
    DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
        --stack-name "trevean-nfc-web-$ENVIRONMENT" \
        --region "$DEPLOY_REGION" \
        --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
        --output text 2>/dev/null || echo "")
    
    echo "  Uploading to S3: $S3_BUCKET"
    aws s3 sync dist/web s3://"$S3_BUCKET" \
        --region "$DEPLOY_REGION" \
        --delete \
        --cache-control "max-age=31536000,public" > /dev/null
    
    # Invalidate CloudFront cache
    if [ ! -z "$DISTRIBUTION_ID" ]; then
        echo "  Invalidating CloudFront cache: $DISTRIBUTION_ID"
        aws cloudfront create-invalidation \
            --distribution-id "$DISTRIBUTION_ID" \
            --paths "/*" > /dev/null
    fi
    
    echo -e "${GREEN}Web app deployed${NC}"
    echo ""
fi

# Deploy mobile app (if applicable)
if [ -d "src/mobile" ]; then
    echo -e "${BLUE}Mobile app deployment${NC}"
    echo "  Note: Mobile app deployment requires Expo or native build tools"
    echo "  Manual build required: npm run build:android or npm run build:ios"
    echo ""
fi

# Run database migrations if needed
if [ "$ENVIRONMENT" = "production" ]; then
    echo -e "${BLUE}Running database migrations...${NC}"
    npm run migrate --if-present || echo "  No migrations to run"
    echo ""
fi

# Post-deployment health check
echo -e "${BLUE}Running health checks...${NC}"
API_URL="https://api-$ENVIRONMENT.trevean.com/health"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL" || echo "000")

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}Health check passed${NC}"
else
    echo -e "${YELLOW}Warning: Health check returned HTTP $HTTP_CODE${NC}"
fi
echo ""

# Deployment summary
echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo "Environment: $ENVIRONMENT"
echo "Region: $DEPLOY_REGION"
echo "Timestamp: $(date)"
echo ""
echo "Next steps:"
echo "  - Monitor logs: aws logs tail /aws/lambda/trevean-nfc-api-$ENVIRONMENT --follow"
echo "  - Check status: https://console.aws.amazon.com/lambda"
echo ""
