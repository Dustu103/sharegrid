# ── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --only=production && npm cache clean --force

# ── Stage 2: development (with devDependencies for nodemon) ──────────────────
FROM node:20-alpine AS development
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install && npm cache clean --force
COPY . .
RUN mkdir -p data
EXPOSE 3001 9229
CMD ["node", "server.js"]

# ── Stage 3: production ───────────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# Non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

# Copy prod deps from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Create writable data directory for SQLite
RUN mkdir -p data && chown -R nodejs:nodejs /app

USER nodejs
EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/api/health',r=>process.exit(r.statusCode===200?0:1))"

CMD ["node", "server.js"]
