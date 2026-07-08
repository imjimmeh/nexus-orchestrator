# Build stage
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json turbo.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/core/package.json ./packages/core/package.json
COPY packages/kanban-contracts/package.json ./packages/kanban-contracts/package.json
COPY packages/e2e-tests/package.json ./packages/e2e-tests/package.json
RUN npm ci
# npm has a long-standing bug where `npm ci` skips platform-specific optional
# native binaries for nested workspace deps, so the musl builds of lightningcss
# and @tailwindcss/oxide are absent on alpine and the Tailwind/PostCSS build
# fails with "Cannot find module '../lightningcss.linux-x64-musl.node'". Fetch
# them (pinned to the lockfile versions) in an isolated dir — installing in /app
# would re-resolve the monorepo workspace graph and 404 on uncopied packages —
# then drop the prebuilt binaries into the workspace node_modules.
RUN mkdir -p /tmp/native && cd /tmp/native \
	&& npm install --no-save --no-package-lock \
		lightningcss-linux-x64-musl@1.32.0 \
		@tailwindcss/oxide-linux-x64-musl@4.3.1 \
	&& cp -R /tmp/native/node_modules/. /app/node_modules/ \
	&& rm -rf /tmp/native
COPY packages/core ./packages/core
COPY packages/kanban-contracts ./packages/kanban-contracts
COPY apps/web ./apps/web
# Build the web app and its workspace dependencies in topological order.
RUN npx turbo run build --filter=@nexus/web

# Production stage
FROM nginx:alpine
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# Create entrypoint script for runtime config
RUN printf '%s\n' \
	'#!/bin/sh' \
	'API_URL_VALUE="${API_URL:-/api}"' \
	'CORE_API_URL_VALUE="${CORE_API_URL:-$API_URL_VALUE}"' \
	'KANBAN_API_URL_VALUE="${KANBAN_API_URL:-$API_URL_VALUE}"' \
	'CHAT_API_URL_VALUE="${CHAT_API_URL:-$API_URL_VALUE}"' \
	'printf "{\"apiUrl\":\"%s\",\"coreApiUrl\":\"%s\",\"kanbanApiUrl\":\"%s\",\"chatApiUrl\":\"%s\"}\\n" "$API_URL_VALUE" "$CORE_API_URL_VALUE" "$KANBAN_API_URL_VALUE" "$CHAT_API_URL_VALUE" > /usr/share/nginx/html/config.json' \
	'exec "$@"' > /docker-entrypoint.sh \
	&& chmod +x /docker-entrypoint.sh

EXPOSE 80
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
