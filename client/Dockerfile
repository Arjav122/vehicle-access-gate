# Dev image (Phase 0): Vite dev server. Phase 8 turns this into a static build served by Caddy.
FROM node:26-alpine
WORKDIR /app
# Run as the non-root "node" user, and let it own /app: Vite writes a temp file next to vite.config.ts.
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci

COPY --chown=node:node . .

EXPOSE 5173
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:5173/ > /dev/null || exit 1
CMD ["npx", "vite", "--host", "0.0.0.0"]
