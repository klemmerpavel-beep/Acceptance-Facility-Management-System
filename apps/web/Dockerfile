FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/domain/package.json    packages/domain/
COPY packages/contracts/package.json packages/contracts/
COPY packages/ui/package.json        packages/ui/
COPY apps/web/package.json           apps/web/
RUN pnpm install --frozen-lockfile --filter @priyomka/web...

COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm --filter @priyomka/web run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
