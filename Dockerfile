FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production=false

COPY tsconfig.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/

RUN npx tsc --noEmit

EXPOSE 3100

CMD ["npx", "tsx", "src/index.ts"]
