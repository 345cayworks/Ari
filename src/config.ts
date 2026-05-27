import { z } from "zod";

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  GROQ_API_KEY: z.string().optional(),
  ALLOWED_TELEGRAM_USER_IDS: z
    .string()
    .min(1, "ALLOWED_TELEGRAM_USER_IDS is required")
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => Number(x))
    )
    .refine((arr) => arr.every((n) => Number.isFinite(n)), {
      message: "ALLOWED_TELEGRAM_USER_IDS must be comma-separated numeric IDs",
    }),
  USER_NAME: z.string().optional(),
  ARI_MODEL: z.string().default("claude-sonnet-4-6"),
  ARI_FAST_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  DB_PATH: z.string().default("./data/ari.db"),
  TELEGRAM_MODE: z.enum(["polling", "webhook"]).default("polling"),
  PUBLIC_URL: z.string().optional(),
  PORT: z.coerce.number().default(8080),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = parsed.data;
