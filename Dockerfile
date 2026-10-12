FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml ./
COPY packages/server/package.json packages/server/package.json
COPY packages/admin/package.json packages/admin/package.json
RUN pnpm install --frozen-lockfile=false
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN corepack enable
# 构建时注入当前提交，供「检查更新」在容器内对比版本
ARG GIT_COMMIT=unknown
ENV GIT_COMMIT=${GIT_COMMIT}
ENV NODE_ENV=production
ENV PERSONABOT_DEPLOY=docker
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/server ./packages/server
COPY --from=build /app/packages/admin/dist ./packages/server/public
EXPOSE 3000
CMD ["node", "packages/server/dist/index.js"]
