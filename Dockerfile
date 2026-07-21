FROM node:24-slim AS builder
WORKDIR /app

ARG PACKAGES_READ_TOKEN

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN corepack enable pnpm && \
    if [ -z "$PACKAGES_READ_TOKEN" ]; then \
      echo "ERROR: PACKAGES_READ_TOKEN is empty during build." >&2; \
      echo "Shared variables are not injected automatically. On each Coolify app add:" >&2; \
      echo "  PACKAGES_READ_TOKEN={{server.PACKAGES_READ_TOKEN}}" >&2; \
      echo "Enable Build Variable (and Literal if the token contains \$)." >&2; \
      exit 1; \
    fi && \
    echo "//npm.pkg.github.com/:_authToken=${PACKAGES_READ_TOKEN}" >> .npmrc && \
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
