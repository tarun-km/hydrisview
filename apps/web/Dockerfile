# Hydris web (website + console + glasses viewport) — build from repo root.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN npm ci --workspace @hydris/web --include-workspace-root=false
ARG API_URL=http://api:4000
ENV API_URL=$API_URL
RUN npm run build -w @hydris/web

FROM node:24-slim
WORKDIR /app
COPY --from=build /app ./
ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["npm", "run", "start", "-w", "@hydris/web"]
