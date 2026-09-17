# One image for every app service: bot, worker, lookup, migrate, storage-init.
# Compose (and later ECS) picks the entrypoint with `command`.
FROM node:24-trixie-slim

# openssl: Prisma's schema engine (migrate deploy). ca-certificates: outbound HTTPS.
# fonts-dejavu-core + fontconfig-config: slim images ship no fonts or font config, and sharp
# renders the contact sheet's numbers from SVG.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates fonts-dejavu-core fontconfig-config \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
# Not corepack: pnpm 12's bin is a shell stub that its install script swaps for a native binary,
# and corepack skips install scripts and runs the stub with node — a SyntaxError.
# Keep in step with "packageManager" in package.json.
RUN npm install -g pnpm@12.4.2

# --prod skips the devEngines Node download: the base image already is Node 24.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
RUN node_modules/.bin/prisma generate

COPY src ./src

# Runtime needs no package manager: services start with plain `node --import tsx`.
USER node
CMD ["node", "--import", "tsx", "src/bot/index.ts"]
