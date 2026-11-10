import { NextResponse } from "next/server";
import { handleFunctionCall } from "@/lib/polling/calls";
import { retellSignatureProblem, type RetellFunctionRequest } from "@/lib/polling/retell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Custom functions the agent calls mid-call (see lib/polling/config.ts).
// The JSON we return is read by the agent's LLM, so keep it short.
export async function POST(req: Request): Promise<NextResponse> {
  const raw = await req.text();
  const problem = retellSignatureProblem(raw, req.headers.get("x-retell-signature"));
  if (problem !== null) {
    // Louder here than on the webhook, if anything. This route carries
    // `record_answer`, so a rejected signature means a respondent answered
    // and the answer was thrown away while the interview carried on sounding
    // perfectly normal. Nothing downstream can tell that apart from a
    // respondent who declined to answer.
    console.error(`Retell function call rejected: ${problem}`);
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const body = JSON.parse(raw) as RetellFunctionRequest;
  try {
    const { result, status } = await handleFunctionCall(body);
    return NextResponse.json({ result }, { status: status ?? 200 });
  } catch (err) {
    console.error(`Retell function ${body.name} for ${body.call?.call_id} failed:`, err);
    return NextResponse.json(
      { result: "Couldn't save that, but carry on with the call." },
      { status: 500 }
    );
  }
}
