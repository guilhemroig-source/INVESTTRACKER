# Tracker des grands investisseurs : appli web + planificateur dans un seul conteneur.
# La base SQLite vit sur un volume monté en /data (DATABASE_PATH).
FROM node:22-bookworm-slim

# Outils de compilation, au cas où le binaire précompilé de better-sqlite3 manquerait
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && NEXT_TELEMETRY_DISABLED=1 pnpm build

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_PATH=/data/tracker.db \
    PORT=3000
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "scripts/start-all.mjs"]
