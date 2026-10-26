import { PrismaClient, Role, SubscriptionStatus } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// The Rust-free client (queryCompiler) has no built-in engine, so it must be
// given a driver adapter even here.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed.");
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main(): Promise<void> {
  const email = process.env.SUPER_ADMIN_EMAIL;
  if (!email) {
    throw new Error("SUPER_ADMIN_EMAIL is required to seed the SuperAdmin.");
  }

  const tenant = await prisma.tenant.upsert({
    where: { id: "founder" },
    update: {},
    create: {
      id: "founder",
      name: "Robert Lynch — Founder",
      ownerEmail: email,
      subscriptionStatus: SubscriptionStatus.COMP,
    },
  });

  const telegramIds = (process.env.ALLOWED_TELEGRAM_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const firstTelegramId = telegramIds[0];

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      role: Role.SUPER_ADMIN,
      tenantId: tenant.id,
      telegramUserId: firstTelegramId ?? undefined,
    },
    create: {
      email,
      role: Role.SUPER_ADMIN,
      tenantId: tenant.id,
      telegramUserId: firstTelegramId,
    },
  });

  await prisma.platformSetting.upsert({
    where: { key: "ads_cayworks" },
    update: {},
    create: {
      key: "ads_cayworks",
      value: {
        enabled: process.env.ADS_CAYWORKS_ENABLED === "true",
        webhookUrl: process.env.ADS_CAYWORKS_WEBHOOK_URL ?? "",
      },
    },
  });

  await prisma.platformSetting.upsert({
    where: { key: "feature_flags" },
    update: {},
    create: {
      key: "feature_flags",
      value: {
        gmail: false,
        calendar: false,
        sms: false,
        whatsapp: false,
        stripe: false,
      },
    },
  });

  console.log("Seeded:");
  console.log("  Tenant:", tenant.id, "—", tenant.name);
  console.log("  SuperAdmin:", user.email, "(role=" + user.role + ")");
  if (firstTelegramId) {
    console.log("  Linked Telegram ID:", firstTelegramId);
  } else {
    console.log("  No Telegram ID linked yet (set ALLOWED_TELEGRAM_USER_IDS).");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
