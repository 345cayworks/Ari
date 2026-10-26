import { prisma } from "@/lib/db";
import type { Tool } from "./types";

export const rememberTool: Tool = {
  definition: {
    name: "remember",
    description:
      "Save a durable fact about a person, client, project, or preference. " +
      "Use whenever the user shares information worth keeping long-term " +
      "(names, preferences, project details, deadlines, contacts).",
    input_schema: {
      type: "object",
      properties: {
        subject: {
          type: "string",
          description:
            "Who or what the fact is about. Use prefixes like 'client:Acme', 'user', 'project:website'.",
        },
        fact: {
          type: "string",
          description: "The fact, written as a complete sentence.",
        },
      },
      required: ["subject", "fact"],
    },
  },
  async execute(input, ctx) {
    const { subject, fact } = input as { subject: string; fact: string };

    // The same fact arriving twice is a re-save, not new knowledge. Without
    // this a subject slowly fills with near-identical entries, which then all
    // get loaded back into every prompt.
    const existing = await prisma.fact.findFirst({
      where: {
        tenantId: ctx.tenantId,
        subject,
        fact: { equals: fact, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (existing) return `Already knew that about "${subject}" — nothing to change.`;

    await prisma.fact.create({
      data: { tenantId: ctx.tenantId, subject, fact },
    });
    return `Saved fact about "${subject}".`;
  },
};
