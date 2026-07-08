#!/usr/bin/env bash
# One-time provisioning: create the nexus-uploads bucket and an access key.
# Run once after first `docker compose up`. Safe to re-run (idempotent).
set -euo pipefail

CONTAINER=${GARAGE_CONTAINER:-nexus-garage}
BUCKET=${GARAGE_S3_BUCKET:-nexus-uploads}
KEY_NAME=${GARAGE_KEY_NAME:-nexus-api}

echo "Provisioning Garage bucket: $BUCKET"

# Create layout (single-node, assign all capacity to node)
docker exec "$CONTAINER" garage layout assign -z garage -c 1 "$(docker exec "$CONTAINER" garage node id -q 2>/dev/null | head -1 | cut -c1-16)" 2>/dev/null || true
docker exec "$CONTAINER" garage layout apply --version 1 2>/dev/null || true

# Create bucket
docker exec "$CONTAINER" garage bucket create "$BUCKET" 2>/dev/null || echo "Bucket already exists"

# Create access key
KEY_OUTPUT=$(docker exec "$CONTAINER" garage key create "$KEY_NAME" 2>/dev/null || docker exec "$CONTAINER" garage key info "$KEY_NAME" 2>/dev/null)
echo "$KEY_OUTPUT"

# Allow key to access bucket (read + write)
ACCESS_KEY=$(echo "$KEY_OUTPUT" | grep -oP 'Key ID:\s+\K\S+' || true)
if [ -n "$ACCESS_KEY" ]; then
  docker exec "$CONTAINER" garage bucket allow --read --write --owner "$BUCKET" --key "$ACCESS_KEY" 2>/dev/null || true
fi

echo "Garage provisioning complete. Set GARAGE_S3_ACCESS_KEY_ID and GARAGE_S3_SECRET_ACCESS_KEY in .env"
