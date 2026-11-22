# VIDEO GAME FOR ALL (VGFA) — Deploy 24/7 em Porta Única (Render / Fly.io / Railway / VPS)
FROM node:22-slim

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile && pnpm build

ENV NODE_ENV=production
ENV VGFA_SERVE_STATIC=1
ENV PORT=8787
EXPOSE 8787

CMD ["pnpm", "--filter", "@vgfa/signaling-server", "start"]
