import { db } from "../db.js";
import type { Tool } from "./types.js";

const insertFact = db.prepare(
  `INSERT INTO facts (user_id, subject, fact, created_at) VALUES (?, ?, ?, ?)`
);

const listFacts = db.prepare<[number, string]>(
  `SELECT fact FROM facts WHERE user_id = ? AND subject = ? ORDER BY created_at DESC LIMIT 20`
);

export const rememberTool: Tool = {
  definition: {
    name: "remember",
    description:
      "Save a durable fact about a person, client, project, or preference so you can recall it in future sessions. " +
      "Use this whenever the user tells you something worth remembering long-term (names, preferences, project details, dates).",
    input_schema: {
      type: "object",
      properties: {
        subject: {
          type: "string",
          description: "Who or what the fact is about (e.g. 'client:Acme Corp', 'user', 'project:website-redesign').",
        },
        fact: {
          type: "string",
          description: "The fact to remember, written as a complete sentence.",
        },
      },
      required: ["subject", "fact"],
    },
  },
  async execute(input, ctx) {
    const { subject, fact } = input as { subject: string; fact: string };
    insertFact.run(ctx.userId, subject, fact, Date.now());
    return `Saved fact about "${subject}".`;
  },
};

export function recallFacts(userId: number, subject: string): string[] {
  return (listFacts.all(userId, subject) as { fact: string }[]).map((r) => r.fact);
}
