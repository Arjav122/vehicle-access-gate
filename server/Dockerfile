# Dev image. Phase 8 turns this into a multi-stage production build.
FROM node:26-alpine
WORKDIR /app
# Run as the non-root "node" user, and let it own /app so dev tools can write temp/cache files.
RUN chown node:node /app
USER node

# The Prisma schema must be present before `npm ci`: its postinstall step generates the client.
COPY --chown=node:node package.json package-lock.json prisma.config.ts ./
COPY --chown=node:node prisma ./prisma
RUN npm ci

COPY --chown=node:node . .

ENV HOST=0.0.0.0 PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4000/api/ready || exit 1
# Apply any new migrations, then start the API with reload on file changes.
CMD ["sh", "-c", "npx prisma migrate deploy && npm run dev"]
