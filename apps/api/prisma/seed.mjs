/**
 * Наполнение стенда вымышленными данными.
 *
 * ВСЕ ИМЕНА ЗДЕСЬ ПРИДУМАНЫ. Ни заказчиков, ни сотрудников, ни бригад с
 * такими именами у студии нет; совпадение с настоящим человеком было бы
 * случайным. Реальные данные клиента-физлица в репозиторий не попадают:
 * договоров и телефонов заказчиков нет вовсе, адреса оставлены рабочими
 * ориентирами Воронежа.
 *
 * Имена, а не коды, стоят намеренно. «Клиент 300» и «Заказчик 204» ничего
 * не говорят человеку, который смотрит на экран: список из четырёх строк с
 * номерами читается как выгрузка из базы, а не как портфель студии. По той
 * же причине названы прораб и бригады.
 *
 * Портфель из восьми объектов в разных статусах — чтобы сводка и список
 * показывали работу студии, а не одну строку.
 */
import { PrismaClient, Role, ProjectStatus, WorkerKind } from "@prisma/client";

const prisma = new PrismaClient();

const карточкаОрганизации = {
  name: "DOLGIY STUDIO",
  timeZone: "Europe/Moscow",
  phone: "+79000000001",
  email: "studio@dolgiy.studio",
};

const org = await prisma.organization.upsert({
  where: { id: "00000000-0000-4000-8000-000000000001" },
  update: карточкаОрганизации,
  create: { id: "00000000-0000-4000-8000-000000000001", ...карточкаОрганизации },
});

/**
 * Номер для входа на стенде. Он вымышленный, как и всё прочее наполнение:
 * настоящих номеров в репозитории нет. Прорабу номер не заводится — он
 * входит персональной ссылкой, без номера и кода (решение № 1 объёма).
 */
// Имя руководителя на стенде намеренно не выводится из названия студии:
// фамилия, похожая на «DOLGIY», указывала бы на конкретного человека, а
// наполнение обязано оставаться вымышленным.
const owner = await prisma.user.upsert({
  where: { orgId_email: { orgId: org.id, email: "owner@dolgiy.studio" } },
  update: { name: "Роман Дементьев", phone: "+79000000000" },
  create: {
    orgId: org.id, role: Role.OWNER, name: "Роман Дементьев",
    email: "owner@dolgiy.studio", phone: "+79000000000",
  },
});

const foreman = await prisma.user.upsert({
  where: { orgId_email: { orgId: org.id, email: "foreman@dolgiy.studio" } },
  update: { name: "Фархат Юсупов" },
  create: { orgId: org.id, role: Role.FOREMAN, name: "Фархат Юсупов", email: "foreman@dolgiy.studio" },
});

const заказчики = [
  { code: "300", name: "Ирина Ковалёва", isCompany: false, requisites: "Физическое лицо" },
  { code: "118", name: "Сергей Балашов", isCompany: false, requisites: "Физическое лицо" },
  { code: "204", name: "ООО «Гранит-Строй»", isCompany: true, requisites: "Юридическое лицо, ИНН обезличен" },
  { code: "412", name: "Анна Мещерякова", isCompany: false, requisites: "Физическое лицо" },
];

const clients = new Map();
for (const заказчик of заказчики) {
  const row = await prisma.client.upsert({
    where: { orgId_code: { orgId: org.id, code: заказчик.code } },
    update: { name: заказчик.name, isCompany: заказчик.isCompany, requisites: заказчик.requisites },
    create: { orgId: org.id, ...заказчик },
  });
  clients.set(заказчик.code, row.id);
}

/**
 * Портфель. R-99 — объект действующей сметы: на нём проверяются импорт,
 * разграничение по ролям и все расчёты. Прораб назначен на два объекта:
 * список из одной строки не показал бы, что видимость вообще работает.
 */
const объекты = [
  {
    code: "R-99", address: "Московский проспект 116", client: "300", foreman: true,
    status: ProjectStatus.IN_PROGRESS, started: "2026-03-02", deadline: "2026-08-15",
    keys: 2, share: 1200,
  },
  {
    code: "R-72", address: "Никитинская 42, кв. 7", client: "118", foreman: true,
    status: ProjectStatus.IN_PROGRESS, started: "2026-06-15", deadline: "2026-09-12",
    keys: 1, share: 1200,
  },
  {
    code: "R-64", address: "Бульвар Победы 23б, кв. 204", client: "204", foreman: false,
    status: ProjectStatus.IN_PROGRESS, started: "2026-07-01", deadline: "2026-12-20",
    keys: 2, share: 1500,
  },
  {
    code: "R-42", address: "Плехановская 22", client: "412", foreman: false,
    status: ProjectStatus.NEW, started: null, deadline: null, keys: 0, share: 1200,
  },
  {
    code: "R-38", address: "Владимира Невского 15, кв. 61", client: "118", foreman: false,
    status: ProjectStatus.NEW, started: null, deadline: "2026-09-04", keys: 0, share: 1200,
  },
  {
    code: "R-31", address: "Кольцовская 24б, кв. 118", client: "300", foreman: false,
    status: ProjectStatus.IN_PROGRESS, started: "2026-05-12", deadline: "2026-11-30",
    keys: 1, share: 1200,
  },
  {
    code: "R-27", address: "Ленинский проспект 174п", client: "204", foreman: false,
    status: ProjectStatus.WAITING_CLIENT, started: "2026-04-20", deadline: "2026-10-15",
    keys: 2, share: 1200,
  },
  {
    code: "R-19", address: "Революции 9а, офис 3", client: "412", foreman: false,
    status: ProjectStatus.DONE, started: "2025-11-10", deadline: "2026-06-01",
    keys: 0, share: 1200,
  },
];

for (const объект of объекты) {
  const данные = {
    address: объект.address,
    clientId: clients.get(объект.client),
    status: объект.status,
    keysCount: объект.keys,
    supervisionShare: объект.share,
    startedAt: объект.started === null ? null : new Date(объект.started),
    deadline: объект.deadline === null ? null : new Date(объект.deadline),
    foremanId: объект.foreman ? foreman.id : null,
  };
  await prisma.project.upsert({
    where: { orgId_code: { orgId: org.id, code: объект.code } },
    update: данные,
    create: { orgId: org.id, code: объект.code, ...данные },
  });
}

/**
 * Бригады. Начисление адресуется бригаде через бригадира, поэтому в
 * справочнике стоит бригада, а не человек: «бригада Фархата», а не
 * «Фархат». Состав бригады система не хранит — решение допроса.
 */
const бригады = [
  "Бригада Фархата",
  "Бригада Рашида",
  "Электрики Евгения",
  "Плиточники Алексея",
];
for (const name of бригады) {
  await prisma.worker.upsert({
    where: { orgId_name: { orgId: org.id, name } },
    update: {},
    create: { orgId: org.id, name, kind: WorkerKind.BRIGADE },
  });
}

console.log("Стенд наполнен:", {
  owner: owner.email,
  foreman: foreman.email,
  объектов: объекты.length,
  заказчиков: заказчики.length,
});
await prisma.$disconnect();
