FROM node:22-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

FROM base AS deps
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then npm ci --include=dev; else npm install --include=dev; fi

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npx mastra build --studio
# Bundle the editor seed script alongside the Mastra output so the container
# can run `node .mastra/output/seed.mjs` without needing src/ or tsx.
# Externals reuse the node_modules that `mastra build` already produced.
RUN npx esbuild src/seed-editor.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --target=node22 \
    --outfile=.mastra/output/seed.mjs \
    --packages=external \
    --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);"

FROM base AS runtime
RUN apk add --no-cache dumb-init wget && \
    addgroup -S mastra && adduser -S mastra -G mastra
COPY --from=build --chown=mastra:mastra /app/.mastra/output ./.mastra/output
# Markdown guideline files are read at runtime by the read-guideline tool.
# They live outside the bundled output, so copy them alongside.
COPY --from=build --chown=mastra:mastra /app/src/mastra/governance/guidelines ./.mastra/output/guidelines

USER mastra
EXPOSE 4111
ENV PORT=4111
ENV MASTRA_STUDIO_PATH=/app/.mastra/output/studio

HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4111/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", ".mastra/output/index.mjs"]
