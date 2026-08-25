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
# The VITE_ prefix is load-bearing, not a naming convention. `pnpm build` below
# is `turbo run build`, and turbo 2.x runs tasks in strict env mode: a task only
# sees the variables turbo.json declares, and this repo's declares none. Turbo
# does allowlist VITE_* by itself for Vite packages, so a prefixed name gets
# through (and into the cache key); the unprefixed INVESTING_WEB_BASE this used
# to be did not, so Vite fell back to base "/" and the deploy served a bundle
# that asked for /assets/… instead of /investing/assets/… . See the comments in
# apps/investing-web/vite.config.ts and apps/investing-web/src/base-guard.ts.
ENV VITE_INVESTING_BASE=/investing/

# Personal SPA — link "Investing" to /investing on this origin (override via build arg).
ARG VITE_INVESTING_URL=/investing
ENV VITE_INVESTING_URL=${VITE_INVESTING_URL}

# One build for the whole workspace. There used to be a separate, earlier
# `pnpm --filter @lavega/investing-web build` here; turbo builds that package
# too (`outputs: ["dist/**"]`), so the later build simply overwrote the earlier
# one — and whichever of the two saw the base variable, the last writer won.
# Keeping a single build removes the ordering trap entirely.
RUN pnpm build

# Refuse to ship a bundle that points somewhere it is not served from. This is
# the check the blank-page outage got past: every asset URL in the emitted
# index.html must carry the /investing/ prefix. The expected base is stated here
# instead of read back from VITE_INVESTING_BASE, because the bug WAS that
# variable going missing — a check reading the same variable would have agreed
# with the broken build.
RUN LAVEGA_EXPECT_INVESTING_BASE=/investing/ pnpm --filter @lavega/investing-web run verify:base

ENV NODE_ENV=production
ENV INVESTING_WEB_DIST=/app/apps/investing-web/dist
ENV INVESTING_MOUNT=1
# Railway provides PORT at runtime; the server reads it (defaults to 8787).
EXPOSE 8787
CMD ["pnpm", "start"]
