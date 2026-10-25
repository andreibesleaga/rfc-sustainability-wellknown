ARG BUILD_FROM=ghcr.io/home-assistant/base:3.22
FROM $BUILD_FROM
RUN apk add --no-cache nodejs npm
# The publisher needs Node 22.13 or newer; a base image with an older Node fails the build here, not at run time.
RUN node -e "const [a,b]=process.versions.node.split('.').map(Number); if (a < 22 || (a === 22 && b < 13)) { console.error('Node ' + process.versions.node + ' < 22.13'); process.exit(1) }"
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.mjs run.sh ./
RUN chmod +x run.sh
CMD ["/app/run.sh"]
