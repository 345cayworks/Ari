import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatRelative(date: Date | string | number): string {
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  const min = 60_000;
  const hr = 60 * min;
  const day = 24 * hr;

  if (diff < min) return "just now";
  if (diff < hr) return `${Math.floor(diff / min)}m ago`;
  if (diff < day) return `${Math.floor(diff / hr)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return d.toLocaleDateString();
}

/**
 * One CSV cell: quoted where it has to be, with spreadsheet formulas defused.
 *
 * The leading-character guard is the part worth keeping: a cell beginning `=`,
 * `+`, `-` or `@` is evaluated by Excel and Sheets when the file is opened, so
 * text that came from outside the platform could run as a formula on an
 * operator's machine. Shared rather than copied, because two copies of this
 * means one of them gets the next fix and the other does not.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) || safe !== s ? `"${safe.replace(/"/g, '""')}"` : safe;
}
