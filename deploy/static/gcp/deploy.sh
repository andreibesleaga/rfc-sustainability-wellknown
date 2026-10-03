#!/usr/bin/env bash
# Cloud Storage part of the GCP recipe. Needs gcloud (gsutil). Edit the bucket name.
set -euo pipefail
BUCKET="gs://sustainability-data-example-$RANDOM"
DOC="../../www/.well-known/sustainability-data"
gsutil mb -l EU "$BUCKET"
gsutil cp "$DOC" "$BUCKET/.well-known/sustainability-data"
gsutil setmeta -h "Content-Type:application/sustainability-data+json" -h "Cache-Control:public, max-age=86400" \
  "$BUCKET/.well-known/sustainability-data"
printf '[{"origin":["*"],"method":["GET","HEAD"],"responseHeader":["Content-Type"],"maxAgeSeconds":86400}]' > /tmp/cors.json
gsutil cors set /tmp/cors.json "$BUCKET"
gsutil iam ch allUsers:objectViewer "$BUCKET"
gsutil web set -m index.html "$BUCKET"
echo "Object served (no nosniff without a load balancer): https://storage.googleapis.com/${BUCKET#gs://}/.well-known/sustainability-data"
