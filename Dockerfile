# All-in-one image: build the web SPA + run the Hono server that serves it + API.
# Node 22 — pnpm 11.18.0 requires it (crashes on 18/20). pnpm is installed
# directly via npm, not corepack, to avoid corepack's signature check on newer
# pnpm versions.
FROM node:22-slim
WORKDIR /app

RUN npm install -g pnpm@11.18.0

# Install all deps (devDeps included — Vite is needed to build the web app).
COPY . .
RUN pnpm install --frozen-lockfile

# Investing dashboard: UI under /investing/, API merged into the personal server.
ENV INVESTING_WEB_BASE=/investing/
RUN pnpm --filter @lavega/investing-web build

# Personal SPA — link "Investing" to /investing on this origin (override via build arg).
ARG VITE_INVESTING_URL=/investing
ENV VITE_INVESTING_URL=${VITE_INVESTING_URL}
RUN pnpm build

ENV NODE_ENV=production
ENV INVESTING_WEB_DIST=/app/apps/investing-web/dist
ENV INVESTING_MOUNT=1
# Railway provides PORT at runtime; the server reads it (defaults to 8787).
EXPOSE 8787
CMD ["pnpm", "start"]
