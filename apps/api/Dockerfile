# Hydris API — build from repo root: docker build -f apps/api/Dockerfile -t hydris-api .
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN npm ci --workspace @hydris/api --include-workspace-root=false && npm cache clean --force
ENV NODE_ENV=production HOST=0.0.0.0 API_PORT=4000
EXPOSE 4000
USER node
WORKDIR /app/apps/api
# Applies migrations on boot, then serves.
CMD ["npx", "tsx", "src/server.ts"]
