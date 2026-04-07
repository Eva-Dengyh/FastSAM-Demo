# Frontend Dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY frontend/package.json frontend/package-lock.json* ./

# Install dependencies
RUN npm ci

# Copy source code
COPY frontend/src ./src
COPY frontend/next.config.ts ./
COPY frontend/tsconfig.json ./
COPY frontend/postcss.config.mjs ./
COPY frontend/eslint.config.mjs ./

# Build
RUN npm run build

# Stage 2: Runner
FROM node:20-alpine AS runner

WORKDIR /app

# Copy from builder
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Expose port
EXPOSE 3000

ENV PORT=3000

CMD ["node", "server.js"]