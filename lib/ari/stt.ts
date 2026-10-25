// Voice notes are optional: Ari works on text without GROQ_API_KEY.
export function transcriptionConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

export async function transcribe(
  audio: Buffer,
  filename: string
): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    throw new Error(
      "GROQ_API_KEY is not set — required for voice transcription."
    );
  }

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)]), filename);
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "text");

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Groq STT failed (${res.status}): ${await res.text()}`);
  }
  return (await res.text()).trim();
}
