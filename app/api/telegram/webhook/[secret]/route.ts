import { NextResponse } from "next/server";
import { Bot } from "grammy";
import { prisma } from "@/lib/db";
import { respond } from "@/lib/ari/brain";
import { transcribe } from "@/lib/ari/stt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

let cachedBot: Bot | null = null;
function getBot(): Bot {
  if (!cachedBot) {
    cachedBot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);
  }
  return cachedBot;
}

async function findUserByTelegramId(telegramId: number) {
  const user = await prisma.user.findUnique({
    where: { telegramUserId: String(telegramId) },
    select: { id: true, tenantId: true },
  });
  return user?.tenantId ? { userId: user.id, tenantId: user.tenantId } : null;
}

async function handleUpdate(update: any): Promise<void> {
  const bot = getBot();
  const message = update.message;
  if (!message?.from?.id || !message.chat?.id) return;

  const telegramId = message.from.id as number;
  const chatId = message.chat.id as number;

  const linked = await findUserByTelegramId(telegramId);
  if (!linked) {
    console.warn(`Unauthorized Telegram user ${telegramId}`);
    return;
  }

  if (message.text) {
    const text = String(message.text).trim();
    if (!text || text.startsWith("/")) {
      if (text === "/start") {
        await bot.api.sendMessage(chatId, "Ari here. Send a message or voice note.");
      } else if (text === "/whoami") {
        await bot.api.sendMessage(chatId, `Telegram ID: ${telegramId}`);
      }
      return;
    }
    await bot.api.sendChatAction(chatId, "typing");
    const reply = await respond({
      tenantId: linked.tenantId,
      userId: linked.userId,
      userText: text,
    });
    await bot.api.sendMessage(chatId, reply);
    return;
  }

  if (message.voice) {
    await bot.api.sendChatAction(chatId, "typing");
    const file = await bot.api.getFile(message.voice.file_id);
    if (!file.file_path) throw new Error("Telegram returned no file_path");
    const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const audio = Buffer.from(await res.arrayBuffer());

    const text = await transcribe(audio, "voice.ogg");
    if (!text) {
      await bot.api.sendMessage(chatId, "(couldn't make out the voice note)");
      return;
    }
    await bot.api.sendMessage(chatId, `🎙 "${text}"`);
    await bot.api.sendChatAction(chatId, "typing");
    const reply = await respond({
      tenantId: linked.tenantId,
      userId: linked.userId,
      userText: text,
    });
    await bot.api.sendMessage(chatId, reply);
  }
}

export async function POST(
  req: Request,
  { params }: { params: { secret: string } }
): Promise<NextResponse> {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || params.secret !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const headerSecret = req.headers.get("x-telegram-bot-api-secret-token");
  if (headerSecret && headerSecret !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const update = await req.json();
    await handleUpdate(update);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Telegram webhook error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown" },
      { status: 200 }
    );
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true });
}
