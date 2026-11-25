# Dev image (Phase 0): Vite dev server. Phase 8 turns this into a static build served by Caddy.
FROM node:26-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

USER node
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
