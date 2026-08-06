FROM node:24-bookworm-slim AS build

WORKDIR /app
ENV NODE_ENV=development

COPY . .
RUN npm ci
RUN npm run typecheck
RUN npm run build:ui
RUN npm run build --workspace=@workspace/api-server
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5000

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/api/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
