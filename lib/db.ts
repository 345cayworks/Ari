import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getCloudflareContext } from "@opennextjs/cloudflare";

// On Cloudflare Workers a socket opened in one request can't be used by
// another, so each request gets its own client (keyed by its execution
// context). Through Hyperdrive when bound, which pools connections for us.
// On Node (next dev, scripts) one shared client is fine.

const isWorkerd =
  typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

function createClient(connectionString: string, perRequest: boolean): PrismaClient {
  const adapter = new PrismaPg(perRequest ? { connectionString, maxUses: 1 } : { connectionString });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

const perRequestClients = new WeakMap<object, PrismaClient>();

function workerClient(): PrismaClient {
  const { env, ctx } = getCloudflareContext();
  let client = perRequestClients.get(ctx);
  if (!client) {
    const hyperdrive = (env as { HYPERDRIVE?: { connectionString: string } }).HYPERDRIVE;
    const url = hyperdrive?.connectionString ?? process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL (or a HYPERDRIVE binding) is not set");
    client = createClient(url, true);
    perRequestClients.set(ctx, client);
  }
  return client;
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function nodeClient(): PrismaClient {
  globalForPrisma.prisma ??= createClient(process.env.DATABASE_URL ?? "", false);
  return globalForPrisma.prisma;
}

// Resolved on every property access, so `prisma.poll.findMany()` always
// uses the right client for the current request.
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = isWorkerd ? workerClient() : nodeClient();
    const value = Reflect.get(client, prop);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
