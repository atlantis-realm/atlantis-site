FROM node:24-slim AS builder
WORKDIR /app

ARG GITHUB_NPM_TOKEN

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN corepack enable pnpm && \
    if [ -n "$GITHUB_NPM_TOKEN" ]; then \
      echo "//npm.pkg.github.com/:_authToken=${GITHUB_NPM_TOKEN}" >> .npmrc; \
    fi && \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm exec svelte-kit sync
RUN pnpm run build

FROM nginx:alpine AS runner
WORKDIR /usr/share/nginx/html

COPY --from=builder /app/build .
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
