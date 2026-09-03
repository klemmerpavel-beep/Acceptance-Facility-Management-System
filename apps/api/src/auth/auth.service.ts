import { randomBytes, createHash, randomInt, timingSafeEqual } from "node:crypto";
import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthPurpose } from "@prisma/client";
import { formatPhone, parsePhone, type PhoneNumber } from "@priyomka/domain";
import { PrismaService } from "../prisma.service";
import type { RequestUser } from "../common/current-user";

/** Магическая ссылка руководителя живёт минуты: она приходит на почту. */
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
/** Персональная ссылка прораба живёт долго: он не вводит ничего вообще. */
const FOREMAN_LINK_TTL_MS = 180 * 24 * 60 * 60 * 1000;
/** Код подтверждения живёт пять минут: дольше он живёт в чужих руках. */
const SMS_CODE_TTL_MS = 5 * 60 * 1000;
/** Повторная отправка не чаще раза в минуту: иначе форма рассылает сообщения. */
const SMS_RESEND_MS = 60 * 1000;
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
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Создаёт одноразовую ссылку входа. Возвращает сам токен — его отправляет
   * почтовый отправитель. В базе хранится только хеш: утечка таблицы
   * не даёт войти.
   */
  async issueLink(email: string): Promise<{ token: string } | null> {
    const user = await this.prisma.user.findFirst({ where: { email } });
    // Ответ не различает «нет такого адреса» и «ссылка отправлена»:
    // иначе форма входа становится проверялкой существования адресов.
    if (!user) return null;
    return this.createToken(user.id, AuthPurpose.MAGIC_LINK, MAGIC_LINK_TTL_MS);
  }

  /** Персональная ссылка прораба. Выдаёт руководитель. */
  async issueForemanLink(userId: string): Promise<{ token: string }> {
    return this.createToken(userId, AuthPurpose.FOREMAN_LINK, FOREMAN_LINK_TTL_MS);
  }

  private async createToken(userId: string, purpose: AuthPurpose, ttlMs: number) {
    const token = newToken();
    await this.prisma.authToken.create({
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
    });
    const invalid = new UnauthorizedException({
      message: "Ссылка входа недействительна или истекла. Запросите новую.",
    });
    if (!record || record.expiresAt < new Date()) throw invalid;
    // Код подтверждения обменивается своим маршрутом, где считаются попытки.
    if (record.purpose === AuthPurpose.SMS_CODE) throw invalid;
    if (record.purpose === AuthPurpose.MAGIC_LINK && record.usedAt) throw invalid;

    if (record.purpose === AuthPurpose.MAGIC_LINK) {
      await this.prisma.authToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
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
   */
  async issueSmsCode(rawPhone: string): Promise<{ phone: string; code?: string; retryAfterSeconds: number }> {
    const phone = this.normalizePhone(rawPhone);
    const shown = formatPhone(phone);
    const user = await this.prisma.user.findFirst({ where: { phone } });
    if (!user) return { phone: shown, retryAfterSeconds: SMS_RESEND_MS / 1000 };

    const live = await this.liveCode(user.id);
    if (live) {
      const waited = Date.now() - live.createdAt.getTime();
      // Действующий код не заменяется: иначе кнопка «отправить снова»
      // рассылает сообщения столько раз, сколько по ней нажали.
      if (waited < SMS_RESEND_MS) {
        return { phone: shown, retryAfterSeconds: Math.ceil((SMS_RESEND_MS - waited) / 1000) };
      }
      await this.prisma.authToken.update({ where: { id: live.id }, data: { usedAt: new Date() } });
    }

    const code = newCode();
    await this.prisma.authToken.create({
      data: {
        userId: user.id,
        tokenHash: codeHash(user.id, code),
        purpose: AuthPurpose.SMS_CODE,
        expiresAt: new Date(Date.now() + SMS_CODE_TTL_MS),
      },
    });
    // На стенде код возвращается в теле и показывается на экране. В
    // промышленной среде поле не приходит: код уходит сообщением.
    const issued = { phone: shown, retryAfterSeconds: SMS_RESEND_MS / 1000 };
    return process.env.NODE_ENV === "production" ? issued : { ...issued, code };
  }

  /** Обменивает код на сессию. Считает попытки: код короткий. */
  async confirmSmsCode(rawPhone: string, code: string): Promise<{ sessionToken: string; expiresAt: Date }> {
    const phone = this.normalizePhone(rawPhone);
    const invalid = new UnauthorizedException({
      message: "Код не подошёл. Проверьте цифры или запросите новый.",
    });

    const user = await this.prisma.user.findFirst({ where: { phone } });
    if (!user) throw invalid;
    const record = await this.liveCode(user.id);
    if (!record) throw invalid;

    if (record.attempts >= SMS_MAX_ATTEMPTS) {
      await this.prisma.authToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
      throw new UnauthorizedException({
        message: "Код заблокирован после пяти неверных попыток. Запросите новый.",
      });
    }

    const expected = Buffer.from(record.tokenHash);
    const given = Buffer.from(codeHash(user.id, code));
    // Хеши равной длины, сравнение постоянного времени: утечки по времени нет.
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      await this.prisma.authToken.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      throw invalid;
    }

    await this.prisma.authToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
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
    // Сравнение постоянного времени: хеши равной длины, утечки по времени нет.
    if (!timingSafeEqual(Buffer.from(session.tokenHash), Buffer.from(digest))) return null;

    return {
      id: session.user.id,
      role: session.user.role,
      name: session.user.name,
      orgId: session.user.orgId,
      orgName: session.user.organization.name,
    };
  }

  async revokeSession(sessionToken: string): Promise<void> {
    await this.prisma.session.deleteMany({ where: { tokenHash: hash(sessionToken) } });
  }
}
