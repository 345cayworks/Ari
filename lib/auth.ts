import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { Role } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      tenantId: string | null;
    } & DefaultSession["user"];
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  pages: { signIn: "/admin/login" },
  providers: [
    Credentials({
      name: "Master Key",
      credentials: {
        email: { label: "Email", type: "email" },
        masterKey: { label: "Master Key", type: "password" },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").toLowerCase().trim();
        const masterKey = String(credentials?.masterKey ?? "");

        const expectedEmail = (process.env.SUPER_ADMIN_EMAIL ?? "")
          .toLowerCase()
          .trim();
        const expectedKey = process.env.SUPERADMIN_MASTER_KEY ?? "";

        if (!email || !masterKey) return null;
        if (email !== expectedEmail) return null;
        if (masterKey !== expectedKey) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? user.email,
          role: user.role,
          tenantId: user.tenantId,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as { id: string }).id;
        token.role = (user as { role: Role }).role;
        token.tenantId = (user as { tenantId: string | null }).tenantId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
        session.user.tenantId = token.tenantId as string | null;
      }
      return session;
    },
  },
});

export async function requireSuperAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== Role.SUPER_ADMIN) {
    return null;
  }
  return session;
}

export async function requireAdmin() {
  const session = await auth();
  if (
    !session?.user ||
    (session.user.role !== Role.SUPER_ADMIN && session.user.role !== Role.ADMIN)
  ) {
    return null;
  }
  return session;
}
