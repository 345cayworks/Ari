"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { PollStatus, Role } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DoNotCallError, placePollCall } from "@/lib/polling/calls";
import { normalizePhone } from "@/lib/polling/phone";
import { MAX_CALLS_PER_SUBMIT, POLL_VARIABLES } from "@/lib/polling/results";

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
