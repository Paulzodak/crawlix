# syntax=docker/dockerfile:1
# Multi-stage build for production
FROM ghcr.io/puppeteer/puppeteer:latest AS builder

# Set working directory
USER root
WORKDIR /app
RUN chown -R pptruser:pptruser /app
USER pptruser

# Copy package files
COPY package*.json ./

# Increase npm timeout for slow/unreliable networks
ENV NPM_CONFIG_FETCH_TIMEOUT=120000
ENV NPM_CONFIG_FETCH_RETRIES=5

# Install dependencies from lockfile (faster, reproducible CI installs)
RUN npm ci

# Copy source code (COPY is root-owned even when USER is pptruser)
COPY . .
USER root
RUN chown -R pptruser:pptruser /app
USER pptruser

# Introspect DATABASE_URL and compile. Pass the url as a BuildKit secret:
# docker build --secret id=database_url,env=DATABASE_URL .
RUN --mount=type=secret,id=database_url,mode=0444 \
  DATABASE_URL="$(cat /run/secrets/database_url)" npm run build

# Production stage (runtime only: prod deps + compiled dist)
FROM ghcr.io/puppeteer/puppeteer:latest AS production
# Base image defaults to non-root pptruser; installs and useradd need root
USER root
WORKDIR /app

# Install LibreOffice early so this layer is cached across app code changes
# (only re-runs when this line or the base image changes)
# RUN apk add --no-cache libreoffice

# Copy package files (includes package-lock.json for reproducible installs)
COPY package*.json ./

# Skip postinstall scripts during install (Prisma client generated explicitly below)
ENV NPM_CONFIG_IGNORE_SCRIPTS=1
ENV PUPPETEER_CACHE_DIR=/home/pptruser/.cache/puppeteer

# Install production dependencies only from lockfile.
RUN npm ci --omit=dev

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Copy data directory (if needed)
COPY data ./data

# Run as pptruser (base image default): Chrome for Testing lives under /home/pptruser/.cache/puppeteer.
# A separate "nodejs" user cannot read that path, so Puppeteer would fail with "Could not find Chrome".
RUN chown -R pptruser:pptruser /app

USER pptruser

# Ensure Chrome exists at runtime even when npm postinstall scripts are disabled.
RUN npx puppeteer browsers install chrome

# Expose port
EXPOSE 8000

# Set environment to production
ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=450

# Start the server
CMD ["node", "dist/server.js"]