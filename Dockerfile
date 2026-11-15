# syntax=docker/dockerfile:1

# ---- build stage -----------------------------------------------------------
FROM node:26-alpine AS build
WORKDIR /app
RUN echo "os-refresh 2026-11-15" && apk upgrade --no-cache
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime stage ---------------------------------------------------------
FROM node:26-alpine AS runtime
WORKDIR /app
RUN echo "os-refresh 2026-11-15" && apk upgrade --no-cache
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data \
    UPLOAD_DIR=/app/uploads
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
RUN mkdir -p /app/data /app/uploads && chown -R node:node /app/data /app/uploads
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist-server/server/index.js"]
