FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN apt-get update && apt-get install -y ca-certificates && update-ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --production
RUN ls node_modules && ls node_modules/pg

RUN npx playwright install --with-deps

COPY worker ./worker

CMD ["node", "worker/run-enc24-autos-autopilot.mjs"]
