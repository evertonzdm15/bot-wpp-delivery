import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { canonicalBrazil } from "../src/utils/phone";

const prisma = new PrismaClient();

async function main() {
  // ---- Super Admin ----
  const saPhone = canonicalBrazil(process.env.SUPER_ADMIN_PHONE ?? "");
  if (saPhone) {
    const user = await prisma.user.upsert({
      where: { phone: saPhone },
      update: { accessCode: "9000" },
      create: { phone: saPhone, name: "Super Admin", accessCode: "9000" },
    });
    const exists = await prisma.userRole.findFirst({ where: { userId: user.id, role: "SUPER_ADMIN" } });
    if (!exists) await prisma.userRole.create({ data: { userId: user.id, role: "SUPER_ADMIN" } });
    console.log(`Super Admin garantido para ${saPhone} (código 9000).`);
  } else {
    console.log("SUPER_ADMIN_PHONE não definido — pulando Super Admin.");
  }

  // ---- Tenant de demonstração ----
  let admin = await prisma.admin.findFirst({ where: { name: "Operação Demo" } });
  if (!admin) {
    admin = await prisma.admin.create({ data: { name: "Operação Demo", accessCode: "2000" } });
    console.log('Admin "Operação Demo" criado (código 2000).');
  }

  let branch = await prisma.branch.findFirst({ where: { adminId: admin.id, name: "Matriz" } });
  if (!branch) {
    branch = await prisma.branch.create({
      data: { adminId: admin.id, name: "Matriz", accessCode: "1010" },
    });
    console.log('Filial "Matriz" criada (código 1010).');
  }

  // ---- Tipos de entrega da Matriz ----
  const typeDefs = [
    { name: "Rápida R6", slaMin: 40, scheduled: false },
    { name: "Rápida", slaMin: 90, scheduled: false },
    { name: "Programada", slaMin: null as number | null, scheduled: true },
  ];
  for (const td of typeDefs) {
    const found = await prisma.deliveryType.findFirst({
      where: { branchId: branch.id, name: td.name },
    });
    if (!found) {
      await prisma.deliveryType.create({
        data: { branchId: branch.id, adminId: admin.id, ...td },
      });
    }
  }
  console.log("Tipos de entrega da Matriz garantidos (Rápida R6 / Rápida / Programada).");

  // ---- Motoboy de demonstração com valores ----
  const mbPhone = canonicalBrazil("5541999990000");
  const mb = await prisma.user.upsert({
    where: { phone: mbPhone },
    update: { name: "Motoboy Demo", accessCode: "3000", defaultRateCents: 500 },
    create: { phone: mbPhone, name: "Motoboy Demo", accessCode: "3000", defaultRateCents: 500 },
  });
  const hasRole = await prisma.userRole.findFirst({
    where: { userId: mb.id, role: "MOTOBOY", adminId: admin.id },
  });
  if (!hasRole) await prisma.userRole.create({ data: { userId: mb.id, role: "MOTOBOY", adminId: admin.id } });

  const types = await prisma.deliveryType.findMany({ where: { branchId: branch.id } });
  for (const t of types) {
    const rate = await prisma.motoboyRate.findFirst({
      where: { motoboyId: mb.id, deliveryTypeId: t.id, isTR: false },
    });
    if (!rate) {
      const value = t.name === "Rápida R6" ? 800 : t.name === "Rápida" ? 600 : 700;
      await prisma.motoboyRate.create({
        data: { motoboyId: mb.id, deliveryTypeId: t.id, valueCents: value },
      });
    }
  }
  const trRate = await prisma.motoboyRate.findFirst({ where: { motoboyId: mb.id, isTR: true } });
  if (!trRate) {
    await prisma.motoboyRate.create({ data: { motoboyId: mb.id, isTR: true, valueCents: 300 } });
  }
  console.log(`Motoboy Demo garantido (${mbPhone}, código 3000) com valores por tipo + TR.`);

  console.log("\n✅ Seed concluído.\nCódigos: teste=1234 (4 perfis) · Admin=2000 · Filial=1010 · Motoboy=3000 · SuperAdmin=9000");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
