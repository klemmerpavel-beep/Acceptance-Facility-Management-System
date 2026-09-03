/**
 * Номер телефона: разбор ввода, нормализация, показ.
 *
 * Номер — ключ входа в систему, поэтому он обязан приводиться к одному
 * виду. Один и тот же человек напишет «+7 900 000-00-00», «8 900 0000000»
 * и «+7(900)000-00-00»; если хранить как введено, у него окажется три
 * учётные записи, а код подтверждения уйдёт не туда.
 *
 * Чистые функции: ни сети, ни базы, ни отправки сообщений. Отказ
 * возвращается значением, а не исключением: интерфейсу нужно показать, что
 * именно не так, а исключение по дороге превращается в «что-то пошло не
 * так» — формулировку, запрещённую разделом 6 норматива интерфейса.
 *
 * Область — Россия. Код страны один, и признавать чужие коды нельзя:
 * отправка на чужую сеть не входит в договор с оператором, а молча
 * подставить +7 к иностранному номеру значит отправить код неизвестному
 * абоненту.
 */

/** Номер в единственном хранимом виде: +7 и десять цифр. */
export type PhoneNumber = string & { readonly __brand: "PhoneNumber" };

/** Причина отказа. Каждой соответствует своё сообщение пользователю. */
export type PhoneRejection =
  | "empty"
  | "stray-characters"
  | "wrong-length"
  | "foreign-code"
  | "not-mobile";

export type PhoneParse =
  | { readonly ok: true; readonly value: PhoneNumber }
  | { readonly ok: false; readonly reason: PhoneRejection; readonly message: string };

/** Знаки, которыми люди разделяют номер. Значения не несут, отбрасываются. */
const SEPARATORS = new Set([
  " ", "\u00a0", "\u202f",           // пробел, неразрывный, узкий неразрывный
  "-", "\u2011", "\u2013", "\u2014", // дефис, неразрывный дефис, тире короткое и длинное
  "(", ")", ".", "/",
]);

const NATIONAL_LENGTH = 10;
/** Мобильные коды России — от 900 до 999. Код подтверждения идёт сообщением. */
const MOBILE_PREFIX = "9";

const MESSAGES: Record<PhoneRejection, string> = {
  "empty": "Введите номер телефона.",
  "stray-characters": "В номере есть посторонние знаки. Оставьте цифры, пробелы, скобки и дефисы.",
  "wrong-length": `В номере должно быть ${NATIONAL_LENGTH} цифр после кода страны: +7 9xx xxx-xx-xx.`,
  "foreign-code": "Система работает с номерами +7. Номер другой страны подключается отдельно.",
  "not-mobile": "Код подтверждения приходит сообщением, поэтому нужен мобильный номер — он начинается с девятки.",
};

const reject = (reason: PhoneRejection): PhoneParse =>
  ({ ok: false, reason, message: MESSAGES[reason] });

/**
 * Приводит введённый номер к виду `+79000000000`, требуя мобильный код.
 *
 * Принимается: с кодом страны и без, с восьмёркой вместо плюс семи, с
 * любыми разделителями. Плюс допустим только первым знаком: «7+9…» —
 * опечатка, а не номер.
 *
 * Применяется на входе: код подтверждения идёт сообщением, а на городской
 * номер сообщение не придёт.
 */
export function parsePhone(input: string): PhoneParse {
  return parse(input, { mobileOnly: true });
}

/**
 * То же приведение без требования мобильного кода.
 *
 * Контактный телефон организации печатается на счёте и договоре и вполне
 * может быть городским: требовать девятку значило бы запретить студии
 * указать свой номер. Вход по такому номеру всё равно невозможен —
 * там применяется `parsePhone`.
 */
export function parseContactPhone(input: string): PhoneParse {
  return parse(input, { mobileOnly: false });
}

function parse(input: string, options: { mobileOnly: boolean }): PhoneParse {
  const trimmed = input.trim();
  if (trimmed.length === 0) return reject("empty");

  let digits = "";
  for (const [index, character] of [...trimmed].entries()) {
    if (character >= "0" && character <= "9") { digits += character; continue; }
    if (character === "+") {
      if (index !== 0) return reject("stray-characters");
      continue;
    }
    if (!SEPARATORS.has(character)) return reject("stray-characters");
  }

  const explicitCode = trimmed.startsWith("+");
  let national: string;

  if (digits.length === NATIONAL_LENGTH && !explicitCode) {
    national = digits;
  } else if (digits.length === NATIONAL_LENGTH + 1) {
    const [code, ...rest] = digits;
    // Восьмёрка — междугородный префикс, в хранимом виде её нет.
    if (code === "7") national = rest.join("");
    else if (code === "8" && !explicitCode) national = rest.join("");
    else return reject(code === "8" ? "wrong-length" : "foreign-code");
  } else if (digits.length > NATIONAL_LENGTH + 1) {
    return digits.startsWith("7") ? reject("wrong-length") : reject("foreign-code");
  } else {
    return reject("wrong-length");
  }

  if (options.mobileOnly && !national.startsWith(MOBILE_PREFIX)) return reject("not-mobile");
  return { ok: true, value: `+7${national}` as PhoneNumber };
}

/** Уже нормализованный номер: `+7` и десять цифр. */
export function isPhoneNumber(value: string): value is PhoneNumber {
  return /^\+7\d{10}$/.test(value);
}

/** Нормализованный номер, на который дойдёт сообщение с кодом. */
export function isMobileNumber(value: string): value is PhoneNumber {
  return /^\+79\d{9}$/.test(value);
}

/**
 * Показ номера: `+7 (900) 000-00-00`. Пробелы внутри — неразрывные
 * (U+00A0), иначе номер рвётся переносом строки на середине.
 */
export function formatPhone(value: PhoneNumber): string {
  const d = value.slice(2);
  return `+7\u00a0(${d.slice(0, 3)})\u00a0${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8, 10)}`;
}

/**
 * Номер для показа рядом с полем кода: середина скрыта.
 * Полный номер в интерфейсе после отправки кода не нужен, а на общем
 * экране он лишний.
 */
export function maskPhone(value: PhoneNumber): string {
  const d = value.slice(2);
  return `+7\u00a0(${d.slice(0, 3)})\u00a0\u2022\u2022\u2022-\u2022\u2022-${d.slice(8, 10)}`;
}
