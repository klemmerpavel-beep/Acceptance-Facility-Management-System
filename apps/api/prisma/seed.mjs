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

// Объект без назначенного прораба: на нём проверяется, что прораб его не видит.
await prisma.project.upsert({
  where: { orgId_code: { orgId: org.id, code: "R-42" } },
  update: {},
  create: {
    orgId: org.id,
    code: "R-42",
    address: "Плехановская 22",
    clientId: client.id,
    status: ProjectStatus.NEW,
    keysCount: 0,
  },
});

for (const name of ["Фархат", "Рашид", "Евгений", "Сергей"]) {
  await prisma.worker.upsert({
    where: { orgId_name: { orgId: org.id, name } },
    update: {},
    create: { orgId: org.id, name, kind: WorkerKind.BRIGADE },
  });
}

console.log("Стенд наполнен:", { owner: owner.email, foreman: foreman.email });
await prisma.$disconnect();
