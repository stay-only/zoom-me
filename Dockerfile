# ---------- Tahap 1: build frontend (React + Vite) ----------
FROM node:22-alpine AS build-frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---------- Tahap 2: build backend (NestJS) ----------
FROM node:22-alpine AS build-backend
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# ---------- Tahap 3: image produksi (ramping) ----------
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

# Dependensi runtime backend saja (tanpa devDependencies)
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

# Hasil build: backend/dist + frontend/dist (disajikan oleh backend)
COPY --from=build-backend /app/backend/dist ./backend/dist
COPY --from=build-frontend /app/frontend/dist ./frontend/dist

EXPOSE 3000
CMD ["node", "backend/dist/main.js"]
