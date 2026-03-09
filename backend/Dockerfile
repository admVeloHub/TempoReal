# Painel Tempo Real - API Backend
# VERSION: v1.0.0
# Deploy: Cloud Run

FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 5050

# Cloud Run define PORT em runtime
CMD ["node", "server.js"]
