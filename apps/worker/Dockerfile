# Railway worker image (TECH_SPEC §3). Build context = REPO ROOT:
#   docker build -f apps/worker/Dockerfile .
# node:22-slim: Node 20 is EOL and exiftool-vendored v36 needs >= 22 (spec §8);
# Debian slim already ships perl-base (enough for ExifTool when #8 lands).
# Add poppler-utils here only if pdf-parse v2 falls short (spec §8.1).
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY packages/shared ./packages/shared
COPY apps/worker ./apps/worker
RUN pnpm install --frozen-lockfile --filter @archivemind/worker...
RUN pnpm --filter @archivemind/worker build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
# tsup bundles @archivemind/shared; pg and friends stay external → copy deps.
COPY --from=build /repo/apps/worker/dist ./dist
COPY --from=build /repo/apps/worker/package.json ./package.json
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/worker/node_modules ./apps/worker/node_modules
CMD ["node", "dist/index.js"]
