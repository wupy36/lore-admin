# syntax=docker/dockerfile:1
# Lore Admin web console.
#   docker build -t lore-admin .
#   docker run -p 4800:4800 -v lore-admin-data:/data -e LORE_ADMIN_PASSWORD=change-me lore-admin
# linux/amd64 only (the Lore SDK ships a linux x64 library). The base must have glibc >= 2.39
# (lorelib requirement): Debian trixie, not bookworm.
# Rate-limited by Docker Hub? --build-arg NODE_IMAGE=mirror.gcr.io/library/node:22-trixie-slim
# Behind a TLS-inspecting proxy? --secret id=ca,src=/path/to/proxy-ca.pem (used only while installing).
ARG NODE_IMAGE=node:22-trixie-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 CI=1
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV CI=1
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
# Runtime needs only the Lore SDK (+ koffi); drop the Windows platform library the lockfile also pins.
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    pnpm install --frozen-lockfile --prod \
 && rm -rf node_modules/@lore-vcs/sdk-amd64-unknown-windows \
 && find node_modules/koffi/build/koffi -mindepth 1 -maxdepth 1 -type d ! -name linux_x64 -exec rm -rf {} + \
 && rm -rf node_modules/koffi/src node_modules/koffi/vendor

FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production LORE_ADMIN_DATA=/data LORE_ADMIN_PORT=4800 LORE_ADMIN_HOST=0.0.0.0
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/out/server ./out/server
COPY --from=build /app/out/web ./out/web
COPY package.json ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4800
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+(process.env.LORE_ADMIN_PORT||4800)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "out/server/main.cjs"]
