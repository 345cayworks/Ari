import { config } from "./config.js";

const allowed = new Set(config.ALLOWED_TELEGRAM_USER_IDS);

export function isAllowed(userId: number | undefined): boolean {
  return userId !== undefined && allowed.has(userId);
}
