# AI Vehicle Access — Next.js frontend (monorepo layout preserved).
# Dev-server image: matches local `npm run dev` (no app code changes required).
# Build context: repository root (see docker-compose.yml).

FROM node:20-bookworm-slim

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend ./

ARG BACKEND_INTERNAL_URL=http://api:8000
ARG API_PORT=8000
ENV BACKEND_INTERNAL_URL=${BACKEND_INTERNAL_URL}
ENV API_PORT=${API_PORT}
ENV NEXT_PUBLIC_API_URL=
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "dev", "--", "-H", "0.0.0.0", "-p", "3000"]
