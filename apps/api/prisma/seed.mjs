/**
 * Наполнение стенда обезличенными данными.
 *
 * Реальные данные клиента-физлица в репозиторий не попадают: адрес объекта
 * сохранён как рабочий ориентир, имя клиента заменено кодом, телефонов нет.
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
  update: {},
  create: { orgId: org.id, role: Role.OWNER, name: "Руководитель", email: "owner@dolgiy.studio" },
});

const foreman = await prisma.user.upsert({
  where: { orgId_email: { orgId: org.id, email: "foreman@dolgiy.studio" } },
  update: {},
  create: { orgId: org.id, role: Role.FOREMAN, name: "Прораб", email: "foreman@dolgiy.studio" },
});

const client = await prisma.client.upsert({
  where: { orgId_code: { orgId: org.id, code: "300" } },
  update: {},
  create: { orgId: org.id, code: "300", name: "Клиент 300", isCompany: false },
});

await prisma.project.upsert({
  where: { orgId_code: { orgId: org.id, code: "R-99" } },
  update: {},
  create: {
    orgId: org.id,
    code: "R-99",
    address: "Московский проспект 116",
    clientId: client.id,
    foremanId: foreman.id,
    status: ProjectStatus.IN_PROGRESS,
    deadline: new Date("2026-08-15"),
    keysCount: 2,
    supervisionShare: 1200,
  },
});

// Объекты без назначенного прораба: на них проверяется, что прораб их не
// видит. Разные статусы и сроки — чтобы список отражал реальный портфель
// в три-пять объектов, а не одну строку.
const другие = [
  { code: "R-42", address: "Плехановская 22", status: ProjectStatus.NEW, keys: 0, deadline: null },
  { code: "R-31", address: "Кольцовская 24б, кв. 118", status: ProjectStatus.IN_PROGRESS, keys: 1, deadline: "2026-11-30" },
  { code: "R-27", address: "Ленинский проспект 174п", status: ProjectStatus.WAITING_CLIENT, keys: 2, deadline: "2026-10-15" },
  { code: "R-19", address: "Революции 9а, офис 3", status: ProjectStatus.DONE, keys: 0, deadline: "2026-06-01" },
];

for (const объект of другие) {
  await prisma.project.upsert({
    where: { orgId_code: { orgId: org.id, code: объект.code } },
    update: {},
    create: {
      orgId: org.id,
      code: объект.code,
      address: объект.address,
      clientId: client.id,
      status: объект.status,
      keysCount: объект.keys,
      ...(объект.deadline === null ? {} : { deadline: new Date(объект.deadline) }),
    },
  });
}

for (const name of ["Фархат", "Рашид", "Евгений", "Сергей"]) {
  await prisma.worker.upsert({
    where: { orgId_name: { orgId: org.id, name } },
    update: {},
    create: { orgId: org.id, name, kind: WorkerKind.BRIGADE },
  });
}

console.log("Стенд наполнен:", { owner: owner.email, foreman: foreman.email });
await prisma.$disconnect();
