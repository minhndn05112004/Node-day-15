# ─────────────────────────────────────────────
# Stage 1 — builder
# Install dependencies and build the production bundle.
# ─────────────────────────────────────────────
FROM node:18-alpine AS builder

WORKDIR /app

# Copy manifests first for better Docker layer caching
COPY package*.json ./

# Use npm ci for reproducible, clean installs (requires package-lock.json)
RUN npm ci

COPY . .

# Inject the API URL at build time (Vite bakes it into the bundle)
ARG VITE_API_URL=http://localhost:3000
ENV VITE_API_URL=${VITE_API_URL}

RUN npm run build

# ─────────────────────────────────────────────
# Stage 2 — production image
# Serve the built assets with Nginx (alpine = minimal footprint).
# ─────────────────────────────────────────────
FROM nginx:alpine

# Copy the compiled SPA from the builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Replace default Nginx config with our custom one.
# This adds SPA fallback (try_files → index.html) so page reloads don't 404.
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
