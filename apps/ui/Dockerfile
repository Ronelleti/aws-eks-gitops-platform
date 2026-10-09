# ---- build: compile React to static files ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime: nginx serves static files and proxies /api ----
# unprivileged image: runs as non-root and listens on 8080
# alpine-slim: only nginx itself (no XSLT/GeoIP/image-filter modules we don't use) = fewer packages = fewer CVEs.
# Bump this when the CI security gate starts failing: old base images collect CVEs over time.
FROM nginxinc/nginx-unprivileged:1.31.6-alpine-slim
# default upstream for docker-compose; Kubernetes overrides it via env / ConfigMap
ENV API_UPSTREAM=http://api:3000
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080