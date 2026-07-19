FROM node:24-slim AS base

FROM base AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

FROM base AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

COPY . .

RUN npx svelte-kit sync

RUN npm run build

FROM nginx:alpine AS runner
WORKDIR /usr/share/nginx/html

COPY --from=builder /app/build .

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
