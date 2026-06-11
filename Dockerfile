# Multi-stage build for the Node + React app.
# Builds the client to client/dist, then the server image serves both.

FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm install
COPY tsconfig.base.json ./
COPY .npmrc ./
COPY shared ./shared
COPY server ./server
COPY client ./client
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/package.json /app/package-lock.json* ./
COPY --from=builder /app/shared/package.json ./shared/
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/server/package.json ./server/
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist
RUN npm install --omit=dev

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8501
EXPOSE 8501
CMD ["npm", "start"]
