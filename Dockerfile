# Painel Tempo Real - API Backend
# VERSION: v1.0.1
# Deploy: Cloud Run
# Na raiz do repo para Cloud Build (workspace = raiz)

FROM node:18-alpine

WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --only=production

COPY backend/ .

EXPOSE 5050

# Cloud Run define PORT em runtime
CMD ["node", "server.js"]
