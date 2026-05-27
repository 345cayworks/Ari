import { Bot, GrammyError, HttpError } from "grammy";
import { config } from "./config.js";
import { isAllowed } from "./auth.js";
import { respond } from "./brain.js";
import { transcribe } from "./stt.js";

export const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

bot.use(async (ctx, next) => {
  if (!isAllowed(ctx.from?.id)) {
    if (ctx.from?.id) {
      console.warn(
        `Rejected message from unauthorized user ${ctx.from.id} (${ctx.from.username ?? "no username"})`
      );
    }
    return;
  }
  await next();
});

bot.command("start", async (ctx) => {
  await ctx.reply("Ari here. Send a message or a voice note.");
});

bot.command("whoami", async (ctx) => {
  await ctx.reply(`Telegram user ID: ${ctx.from?.id}`);
});

bot.on("message:voice", async (ctx) => {
  const userId = ctx.from!.id;
  try {
    await ctx.replyWithChatAction("typing");
    const file = await ctx.getFile();
    const url = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download voice note: ${res.status}`);
    const audio = Buffer.from(await res.arrayBuffer());

    const text = await transcribe(audio, "voice.ogg");
    if (!text) {
      await ctx.reply("(couldn't make out the voice note — try again?)");
      return;
    }
    await ctx.reply(`🎙 "${text}"`);

    await ctx.replyWithChatAction("typing");
    const reply = await respond(userId, text);
    await ctx.reply(reply);
  } catch (err) {
    console.error("Voice handler error:", err);
    await ctx.reply(
      `Error processing voice note: ${err instanceof Error ? err.message : String(err)}`
    );
  }
});

bot.on("message:text", async (ctx) => {
  const userId = ctx.from!.id;
  const text = ctx.message.text.trim();
  if (!text || text.startsWith("/")) return;

  try {
    await ctx.replyWithChatAction("typing");
    const reply = await respond(userId, text);
    await ctx.reply(reply);
  } catch (err) {
    console.error("Text handler error:", err);
    await ctx.reply(
      `Something broke: ${err instanceof Error ? err.message : String(err)}`
    );
  }
});

bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Bot error in update ${ctx.update.update_id}:`);
  if (err.error instanceof GrammyError) {
    console.error("Telegram request failed:", err.error.description);
  } else if (err.error instanceof HttpError) {
    console.error("Network error:", err.error);
  } else {
    console.error(err.error);
  }
});
