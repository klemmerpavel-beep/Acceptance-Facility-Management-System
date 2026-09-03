import "reflect-metadata";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { ZodExceptionFilter } from "./common/zod-exception.filter";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  await app.register(cookie);
  // Смета приходит книгой Excel: тело запроса многочастное.
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  // Глобальный ValidationPipe не подключается: он требует class-validator,
  // а проверка тела запроса выполняется схемами zod из @priyomka/contracts.
  // Одни и те же схемы типизируют клиента, поэтому расхождение невозможно.
  // Фильтр превращает отказ схемы в 400 с текстом отказа: без него это 500
  // «Internal server error» — неправда о том, где произошёл сбой.
  app.useGlobalFilters(new ZodExceptionFilter());
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? true, credentials: true });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, "0.0.0.0");
  new Logger("Приёмка").log(`API слушает порт ${port}`);
}

void bootstrap();
