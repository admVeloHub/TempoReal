# Painel Tempo Real - Container unificado (Frontend + Backend)
# VERSION: v1.0.2
# Deploy: Cloud Run

# Stage 1: Build frontend
FROM node:18-alpine AS frontend-build
WORKDIR /app

COPY package*.json ./
COPY postcss.config.js tailwind.config.js ./
COPY public/ ./public/
COPY src/ ./src/

RUN npm install
ENV REACT_APP_API_URL=
RUN npm run build

# Stage 2: Backend + frontend
FROM node:18-alpine
WORKDIR /app

COPY backend/package*.json ./
RUN npm ci --only=production

COPY backend/ .
COPY --from=frontend-build /app/build ./build

EXPOSE 8080

# Cloud Run usa PORT=8080
CMD ["node", "server-full.js"]
