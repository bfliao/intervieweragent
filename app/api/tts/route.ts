import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const voiceBaseUrl = process.env.VOICE_BASE_URL ?? "http://localhost:8888";

  try {
    const body = (await req.json()) as { text: string; voice?: string };
    const res = await fetch(`${voiceBaseUrl}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: body.text, voice: body.voice ?? "af_heart" }),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `TTS server error: ${res.status}` },
        { status: 502 }
      );
    }

    const audioBuffer = await res.arrayBuffer();
    return new NextResponse(audioBuffer, {
      status: 200,
      headers: { "Content-Type": "audio/wav" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "TTS proxy failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
