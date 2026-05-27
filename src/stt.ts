import { config } from "./config.js";

export async function transcribe(audio: Buffer, filename: string): Promise<string> {
  if (!config.GROQ_API_KEY) {
    throw new Error(
      "GROQ_API_KEY is not set — required for voice note transcription. " +
        "Get a free key at https://console.groq.com"
    );
  }

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)]), filename);
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "text");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.GROQ_API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq STT failed (${res.status}): ${body}`);
  }

  return (await res.text()).trim();
}
