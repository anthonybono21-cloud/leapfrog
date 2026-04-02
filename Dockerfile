FROM node:20-slim

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Install production + dev dependencies (need devDeps for build step)
# Skip the postinstall playwright download — we install it explicitly below
RUN npm ci --ignore-scripts

# Copy source and build config
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Prune dev dependencies after build
RUN npm prune --production

# Install Playwright Chromium with system dependencies
RUN npx playwright install --with-deps chromium

ENTRYPOINT ["node", "dist/index.js"]
