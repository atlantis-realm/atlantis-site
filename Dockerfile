# Multi-stage build for SvelteKit static site
FROM node:24-slim AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Build stage
FROM base AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

# Copy source code
COPY . .

# Generate SvelteKit files and sync TypeScript config
RUN npx svelte-kit sync

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine AS runner
WORKDIR /usr/share/nginx/html

# Copy built files from builder stage
COPY --from=builder /app/build .

# Copy nginx config for SPA routing
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
