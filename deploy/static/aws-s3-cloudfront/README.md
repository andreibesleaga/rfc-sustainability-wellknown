# AWS: S3 + CloudFront (free tier; a real `cloud-billing` figure after one month)

What you get: an HTTPS origin serving the file with the four headers, and — from the second
month — AWS's own estimated emissions for the account (the AWS Sustainability service, free),
which becomes a `carbon-footprint` with `measurement-method: cloud-billing`.

**Free plan rule (read first):** a new account on the Free plan gets USD 100 in credits at once (up to
USD 200), valid six months, and **the account closes on its own after six months or when the credits
run out** unless converted to a paid plan. Treat this as a 3–4-month experiment and move the figure to a
permanent origin before then (your site, with the methodology page quoting the AWS figure).

## Steps
1. Create the account (Free plan), enable MFA, set a zero-spend budget alert.
2. `deploy.sh` (this folder) creates a private bucket, uploads the document with the right metadata,
   creates a response-headers policy and a CloudFront distribution with Origin Access Control.
   Needs the AWS CLI v2 and a profile with S3 + CloudFront permissions. Edit the three variables at
   the top first.
3. TLS for your own subdomain: request a certificate in ACM (us-east-1), add the alternate domain name
   to the distribution, CNAME the subdomain to the distribution's domain. Without a custom domain the
   `*.cloudfront.net` URL already works over HTTPS.
4. Verify: `npx -y -p sustainability-wellknown-consumer sustainability-fetch https://<host> --strict`.
5. Month 2 onward: AWS Sustainability (console, or `aws sustainability get-estimated-carbon-emissions`)
   gives the account's monthly MTCO2e by about the 21st of the following month. Publish it as
   `carbon-footprint` in `mtCO2e`, `measurement-method: cloud-billing`, and name the AWS model version
   in your methodology page. Publish no kWh unless AWS prints one.

`main.tf` is the same deployment as Terraform for people who prefer it (not run in CI).
