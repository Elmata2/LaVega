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

# Build the web SPA into apps/web/dist (served by the server).
RUN pnpm build

ENV NODE_ENV=production
# Railway provides PORT at runtime; the server reads it (defaults to 8787).
EXPOSE 8787
CMD ["pnpm", "start"]
