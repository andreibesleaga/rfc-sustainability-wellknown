ARG BUILD_FROM=ghcr.io/home-assistant/base:3.20
FROM $BUILD_FROM
RUN apk add --no-cache nodejs npm
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server.mjs run.sh ./
RUN chmod +x run.sh
CMD ["/app/run.sh"]
