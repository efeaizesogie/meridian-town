# Meridian Town: the game server and the built web client in one container.
FROM node:24-slim
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/economy/package.json packages/economy/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY packages packages
COPY apps apps
RUN npm run build -w apps/web

# Secrets come from the host's environment (see docs/DEPLOY.md), state from a volume.
ENV PORT=8787 MERIDIAN_DATA_DIR=/data
EXPOSE 8787
CMD ["node", "apps/server/src/main.ts"]
