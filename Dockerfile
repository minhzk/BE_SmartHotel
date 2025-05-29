FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache curl

# Copy package files
COPY package*.json ./

# Install dependencies 
RUN npm ci

# Copy source code
COPY . .

# Build application
RUN npm run build

# Remove devDependencies after build
RUN npm prune --production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

RUN chown -R nestjs:nodejs /app
USER nestjs

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/api/v1/health || exit 1

CMD ["npm", "run", "start:prod"]