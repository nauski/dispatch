# Build stage
FROM node:22-alpine AS build

WORKDIR /app
COPY package.json ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm install

COPY tsconfig.base.json ./
COPY packages/server/ packages/server/
COPY packages/web/ packages/web/

RUN npm run build:web && npm run build:server

# Production stage
FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm install --omit=dev

COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/web/dist packages/web/dist
COPY packages/server/drizzle packages/server/drizzle
COPY install.sh packages/server/install.sh
COPY uninstall.sh packages/server/uninstall.sh

EXPOSE 3000

CMD ["node", "packages/server/dist/index.js"]
