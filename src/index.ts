import { createServer } from "node:http";
import { config } from "./config.js";
import { bot } from "./bot.js";
import { webhookCallback } from "grammy";

async function main(): Promise<void> {
  if (config.TELEGRAM_MODE === "webhook") {
    if (!config.PUBLIC_URL) {
      throw new Error("PUBLIC_URL must be set when TELEGRAM_MODE=webhook");
    }
    const path = "/telegram";
    const handler = webhookCallback(bot, "http");

    const server = createServer(async (req, res) => {
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
        return;
      }
      if (req.method === "POST" && req.url === path) {
        try {
          await handler(req, res);
        } catch (err) {
          console.error("Webhook handler error:", err);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end();
          }
        }
        return;
      }
      res.writeHead(404);
      res.end();
    });

    server.listen(config.PORT, () => {
      console.log(`Ari listening on :${config.PORT} (webhook mode)`);
    });

    await bot.api.setWebhook(`${config.PUBLIC_URL.replace(/\/$/, "")}${path}`);
    console.log(`Webhook set to ${config.PUBLIC_URL}${path}`);
  } else {
    console.log("Ari starting in polling mode...");
    await bot.api.deleteWebhook({ drop_pending_updates: false }).catch(() => {});
    await bot.start({
      onStart: (me) => {
        console.log(`Bot @${me.username} ready. Send a message to start.`);
      },
    });
  }
}

const shutdown = async (signal: string): Promise<void> => {
  console.log(`\nReceived ${signal}, shutting down...`);
  await bot.stop();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
