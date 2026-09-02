/**
 * Наполнение стенда обезличенными данными.
 *
 * Реальные данные клиента-физлица в репозиторий не попадают: адреса
 * сохранены как рабочие ориентиры, заказчики обозначены кодами, телефонов
 * и договоров нет. Портфель из восьми объектов в разных статусах — чтобы
 * сводка и список показывали работу студии, а не одну строку.
 */
import { PrismaClient, Role, ProjectStatus, WorkerKind } from "@prisma/client";

const prisma = new PrismaClient();

const org = await prisma.organization.upsert({
  where: { id: "00000000-0000-4000-8000-000000000001" },
  update: {},
  create: { id: "00000000-0000-4000-8000-000000000001", name: "DOLGIY STUDIO" },
});

const owner = await prisma.user.upsert({
  where: { orgId_email: { orgId: org.id, email: "owner@dolgiy.studio" } },
  update: { name: "Руководитель студии" },
  create: { orgId: org.id, role: Role.OWNER, name: "Руководитель студии", email: "owner@dolgiy.studio" },
});

const foreman = await prisma.user.upsert({
  where: { orgId_email: { orgId: org.id, email: "foreman@dolgiy.studio" } },
  update: { name: "Прораб участка" },
  create: { orgId: org.id, role: Role.FOREMAN, name: "Прораб участка", email: "foreman@dolgiy.studio" },
});

const заказчики = [
  { code: "300", name: "Клиент 300", isCompany: false, requisites: "Физическое лицо" },
  { code: "118", name: "Клиент 118", isCompany: false, requisites: "Физическое лицо" },
  { code: "204", name: "Заказчик 204", isCompany: true, requisites: "Юридическое лицо, ИНН обезличен" },
  { code: "412", name: "Клиент 412", isCompany: false, requisites: "Физическое лицо" },
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

for (const name of ["Фархат", "Рашид", "Евгений", "Сергей"]) {
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
