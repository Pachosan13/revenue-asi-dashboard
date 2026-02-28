FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --production
RUN ls node_modules && ls node_modules/pg

RUN npx playwright install --with-deps

COPY worker ./worker

CMD ["node", "worker/run-enc24-autos-autopilot.mjs"]
