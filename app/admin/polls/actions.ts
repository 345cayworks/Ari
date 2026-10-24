"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { PollStatus, Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createPollBatch, DoNotCallError, placePollCall } from "@/lib/polling/calls";
import { normalizePhone } from "@/lib/polling/phone";
import {
  MAX_BATCH_NUMBERS,
  MAX_CALLS_PER_SUBMIT,
  POLL_VARIABLES,
  WEEKDAYS,
} from "@/lib/polling/results";

async function requireTenant(): Promise<string> {
  const session = await auth();
  const role = session?.user.role;
  const tenantId = session?.user.tenantId;
  if (!tenantId || (role !== Role.SUPER_ADMIN && role !== Role.ADMIN)) {
    throw new Error("Not authorised");
  }
  return tenantId;
}

async function requirePoll(pollId: string) {
  const tenantId = await requireTenant();
  const poll = await prisma.poll.findFirst({ where: { id: pollId, tenantId } });
  if (!poll) throw new Error("Poll not found");
  return poll;
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

export async function createPoll(formData: FormData): Promise<void> {
  const tenantId = await requireTenant();
  const name = field(formData, "name");
  if (!name) return;
  const poll = await prisma.poll.create({
    data: {
      tenantId,
      name,
      variables: {
        poll_name: name,
        poll_topic: field(formData, "topic"),
        estimated_minutes: "5",
      },
    },
  });
  redirect(`/admin/polls/${poll.id}?tab=setup`);
}

export async function updatePoll(formData: FormData): Promise<void> {
  const poll = await requirePoll(field(formData, "pollId"));
  const variables: Record<string, string> = {
    ...((poll.variables ?? {}) as Record<string, string>),
  };
  for (const { key } of POLL_VARIABLES) {
    variables[key] = String(formData.get(key) ?? "").replace(/\r\n?/g, "\n").trim();
  }
  await prisma.poll.update({
    where: { id: poll.id },
    data: {
      name: field(formData, "name") || poll.name,
      retellAgentId: field(formData, "retellAgentId") || null,
      fromNumber: field(formData, "fromNumber") ? normalizePhone(field(formData, "fromNumber")) : null,
      variables,
    },
  });
  revalidatePath(`/admin/polls/${poll.id}`);
  redirect(`/admin/polls/${poll.id}?tab=setup&saved=1`);
}

export async function setPollStatus(formData: FormData): Promise<void> {
  const poll = await requirePoll(field(formData, "pollId"));
  const status = field(formData, "status") as PollStatus;
  if (!Object.values(PollStatus).includes(status)) return;
  const vars = (poll.variables ?? {}) as Record<string, string>;
  if (status === PollStatus.ACTIVE && !vars.survey_questions?.trim()) {
    redirect(`/admin/polls/${poll.id}?tab=setup&error=${encodeURIComponent("Add survey questions before activating.")}`);
  }
  await prisma.poll.update({ where: { id: poll.id }, data: { status } });
  revalidatePath(`/admin/polls/${poll.id}`);
  revalidatePath("/admin/polls");
}

export async function placeCalls(formData: FormData): Promise<void> {
  const poll = await requirePoll(field(formData, "pollId"));
  const numbers = [
    ...new Set(
      field(formData, "numbers")
        .split(/[\n,;]+/)
        .map((n) => n.trim())
        .filter((n) => n.replace(/\D/g, "").length >= 7)
        .map(normalizePhone)
    ),
  ];

  const result = { placed: 0, blocked: 0, failed: 0, skipped: 0, error: "" };
  if (numbers.length > MAX_CALLS_PER_SUBMIT) {
    result.skipped = numbers.length - MAX_CALLS_PER_SUBMIT;
  }
  for (const number of numbers.slice(0, MAX_CALLS_PER_SUBMIT)) {
    try {
      await placePollCall(poll.id, number);
      result.placed += 1;
    } catch (err) {
      if (err instanceof DoNotCallError) {
        result.blocked += 1;
      } else {
        result.failed += 1;
        result.error ||= err instanceof Error ? err.message.slice(0, 200) : String(err);
      }
    }
  }

  const q = new URLSearchParams({
    tab: "calls",
    placed: String(result.placed),
    blocked: String(result.blocked),
    failed: String(result.failed),
    skipped: String(result.skipped),
    // Changes every submit so the page remounts the form and clears the numbers.
    batch: String(Date.now()),
  });
  if (result.error) q.set("error", result.error);
  revalidatePath(`/admin/polls/${poll.id}`);
  redirect(`/admin/polls/${poll.id}?${q}`);
}

function parseTime(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes <= 1440 ? minutes : null;
}

// Pull one phone number per line from pasted text or a CSV/TXT upload:
// the first cell with at least 7 digits. Header rows have none, so drop out.
function extractNumbers(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.split(/[,;\t]/).find((cell) => cell.replace(/\D/g, "").length >= 7))
    .filter((cell): cell is string => Boolean(cell))
    .map((cell) => cell.replace(/^["']|["']$/g, "").trim());
}

export async function createBatch(formData: FormData): Promise<void> {
  const poll = await requirePoll(field(formData, "pollId"));
  const back = (params: Record<string, string>) =>
    redirect(`/admin/polls/${poll.id}?${new URLSearchParams({ tab: "calls", ...params })}`);

  let text = field(formData, "numbers");
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) text += "\n" + (await file.text());
  const numbers = extractNumbers(text);
  if (numbers.length === 0) back({ error: "No phone numbers found." });
  if (numbers.length > MAX_BATCH_NUMBERS) {
    back({ error: `${numbers.length.toLocaleString()} numbers found; the limit is ${MAX_BATCH_NUMBERS.toLocaleString()} per batch. Split the list.` });
  }

  const windowStart = parseTime(field(formData, "windowStart"));
  const windowEnd = parseTime(field(formData, "windowEnd"));
  if (windowStart === null || windowEnd === null || windowStart >= windowEnd) {
    back({ error: "Calling hours must start before they end." });
  }
  const days = formData.getAll("days").map(String).filter((d) => (WEEKDAYS as readonly string[]).includes(d));
  if (days.length === 0) back({ error: "Pick at least one calling day." });

  // datetime-local has no zone; it is entered in Cayman time (UTC-5, no DST).
  const startsAtRaw = field(formData, "startsAt");
  const startsAt = startsAtRaw ? new Date(`${startsAtRaw}:00-05:00`) : undefined;
  if (startsAt && Number.isNaN(startsAt.getTime())) back({ error: "Invalid start time." });

  const reserved = Number(field(formData, "reservedConcurrency"));
  let result;
  try {
    result = await createPollBatch(poll.id, numbers, {
      name: field(formData, "name") || `Batch ${new Date().toISOString().slice(0, 10)}`,
      windowStart: windowStart!,
      windowEnd: windowEnd!,
      days: days.length === WEEKDAYS.length ? [] : days,
      startsAt,
      skipAlreadyCalled: formData.get("skipAlreadyCalled") === "on",
      reservedConcurrency: Number.isInteger(reserved) && reserved > 0 ? reserved : undefined,
    });
  } catch (err) {
    back({ error: err instanceof Error ? err.message.slice(0, 300) : String(err) });
  }

  revalidatePath(`/admin/polls/${poll.id}`);
  back({
    batchSent: String(result!.submitted),
    batchDnc: String(result!.skippedDnc),
    batchCalled: String(result!.skippedCalled),
    batchInvalid: String(result!.skippedInvalid),
    ...(result!.error ? { error: result!.error } : {}),
    batch: String(Date.now()),
  });
}

export async function resolveCallback(formData: FormData): Promise<void> {
  const tenantId = await requireTenant();
  const callback = await prisma.pollCallback.findFirst({
    where: { id: field(formData, "callbackId"), tenantId, status: "PENDING" },
  });
  if (!callback) return;
  const action = field(formData, "action");
  let error = "";

  if (action === "call") {
    try {
      await placePollCall(callback.pollId, callback.phoneNumber);
    } catch (err) {
      error = err instanceof Error ? err.message.slice(0, 200) : String(err);
    }
  }
  if (!error) {
    // The number is only kept so we can dial back; drop it once handled.
    await prisma.pollCallback.update({
      where: { id: callback.id },
      data: { status: action === "call" ? "DONE" : "CANCELLED", phoneNumber: "" },
    });
  }
  revalidatePath(`/admin/polls/${callback.pollId}`);
  redirect(
    `/admin/polls/${callback.pollId}?tab=calls` + (error ? `&error=${encodeURIComponent(error)}` : "")
  );
}
