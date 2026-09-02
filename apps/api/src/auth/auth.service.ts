import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthPurpose } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import type { RequestUser } from "../common/current-user";

/** Магическая ссылка руководителя живёт минуты: она приходит на почту. */
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
/** Персональная ссылка прораба живёт долго: он не вводит ничего вообще. */
const FOREMAN_LINK_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const hash = (token: string): string => createHash("sha256").update(token).digest("hex");
const newToken = (): string => randomBytes(32).toString("base64url");

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
    if (record.purpose === AuthPurpose.MAGIC_LINK && record.usedAt) throw invalid;

    if (record.purpose === AuthPurpose.MAGIC_LINK) {
      await this.prisma.authToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
    }

    const sessionToken = newToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.session.create({
      data: { userId: record.userId, tokenHash: hash(sessionToken), expiresAt },
    });
    return { sessionToken, expiresAt };
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
