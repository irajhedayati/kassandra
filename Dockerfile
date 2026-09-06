# Multi-stage build for the Node + React app.
# Builds the client to client/dist, then the server image serves both.
#
# We use bookworm-slim (glibc) rather than alpine (musl) because Vite's
# esbuild dependency ships separate native binaries for the two libcs;
# alpine cross-builds via QEMU sometimes miss the musl variant.

FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm install --include=dev --no-audit --no-fund
COPY tsconfig.base.json ./
COPY shared ./shared
COPY server ./server
COPY client ./client
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=builder /app/package.json ./
COPY --from=builder /app/shared/package.json ./shared/
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/server/package.json ./server/
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist
RUN npm install --omit=dev --no-audit --no-fund

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8501
EXPOSE 8501
CMD ["npm", "start"]
