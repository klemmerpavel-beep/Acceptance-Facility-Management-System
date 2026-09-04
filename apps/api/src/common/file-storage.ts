import { Injectable } from "@nestjs/common";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/**
 * Хранилище файлов.
 *
 * Абстрактный класс, а не интерфейс: он служит ключом внедрения
 * зависимости Nest и потому не требует ни строковых токенов, ни новых
 * пакетов.
 *
 * Набор методов сведён к тому, что одинаково даёт и файловая система, и
 * объектное хранилище: положить, взять, удалить. Обхода каталога,
 * перечисления и переименования здесь нет — их нет и у S3 в том же виде,
 * а порт, повторяющий возможности одной реализации, перестаёт быть портом.
 *
 * Реализация одна — на файловой системе. Архитектура объявляет S3
 * (`docker-compose.yml` содержит службу MinIO, `.env.example` — ключи
 * `S3_*`), но клиент S3 — зависимость, а до переезда в российское облако
 * (план 6.1) она не нужна ни на стенде, ни в сборке. Подключение второго
 * адаптера — замена одной строки провайдера в `app.module.ts`, а не
 * переделка вызывающего кода.
 */
export abstract class FileStorage {
  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;
  abstract get(key: string): Promise<Buffer>;
  abstract remove(key: string): Promise<void>;
}

/**
 * Ключ файла собирает сервер, от клиента он не приходит никогда. Проверка
 * всё равно стоит: ключ попадает в путь на диске, и подъём по `..` из
 * значения, однажды пришедшего из базы, стоил бы каталога целиком.
 */
const SAFE_KEY = /^[a-z0-9][a-z0-9/_.-]*$/;

@Injectable()
export class LocalFileStorage extends FileStorage {
  /**
   * Корень хранилища. Значение по умолчанию относительное: на стенде и в
   * сборке каталог создаётся рядом с рабочим, а на сервере задаётся
   * переменной `STORAGE_DIR` и указывает на том.
   */
  private readonly root = resolve(process.env.STORAGE_DIR ?? "var/storage");

  private path(key: string): string {
    if (!SAFE_KEY.test(key)) {
      throw new Error(`Недопустимый ключ файла: ${key}`);
    }
    const full = resolve(join(this.root, key));
    // resolve() уже свернул «..»; сверка префикса ловит то, что осталось.
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error(`Ключ файла выходит за пределы хранилища: ${key}`);
    }
    return full;
  }

  // Тип содержимого объявлен портом ради S3, где он часть запроса; файловая
  // система его не принимает, и параметр здесь опущен, а не назван впустую.
  async put(key: string, body: Buffer): Promise<void> {
    const full = this.path(key);
    // Каталог создаётся при записи: на чистой машине его нет, и падение
    // загрузки из-за отсутствующего каталога ничего не сообщает о причине.
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, body);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async remove(key: string): Promise<void> {
    // force: файла может уже не быть — снятие плана дважды подряд не
    // повод для отказа.
    await rm(this.path(key), { force: true });
  }
}
