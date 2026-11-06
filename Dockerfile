# Production image (for hosting anywhere that runs containers, e.g. AWS).
# Render uses render.yaml instead and does not need this file.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --workspace server && npm cache clean --force
COPY server/ server/
COPY --from=build /app/client/dist client/dist
USER node
EXPOSE 3001
CMD ["node", "server/src/index.js"]
