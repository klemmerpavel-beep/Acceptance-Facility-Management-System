import { afterEach, describe, expect, it, vi } from "vitest";
import { assertEchoAllowed, echoesSecrets } from "./echo";

/**
 * Эхо кода входа (полный аудит 30.09.2026, П-28; решение от 01.10.2026).
 * Свойства: эхо включается только явным `AUTH_ECHO=1` — режим запуска его
 * не включает; флаг в промышленном режиме останавливает запуск.
 */
describe("эхо кода входа", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("без флага эха нет — в каком бы режиме ни шёл запуск", () => {
    vi.stubEnv("AUTH_ECHO", "");
    for (const режим of ["development", "test", "production", ""]) {
      vi.stubEnv("NODE_ENV", режим);
      expect(echoesSecrets()).toBe(false);
    }
  });

  it("эхо включает только значение «1», а не всякое непустое", () => {
    for (const значение of ["true", "yes", "0", " 1"]) {
      vi.stubEnv("AUTH_ECHO", значение);
      expect(echoesSecrets()).toBe(false);
    }
    vi.stubEnv("AUTH_ECHO", "1");
    expect(echoesSecrets()).toBe(true);
  });

  it("флаг стенда в промышленном режиме останавливает запуск", () => {
    vi.stubEnv("AUTH_ECHO", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => { assertEchoAllowed(); }).toThrow(/AUTH_ECHO=1 при NODE_ENV=production/u);
  });

  it("стенд с флагом и промышленный режим без флага запускаются", () => {
    vi.stubEnv("AUTH_ECHO", "1");
    vi.stubEnv("NODE_ENV", "development");
    expect(() => { assertEchoAllowed(); }).not.toThrow();
    vi.stubEnv("AUTH_ECHO", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => { assertEchoAllowed(); }).not.toThrow();
  });
});
