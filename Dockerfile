# syntax=docker/dockerfile:1
# Build only the static web app and preprocessed, committed Mars tiles.
FROM node:22-alpine AS builder
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json index.html ./
COPY web ./web
COPY public ./public
COPY scripts/build_web.mjs scripts/serve_static.mjs scripts/serve_static.test.mjs ./scripts/
RUN npm test && npm run build

FROM node:22-alpine AS production
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080
WORKDIR /app
COPY --from=builder --chown=node:node /workspace/dist ./dist
COPY --chown=node:node scripts/serve_static.mjs ./scripts/serve_static.mjs
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('node:http').get('http://127.0.0.1:8080/_health',r=>{r.resume();process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"
CMD ["node", "scripts/serve_static.mjs"]
