#!/usr/bin/env bash
# S3 + CloudFront deployment of /.well-known/sustainability-data. AWS CLI v2. Edit the variables.
set -euo pipefail
BUCKET="sustainability-data-example-$RANDOM"   # globally unique
REGION="eu-central-1"                            # Frankfurt; pick the region nearest you
DOC="../../www/.well-known/sustainability-data"  # your document

aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
  --create-bucket-configuration LocationConstraint="$REGION"
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# The object's metadata is what S3 serves; set the type and cache life here.
aws s3 cp "$DOC" "s3://$BUCKET/.well-known/sustainability-data" \
  --content-type application/sustainability-data+json --cache-control "public, max-age=86400"
printf '<!doctype html><title>sustainability-data</title>' > /tmp/index.html
aws s3 cp /tmp/index.html "s3://$BUCKET/index.html" --content-type "text/html; charset=utf-8"

# Origin Access Control so the bucket stays private and only CloudFront reads it.
OAC=$(aws cloudfront create-origin-access-control --origin-access-control-config \
  Name="oac-$BUCKET",SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3 \
  --query OriginAccessControl.Id --output text)
POLICY=$(aws cloudfront create-response-headers-policy --response-headers-policy-config file://response-headers-policy.json \
  --query ResponseHeadersPolicy.Id --output text)

cat > /tmp/dist.json <<EOF
{ "CallerReference": "$BUCKET-$(date +%s)", "Comment": "sustainability-data", "Enabled": true,
  "DefaultRootObject": "index.html",
  "Origins": { "Quantity": 1, "Items": [ { "Id": "s3", "DomainName": "$BUCKET.s3.$REGION.amazonaws.com",
    "OriginAccessControlId": "$OAC", "S3OriginConfig": { "OriginAccessIdentity": "" } } ] },
  "DefaultCacheBehavior": { "TargetOriginId": "s3", "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": { "Quantity": 2, "Items": ["GET","HEAD"], "CachedMethods": { "Quantity": 2, "Items": ["GET","HEAD"] } },
    "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
    "ResponseHeadersPolicyId": "$POLICY", "Compress": true } }
EOF
DIST=$(aws cloudfront create-distribution --distribution-config file:///tmp/dist.json --query Distribution.Id --output text)
ARN=$(aws cloudfront get-distribution --id "$DIST" --query Distribution.ARN --output text)
DOMAIN=$(aws cloudfront get-distribution --id "$DIST" --query Distribution.DomainName --output text)

# Let that distribution, and only it, read the bucket.
cat > /tmp/bucket-policy.json <<EOF
{ "Version": "2012-10-17", "Statement": [ { "Sid": "AllowCloudFrontRead", "Effect": "Allow",
  "Principal": { "Service": "cloudfront.amazonaws.com" }, "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::$BUCKET/*", "Condition": { "StringEquals": { "AWS:SourceArn": "$ARN" } } } ] }
EOF
aws s3api put-bucket-policy --bucket "$BUCKET" --policy file:///tmp/bucket-policy.json
echo "Deployed. When the distribution is ready (minutes), verify:"
echo "  npx -y -p sustainability-wellknown-consumer sustainability-fetch https://$DOMAIN --strict"
