FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN node scripts/copy-mediapipe-wasm.js

# NEXT_PUBLIC_* vars are inlined into the client bundle at build time, so they
# must be the browser-reachable URL (e.g. http://localhost:8000), not a
# Docker-internal service name like http://backend:8000.
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=""
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=${NEXT_PUBLIC_GOOGLE_CLIENT_ID}

RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# `output: "standalone"` (next.config.ts) traces only the deps actually used
# at runtime into .next/standalone, so this final image skips node_modules entirely.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
