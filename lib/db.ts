// Deliberately "@prisma/client/wasm", not "@prisma/client". OpenNext bundles
// the server with esbuild using platform "node" *and* the workerd condition,
// and esbuild honours whichever the package lists first — Prisma lists "node"
// first, so the plain entry point always resolves to the Node client, which
// reads its query compiler off a filesystem the Worker does not have. The
// /wasm subpath has no node/workerd branching, so it resolves to the WASM
// build and loads the compiler as a module import.
//
// The consequence, confirmed by running it: the WASM client does NOT work
// under Node. A query fails with "The loaded wasm module was unexpectedly
// `undefined` or `null` once loaded". So nothing that runs under Node may
// import this file — not `next dev`, and not a script. Anything server-side
// that needs the database outside the Worker must build its own client, the
// way prisma/seed.ts does:
//
//   new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
//
// imported from "@prisma/client", not "@prisma/client/wasm". That rules out
// testing lib/ari/brain.ts or lib/polling/calls.ts locally, since both reach
// the database through this module — exercise them on the Worker instead.
import { PrismaClient } from "@prisma/client/wasm";
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
