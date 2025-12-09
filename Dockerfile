
FROM node:20-slim AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y ffmpeg

COPY package*.json ./
RUN npm install
COPY . .

RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./
COPY src/server.ts ./src/ 

CMD [ "npm", "run", "start" ]