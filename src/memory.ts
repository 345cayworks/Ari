import { db } from "./db.js";

export type Role = "user" | "assistant";

export interface StoredMessage {
  role: Role;
  content: string;
  created_at: number;
}

const insertStmt = db.prepare(
  `INSERT INTO messages (user_id, role, content, created_at) VALUES (?, ?, ?, ?)`
);

const recentStmt = db.prepare<[number, number]>(
  `SELECT role, content, created_at
     FROM messages
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?`
);

export function appendMessage(userId: number, role: Role, content: string): void {
  insertStmt.run(userId, role, content, Date.now());
}

export function recentMessages(userId: number, limit = 30): StoredMessage[] {
  const rows = recentStmt.all(userId, limit) as StoredMessage[];
  return rows.reverse();
}
