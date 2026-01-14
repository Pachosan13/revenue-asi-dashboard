FROM node:20-slim AS base
WORKDIR /app

# Install production deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Copy app
COPY server.js ./

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]

