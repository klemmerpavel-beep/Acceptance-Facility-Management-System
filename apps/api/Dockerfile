# Сборка API. Собирается из корня репозитория: пакеты рабочего пространства
# нужны целиком, поэтому контекст сборки — корень, а не apps/api.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo

# Манифест каждого пакета, от которого зависит api, копируется до установки:
# без манифеста pnpm не видит пакет рабочего пространства и не ставит его
# зависимости. Манифеста importer здесь не было, и exceljs находился только
# через зависимость корня — скрытая связность (фаза 0, дефект K8).
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/domain/package.json    packages/domain/
COPY packages/contracts/package.json packages/contracts/
COPY packages/importer/package.json  packages/importer/
COPY packages/ui/package.json        packages/ui/
COPY apps/api/package.json           apps/api/
RUN pnpm install --frozen-lockfile --filter @priyomka/api...

COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @priyomka/api exec prisma generate \
 && pnpm --filter @priyomka/api run build

FROM node:22-alpine AS runtime
RUN corepack enable
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo /repo
EXPOSE 3000
# Миграции применяются перед запуском: база поднимается с нуля одной командой.
CMD ["sh", "-c", "pnpm --filter @priyomka/api run migrate:deploy && pnpm --filter @priyomka/api run start"]
