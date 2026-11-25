# Dev image (Phase 0). Phase 8 turns this into a multi-stage production build.
FROM node:26-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

USER node
ENV HOST=0.0.0.0 PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
CMD ["npm", "run", "dev"]
