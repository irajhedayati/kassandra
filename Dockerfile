# Multi-stage build for the Node + React app.
# Builds the client to client/dist, then the server image serves both.

FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY pnpm-workspace.yaml package.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY shared ./shared
COPY server ./server
COPY client ./client
RUN pnpm build

FROM node:20-alpine
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/shared/package.json ./shared/
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/server/package.json ./server/
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist
RUN pnpm install --prod --frozen-lockfile

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8501
EXPOSE 8501
CMD ["pnpm", "start"]
