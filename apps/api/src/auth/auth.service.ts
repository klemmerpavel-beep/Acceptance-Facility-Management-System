import { randomBytes, createHash, randomInt, timingSafeEqual } from "node:crypto";
import {
  BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException, UnauthorizedException,
} from "@nestjs/common";
import { AuthPurpose, type Prisma } from "@prisma/client";
import { formatPhone, parsePhone, type PhoneNumber } from "@priyomka/domain";
import { PrismaService } from "../prisma.service";
import type { RequestUser } from "../common/current-user";
import { echoesSecrets } from "./echo";
import {
  ЖурналНеизвестныхНомеров, ЧАС_МС, СУТКИ_МС, пределыИз, решениеОКоде, текстПредела, type ПределыВхода,
} from "./limits";

/** Магическая ссылка руководителя живёт минуты: она приходит на почту. */
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
/** Персональная ссылка прораба живёт долго: он не вводит ничего вообще. */
const FOREMAN_LINK_TTL_MS = 180 * 24 * 60 * 60 * 1000;
/** Код подтверждения живёт пять минут: дольше он живёт в чужих руках. */
const SMS_CODE_TTL_MS = 5 * 60 * 1000;
/* Пауза повторной отправки и пределы кодов и ссылок за окно — `limits.ts`,
   переменными окружения с умолчаниями (ADR-0008, пп. 5–6). */
/**
 * Шесть цифр перебираются за миллион запросов, поэтому попыток пять.
 * Ограничение времени жизни само по себе перебор не останавливает.
 */
const SMS_MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const hash = (token: string): string => createHash("sha256").update(token).digest("hex");
const newToken = (): string => randomBytes(32).toString("base64url");
/**
 * Хеш кода солится идентификатором пользователя. Без соли миллион хешей
 * шестизначных кодов считается заранее, а `tokenHash` уникален — два
 * человека с одинаковым кодом не смогли бы войти одновременно.
 */
const codeHash = (userId: string, code: string): string => hash(`${userId}:${code}`);
/** Код из шести цифр. randomInt — криптостойкий источник, Math.random — нет. */
const newCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, "0");

@Injectable()
export class AuthService {
  /** Пределы читаются при запуске: опечатка в окружении роняет запуск, а не снимает предел. */
  private readonly пределы: ПределыВхода = пределыИз(process.env);
  /** Выдачи на номера, которых нет в системе, — чтобы ответ их не различал (`limits.ts`). */
  private readonly неизвестные = new ЖурналНеизвестныхНомеров();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Создаёт одноразовую ссылку входа. Возвращает сам токен — его отправляет
   * почтовый отправитель. В базе хранится только хеш: утечка таблицы
   * не даёт войти.
   *
   * Непогашенных ссылок на адрес за час — не больше предела (ADR-0008, п. 6;
   * П-63): прежде каждый запрос заводил строку, и форма была рассылкой писем
   * на чужой адрес. Сверх предела ответ прежний — «ссылка отправлена», —
   * а строки нет: иначе форма снова различала бы существующий адрес.
   * Погашенная ссылка в счёт не идёт: она привела к входу и рассылкой не была.
   */
  async issueLink(email: string): Promise<{ token: string } | null> {
    // Снятый доступ не возвращается письмом: запись осталась ради авторства (П-51).
    const user = await this.prisma.user.findFirst({ where: { email, revokedAt: null } });
    // Ответ не различает «нет такого адреса» и «ссылка отправлена»:
    // иначе форма входа становится проверялкой существования адресов.
    if (!user) return null;
    return this.prisma.$transaction(async (tx) => {
      /* Подсчёт и запись — под блокировкой строки человека: параллельные
         запросы иначе прочли бы один и тот же счёт и прошли предел все разом.
         Сырой запрос — шаблонной строкой: построитель Prisma блокировки
         строки не выражает. */
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
      const живых = await tx.authToken.count({
        where: {
          userId: user.id,
          purpose: AuthPurpose.MAGIC_LINK,
          usedAt: null,
          createdAt: { gt: new Date(Date.now() - ЧАС_МС) },
        },
      });
      if (живых >= this.пределы.ссылокВЧас) return null;
      return this.createToken(user.id, AuthPurpose.MAGIC_LINK, MAGIC_LINK_TTL_MS, tx);
    });
  }

  /**
   * Персональная ссылка. Выдаёт руководитель — и только человеку своей
   * организации.
   *
   * Организация спрашивается здесь, а не только у вызывающего: прежде метод
   * брал один `userId`, и маршрут, забывший отбор, выдавал вход в чужую
   * организацию (полный аудит 30.09.2026, П-15). Проверка на месте выдачи
   * не зависит от того, кто и откуда её позовёт.
   */
  /* Клиент транзакции — чтобы выдача ссылки и её запись в журнале
     фиксировались вместе (П-37).

     Новая ссылка отзывает прежние персональные ссылки человека — в той же
     транзакции, до выдачи (ADR-0008, п. 4; K6 фазы 0, П-62). Персональная
     ссылка многоразовая (`consume` ниже), и прежде «Выдать ссылку» оставляла
     действующими обе: потерянную можно было отозвать только снятием доступа
     целиком. Удаление, а не отметка обмена: отметку `usedAt` обмен
     персональной ссылки не проверяет. Сессии, уже открытые прежней ссылкой,
     живут до своего срока — так решено до ответа заказчика при приёмке. */
  async issueForemanLink(
    userId: string, orgId: string, tx: Prisma.TransactionClient = this.prisma,
  ): Promise<{ token: string }> {
    const свой = await tx.user.findFirst({ where: { id: userId, orgId, revokedAt: null }, select: { id: true } });
    if (!свой) throw new NotFoundException({ message: "Человек не найден или недоступен." });
    await tx.authToken.deleteMany({ where: { userId: свой.id, purpose: AuthPurpose.FOREMAN_LINK } });
    return this.createToken(свой.id, AuthPurpose.FOREMAN_LINK, FOREMAN_LINK_TTL_MS, tx);
  }

  private async createToken(
    userId: string, purpose: AuthPurpose, ttlMs: number, tx: Prisma.TransactionClient = this.prisma,
  ) {
    const token = newToken();
    await tx.authToken.create({
      data: {
        userId,
        tokenHash: hash(token),
        purpose,
        expiresAt: new Date(Date.now() + ttlMs),
      },
    });
    return { token };
  }

  /**
   * Обменивает ссылку на сессию. Магическая ссылка гасится после первого
   * использования; персональная ссылка прораба остаётся действующей, иначе
   * он потеряет доступ, открыв её на втором устройстве.
   */
  async consume(token: string): Promise<{ sessionToken: string; expiresAt: Date }> {
    const record = await this.prisma.authToken.findUnique({
      where: { tokenHash: hash(token) },
      include: { user: { select: { revokedAt: true } } },
    });
    const invalid = new UnauthorizedException({
      message: "Ссылка входа недействительна или истекла. Запросите новую.",
    });
    if (!record || record.expiresAt < new Date()) throw invalid;
    // Ссылки снятого удаляются вместе с доступом; проверка — на случай гонки с выдачей.
    if (record.user.revokedAt !== null) throw invalid;
    // Код подтверждения обменивается своим маршрутом, где считаются попытки.
    if (record.purpose === AuthPurpose.SMS_CODE) throw invalid;
    if (record.purpose === AuthPurpose.MAGIC_LINK && record.usedAt) throw invalid;

    if (record.purpose === AuthPurpose.MAGIC_LINK) {
      /* Гасится условным обновлением: прочитать «не погашена» и погасить
         двумя шагами значило открыть две сессии двумя параллельными
         переходами по одной ссылке (полный аудит 30.09.2026, П-24). */
      const погашена = await this.prisma.authToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (погашена.count === 0) throw invalid;
    }

    return this.openSession(record.userId);
  }

  private async openSession(userId: string): Promise<{ sessionToken: string; expiresAt: Date }> {
    const sessionToken = newToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.session.create({
      data: { userId, tokenHash: hash(sessionToken), expiresAt },
    });
    return { sessionToken, expiresAt };
  }

  /**
   * Выдаёт код подтверждения на номер телефона.
   *
   * Ответ одинаков для существующего и несуществующего номера: иначе форма
   * входа превращается в проверялку того, чей номер есть в системе. Код при
   * этом создаётся только существующему пользователю.
   *
   * Частота (ADR-0008, п. 5; K7 фазы 0, П-63). Пауза отсчитывается от
   * последнего выданного кода, погашен он или нет: прежде она действовала,
   * только пока жил непогашенный код, и цикл «запрос, пять догадок, гашение»
   * шёл без паузы. Кодов на номер за час и за сутки — не больше предела;
   * сверх него — отказ 429 с числом минут. Несуществующий номер проходит те
   * же пауза и пределы по журналу в памяти (`limits.ts`): ни 429, ни остаток
   * паузы не выдают, есть ли номер в системе.
   */
  async issueSmsCode(rawPhone: string): Promise<{ phone: string; code?: string; retryAfterSeconds: number }> {
    const phone = this.normalizePhone(rawPhone);
    const shown = formatPhone(phone);
    const паузаСекунд = this.пределы.паузаКодаМс / 1000;
    const user = await this.prisma.user.findFirst({ where: { phone, revokedAt: null } });

    if (!user) {
      /* Решение и отметка — без ожидания между ними: обработчик не
         уступает ход, и два параллельных запроса не прочтут один и тот же
         журнал. */
      const сейчас = new Date();
      const решение = решениеОКоде(this.неизвестные.выданы(phone, сейчас), сейчас, this.пределы);
      if (решение.вид === "предел") throw this.отказЧастоты(решение.минут);
      if (решение.вид === "ждать") return { phone: shown, retryAfterSeconds: решение.секунд };
      this.неизвестные.отметить(phone, сейчас);
      return { phone: shown, retryAfterSeconds: паузаСекунд };
    }

    const выдача = await this.prisma.$transaction(async (tx) => {
      /* Подсчёт и выдача — под блокировкой строки человека. Без неё залп
         параллельных запросов читал один и тот же счёт и получал по коду
         каждый, а у каждого кода свои пять попыток: предел попыток
         умножался на размер залпа. Сырой запрос — шаблонной строкой. */
      await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
      const сейчас = new Date();
      /* Подсчёт — по индексу `[userId, purpose]`: строки кодов за сутки,
         погашенные и нет. Строки старше суток уборка удаляет (`token-sweep.service.ts`). */
      const выданы = await tx.authToken.findMany({
        where: {
          userId: user.id,
          purpose: AuthPurpose.SMS_CODE,
          createdAt: { gt: new Date(сейчас.getTime() - СУТКИ_МС) },
        },
        select: { createdAt: true },
      });
      const решение = решениеОКоде(выданы.map((строка) => строка.createdAt), сейчас, this.пределы);
      if (решение.вид !== "выдать") return решение;

      /* Действующий код не живёт рядом с новым: прежний гасится, и попытки
         всегда считаются против одного кода. */
      await tx.authToken.updateMany({
        where: { userId: user.id, purpose: AuthPurpose.SMS_CODE, usedAt: null },
        data: { usedAt: сейчас },
      });
      const code = newCode();
      await tx.authToken.create({
        data: {
          userId: user.id,
          tokenHash: codeHash(user.id, code),
          purpose: AuthPurpose.SMS_CODE,
          expiresAt: new Date(сейчас.getTime() + SMS_CODE_TTL_MS),
        },
      });
      return { вид: "выдан" as const, code };
    });

    if (выдача.вид === "предел") throw this.отказЧастоты(выдача.минут);
    // Действующий код не заменяется до паузы: иначе кнопка «отправить снова»
    // рассылает сообщения столько раз, сколько по ней нажали.
    if (выдача.вид === "ждать") return { phone: shown, retryAfterSeconds: выдача.секунд };
    // На стенде с флагом `AUTH_ECHO=1` код возвращается в теле и
    // показывается на экране. Без флага поле не приходит: код уходит
    // сообщением (`echo.ts`, П-28).
    const issued = { phone: shown, retryAfterSeconds: паузаСекунд };
    return echoesSecrets() ? { ...issued, code: выдача.code } : issued;
  }

  /** Отказ 429: текст — тот, что показывает экран входа (`limits.ts`). */
  private отказЧастоты(минут: number): HttpException {
    return new HttpException({ statusCode: HttpStatus.TOO_MANY_REQUESTS, message: текстПредела(минут) },
      HttpStatus.TOO_MANY_REQUESTS);
  }

  /** Обменивает код на сессию. Считает попытки: код короткий. */
  async confirmSmsCode(rawPhone: string, code: string): Promise<{ sessionToken: string; expiresAt: Date }> {
    const phone = this.normalizePhone(rawPhone);
    const invalid = new UnauthorizedException({
      message: "Код не подошёл. Проверьте цифры или запросите новый.",
    });

    const user = await this.prisma.user.findFirst({ where: { phone, revokedAt: null } });
    if (!user) throw invalid;
    const record = await this.liveCode(user.id);
    if (!record) throw invalid;

    /* Попытка занимается до сравнения, одним условным обновлением. Прежде
       счётчик читался, сравнивался и прибавлялся тремя шагами, и сорок
       параллельных неверных кодов сверялись все сорок: предел в пять
       попыток держался только для того, кто ждёт ответа (полный аудит
       30.09.2026, П-24). Условие в запросе к базе исполняется атомарно:
       шестой запрос не находит строки и сравнения не получает. */
    const занята = await this.prisma.authToken.updateMany({
      where: { id: record.id, usedAt: null, attempts: { lt: SMS_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (занята.count === 0) {
      await this.prisma.authToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      throw new UnauthorizedException({
        message: "Код заблокирован после пяти неверных попыток. Запросите новый.",
      });
    }

    const expected = Buffer.from(record.tokenHash);
    const given = Buffer.from(codeHash(user.id, code));
    // Хеши равной длины, сравнение постоянного времени: утечки по времени нет.
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw invalid;

    /* Гасится тем же условным обновлением: два параллельных верных кода не
       открывают двух сессий. */
    const погашен = await this.prisma.authToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (погашен.count === 0) throw invalid;
    return this.openSession(user.id);
  }

  /** Действующий непогашенный код пользователя, если он есть. */
  private liveCode(userId: string) {
    return this.prisma.authToken.findFirst({
      where: {
        userId,
        purpose: AuthPurpose.SMS_CODE,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Правила номера живут в доменном слое одним экземпляром. Отказ приходит
   * значением и превращается здесь в ответ 400 с той же формулировкой,
   * которую увидит человек: раздел 6 норматива запрещает обтекаемые тексты.
   */
  private normalizePhone(rawPhone: string): PhoneNumber {
    const parsed = parsePhone(rawPhone);
    if (!parsed.ok) throw new BadRequestException({ message: parsed.message });
    return parsed.value;
  }

  /** Разрешает сессионный ключ в пользователя с его организацией. */
  async resolveSession(sessionToken: string): Promise<RequestUser | null> {
    const digest = hash(sessionToken);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: digest },
      include: { user: { include: { organization: true } } },
    });
    if (!session || session.expiresAt < new Date()) return null;
    if (session.user.revokedAt !== null) return null;
    // Сравнение постоянного времени: хеши равной длины, утечки по времени нет.
    if (!timingSafeEqual(Buffer.from(session.tokenHash), Buffer.from(digest))) return null;

    return {
      id: session.user.id,
      role: session.user.role,
      name: session.user.name,
      orgId: session.user.orgId,
      orgName: session.user.organization.name,
      clientId: session.user.clientId,
    };
  }

  async revokeSession(sessionToken: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tokenHash: hash(sessionToken) } });
  }
}
