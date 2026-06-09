#!/bin/bash
# Start DynamoDB Local and initialize tables

set -e

echo "Starting DynamoDB Local..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "Error: Docker is not running"
    exit 1
fi

# Remove existing container if it exists
docker rm -f dynamodb-local 2>/dev/null || true

# Start DynamoDB Local container
docker run -d \
    --name dynamodb-local \
    -p 8000:8000 \
    amazon/dynamodb-local:latest

echo "Waiting for DynamoDB Local to be ready..."
sleep 5

# Check if DynamoDB is responding
max_attempts=30
attempt=0
while ! nc -z localhost 8000 2>/dev/null; do
    if [ $attempt -eq $max_attempts ]; then
        echo "Error: DynamoDB Local failed to start"
        exit 1
    fi
    attempt=$((attempt + 1))
    echo "Waiting... (attempt $attempt/$max_attempts)"
    sleep 1
done

echo "DynamoDB Local is ready!"
echo ""
echo "To seed the database, run:"
echo "  npm run seed"
echo ""
echo "To stop DynamoDB Local, run:"
echo "  docker stop dynamodb-local"
echo "  docker rm dynamodb-local"
