import { NextResponse } from "next/server";
// Deliberately "grammy/web", not "grammy". grammY's "." export resolves the
// `node` condition to a build whose shim pulls in the `abort-controller` and
// `node-fetch` polyfills — and OpenNext bundles with esbuild's platform "node",
// so that is what gets picked. workerd's fetch then rejects the polyfilled
// signal with "Expected signal to be an instanceof AbortSignal", and grammY
// reports it only as "Network request for 'sendChatAction' failed!". The /web
// subpath has no node/browser branching and uses the global AbortController
// and fetch. Same trap as "@prisma/client/wasm" in lib/db.ts — don't "tidy"
// either back to the bare specifier.
import { Bot } from "grammy/web";
import { prisma } from "@/lib/db";
import { respond } from "@/lib/ari/brain";
import { transcribe, transcriptionConfigured } from "@/lib/ari/stt";

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
        await bot.api.sendMessage(
          chatId,
          transcriptionConfigured()
            ? "Ari here. Send a message or voice note."
            : "Ari here. Send a message."
        );
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
    // Throwing here would return a 500, and Telegram would redeliver the same
    // voice note on a timer. Answer instead, so the update is settled.
    if (!transcriptionConfigured()) {
      await bot.api.sendMessage(
        chatId,
        "(voice notes aren't set up — send it as text and I'll pick it up)"
      );
      return;
    }

    await bot.api.sendChatAction(chatId, "typing");
    const file = await bot.api.getFile(message.voice.file_id);
    if (!file.file_path) throw new Error("Telegram returned no file_path");
    const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);
    const audio = Buffer.from(await res.arrayBuffer());

    let text: string;
    try {
      text = await transcribe(audio, "voice.ogg");
    } catch (err) {
      // A rejected key or a rate limit should not become a redelivery loop.
      console.error("Voice transcription failed:", err);
      await bot.api.sendMessage(
        chatId,
        "(couldn't transcribe that one — could you send it as text?)"
      );
      return;
    }
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
  { params }: { params: Promise<{ secret: string }> }
): Promise<NextResponse> {
  const { secret } = await params;
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || secret !== expected) {
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
    // grammY wraps the underlying failure in an HttpError whose message says
    // only "Network request for 'x' failed!". The thrown original is kept on
    // `.error` (not the standard `.cause`), and logging the error object alone
    // throws it away — which is what made this hard to diagnose.
    const describe = (e: unknown): string =>
      e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    const inner =
      err instanceof Error
        ? ((err as { cause?: unknown }).cause ?? (err as { error?: unknown }).error)
        : undefined;
    const cause = inner ? ` | cause: ${describe(inner)}` : "";
    console.error(`Telegram webhook error: ${describe(err)}${cause}`);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown", cause: cause || undefined },
      { status: 200 }
    );
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true });
}
