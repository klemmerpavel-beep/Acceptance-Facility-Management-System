import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * Статический анализ монорепозитория. Пункт плана 0.7.
 *
 * Расширение .mjs обязательно: в корневом package.json нет "type": "module",
 * и eslint.config.js был бы прочитан как CommonJS.
 *
 * Набор строгий и с учётом типов. Основание: TypeScript в проекте уже
 * настроен строго (exactOptionalPropertyTypes, noUncheckedIndexedAccess,
 * verbatimModuleSyntax), и линт слабее компилятора не имеет смысла.
 *
 * Правила под предметную область — в разделе «Деньги и оформление» ниже.
 * Они и есть содержание пункта 0.7; всё остальное здесь — обвязка, которая
 * позволяет им работать на разнородном дереве: сервер на CommonJS с
 * декораторами, клиент на ESM с JSX, библиотеки, тесты и узловые скрипты.
 */

/* ---------------------------------------------------------------------------
 * Деньги
 *
 * Правило 8 бизнес-правил: «все денежные величины хранятся в копейках целым
 * числом; float/double для денег запрещён на уровне ревью». Ревью — человек,
 * человек забывает. Ниже то же правило, но механическое.
 *
 * Запрет ставится по ИМЕНИ величины, а не по типу: тип `number` сам по себе
 * законен — им считаются позиции, дни, проценты в базисных пунктах. Незаконно
 * именно денежное имя при типе `number`.
 * ------------------------------------------------------------------------ */

/**
 * Имена денежных величин — только однозначные.
 *
 * Первая редакция перечня включала одиночные слова `total`, `sum`, `price`,
 * `amount`, `works`, `accepted`. Прогон показал, чем это плохо:
 * `PortfolioView.projects.total` — счётчик объектов, а не деньги, и правило
 * дало ложное срабатывание. Одно и то же слово в этом продукте значит и
 * сумму (`EstimateItem.total`), и количество (`projects.total`); по имени
 * их не различить.
 *
 * Поэтому перечень сведён к составным именам, у которых денежный смысл
 * заложен во второй части. Цена решения названа прямо: `total: Kopecks`
 * внутри позиции сметы правило не защищает — это остаётся на ревью и на
 * типах домена, где `Kopecks` и так не совместим с `number`.
 */
const MONEY = [
  "unitPrice", "unitWage", "wageTotal", "subtotalWage",
  "estimateTotal", "worksTotal", "computedWorksTotal", "declaredWorksTotal",
  "worksTotalDelta", "unitAmount", "totalAmount",
].join("|");

const MONEY_MESSAGE =
  "Денежная величина не может быть number. В домене это Kopecks (branded bigint), " +
  "в контракте — строка, в базе — BigInt. Бизнес-правило 8: деньги хранятся в " +
  "копейках целым числом, float и double запрещены.";

const moneyRules = [
  {
    selector: `TSPropertySignature[key.name=/^(${MONEY})$/] > TSTypeAnnotation > TSNumberKeyword`,
    message: MONEY_MESSAGE,
  },
  {
    selector: `PropertyDefinition[key.name=/^(${MONEY})$/] > TSTypeAnnotation > TSNumberKeyword`,
    message: MONEY_MESSAGE,
  },
  {
    selector: `VariableDeclarator[id.name=/^(${MONEY})$/] > Identifier > TSTypeAnnotation > TSNumberKeyword`,
    message: MONEY_MESSAGE,
  },
  {
    selector: `Identifier[name=/^(${MONEY})$/] > TSTypeAnnotation > TSNumberKeyword`,
    message: MONEY_MESSAGE,
  },
  {
    // Спутник ошибки: округление денег через плавающую точку.
    selector: `CallExpression[callee.property.name="toFixed"][callee.object.name=/^(${MONEY})$/]`,
    message: "toFixed на денежной величине означает, что она уже число с плавающей точкой. " + MONEY_MESSAGE,
  },
  {
    selector: `CallExpression[callee.name=/^(parseFloat|parseInt)$/] > Identifier[name=/^(${MONEY})$/]`,
    message: "Разбор денежной величины в число теряет точность. Используйте BigInt. " + MONEY_MESSAGE,
  },
];

/* ---------------------------------------------------------------------------
 * Оформление
 *
 * Значение мимо токена — дефект (норматив 03_DESIGN_SYSTEM.md, раздел 8).
 * Для CSS это уже проверяется тестом packages/ui/src/design-system.test.ts.
 * Здесь закрывается вторая дверь — модули: цвет, вписанный строкой в TSX,
 * тест дизайн-системы не видит.
 *
 * Запрет ставится на литеральное ЗНАЧЕНИЕ, а не на атрибут style целиком:
 * инлайновый стиль законен, когда подставляет вычисленную величину или
 * пользовательское свойство — так работают отступ вложенности раздела сметы
 * и заполнение шкалы готовности.
 * ------------------------------------------------------------------------ */

const COLOUR = String.raw`#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(`;

const styleRules = [
  {
    selector: `Literal[value=/${COLOUR}/]`,
    message:
      "Цветовой литерал в модуле. Цвет берётся из токена слоя стилей " +
      "(packages/ui/src/styles/tokens.css), а не вписывается в разметку.",
  },
  {
    selector: `TemplateElement[value.raw=/${COLOUR}/]`,
    message:
      "Цветовой литерал в шаблонной строке. Цвет берётся из токена слоя стилей.",
  },
  {
    // Размер в объекте инлайнового стиля: style={{ padding: "12px" }}.
    // Пользовательские свойства и проценты остаются разрешёнными.
    selector: 'JSXAttribute[name.name="style"] Property > Literal[value=/^-?\\d+(\\.\\d+)?(px|rem|em)$/]',
    message:
      "Размер литералом в инлайновом стиле. Отступы и размеры берутся из " +
      "токенов --space-*, --control-h, --tap-min через класс, а не из разметки.",
  },
];

/* ------------------------------------------------------------------------ */

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-demo/**",
      "**/coverage/**",
      // Собранные страницы и артборды — не исходный код.
      "design/**",
      // Каталог публикации: то же собранное, только под другим именем.
      "site/**",
      // Слепок стенда: данные, а не модуль.
      "apps/web/src/demo/**",
      "private/**",
    ],
  },

  js.configs.recommended,

  /* --- TypeScript с учётом типов ---------------------------------------- */
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        // Корневого tsconfig.json в проекте нет: у каждого пакета свой.
        // projectService находит ближайший к файлу.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-restricted-syntax": ["error", ...moneyRules, ...styleRules],
      /* Число и большое число в шаблонной строке — обычный способ собрать
         подпись: `${count} позиций`, `${days} дней`. Запрет дал бы три
         десятка замечаний и ни одной ошибки. Всё прочее — объекты, union
         с null, any — остаётся под запретом. */
      /* Сокращённая стрелка, возвращающая void, — обычный обработчик
         события: onClick={() => setTab("estimate")}. Правило опасается,
         что значение void утечёт туда, где ждут результат; у обработчика
         тип возврата и есть void, утекать некуда. Все 43 срабатывания на
         первом прогоне были этой формы, и переписывание их в фигурные
         скобки сделало бы разметку хуже, а не безопаснее. Остальные случаи
         правила — присваивание void, возврат из обычной функции — остаются
         под запретом. */
      "@typescript-eslint/no-confusing-void-expression": [
        "error",
        { ignoreArrowShorthand: true },
      ],
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: false, allowNullish: false, allowAny: false },
      ],
    },
  },

  /* --- Сервер ------------------------------------------------------------ */
  {
    files: ["apps/api/**/*.ts"],
    rules: {
      // Модуль NestJS — класс без членов; это устройство фреймворка.
      "@typescript-eslint/no-extraneous-class": "off",
    },
  },

  /* --- Разбор книги Excel ------------------------------------------------
   * Типы ExcelJS объявляют необязательное обязательным: `cell.font`,
   * `sheet.model.merges` и подобные поля по типу присутствуют всегда, а на
   * ячейке без оформления и на листе без объединений их нет. Проверка
   * `no-unnecessary-condition` верит типам и требует снять защиту, которая
   * в этом случае единственная. Снимаем проверку, а не защиту.
   * -------------------------------------------------------------------- */
  {
    files: ["packages/importer/**/*.ts"],
    rules: { "@typescript-eslint/no-unnecessary-condition": "off" },
  },

  /* --- Тесты -------------------------------------------------------------
   * В утверждении теста «здесь непременно есть значение» — часть проверки:
   * если его нет, тест обязан упасть, и падение по обращению к undefined
   * читается не хуже, чем падение по expect.
   * -------------------------------------------------------------------- */
  {
    files: ["**/*.test.ts"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },

  /* --- Клиент: правила хуков React --------------------------------------
   * В набор typescript-eslint они не входят, а ошибка в списке зависимостей
   * useEffect не ловится ни компилятором, ни тестами — только поведением на
   * экране. Единственная зависимость, введённая ради линта.
   * -------------------------------------------------------------------- */
  {
    files: ["apps/web/**/*.ts", "apps/web/**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },

  /* --- Узловые скрипты без TypeScript ------------------------------------ */
  {
    files: ["scripts/**/*.mjs", "apps/api/prisma/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: 2023,
      // Перечень вместо пакета `globals`: узловым скриптам нужен десяток
      // имён, и ради них не стоит заводить ещё одну зависимость.
      globals: {
        // Узел.
        process: "readonly", console: "readonly", fetch: "readonly",
        URL: "readonly", URLSearchParams: "readonly", Blob: "readonly",
        FormData: "readonly", Buffer: "readonly", TextEncoder: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly", structuredClone: "readonly",
        // Браузер: тело page.evaluate() исполняется на странице, а не в узле.
        document: "readonly", window: "readonly", getComputedStyle: "readonly",
        Node: "readonly", location: "readonly", sessionStorage: "readonly",
      },
    },
    rules: {
      "no-restricted-syntax": ["error", ...styleRules],
    },
  },
);
