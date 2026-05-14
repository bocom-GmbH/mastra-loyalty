FROM node:22-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

FROM base AS deps
COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm install --include=dev

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npx mastra build --studio

FROM base AS runtime
RUN apk add --no-cache dumb-init && \
    addgroup -S mastra && adduser -S mastra -G mastra
COPY --from=build --chown=mastra:mastra /app/.mastra/output ./.mastra/output
COPY --from=build --chown=mastra:mastra /app/package.json ./package.json

USER mastra
EXPOSE 4111
ENV PORT=4111
ENV MASTRA_STUDIO_PATH=/app/.mastra/output/studio

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4111/api/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", ".mastra/output/index.mjs"]
