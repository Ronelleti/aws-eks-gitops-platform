# ---- build: compile React to static files ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime: nginx serves static files and proxies /api ----
# unprivileged image: runs as non-root and listens on 8080
FROM nginxinc/nginx-unprivileged:1.27-alpine
# default upstream for docker-compose; Kubernetes overrides it via env / ConfigMap
ENV API_UPSTREAM=http://api:3000
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
