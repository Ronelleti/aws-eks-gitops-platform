# ---- deps: install production dependencies only ----
FROM node:25-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime: small image, non-root user ----
FROM node:25-alpine
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    APP_VERSION=$APP_VERSION
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
# the official node image ships a non-root "node" user (uid 1000)
USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
