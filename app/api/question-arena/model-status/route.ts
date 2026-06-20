import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const baseURL = process.env.OPENAI_BASE_URL;
  const configuredModel = process.env.OPENAI_MODEL || "qwen2.5-32b";
  const apiKey = process.env.OPENAI_API_KEY || "dummy";

  if (!baseURL) {
    return NextResponse.json(
      {
        ok: false,
        error: "OPENAI_BASE_URL is not set.",
        configuredModel,
      },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(`${baseURL.replace(/\/$/, "")}/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: await res.text(),
          configuredModel,
        },
        { status: res.status }
      );
    }

    const data = await res.json();
    const modelIds = Array.isArray(data.data)
      ? data.data.map((item: { id?: string }) => item.id).filter(Boolean)
      : [];

    return NextResponse.json({
      ok: true,
      baseURL,
      configuredModel,
      modelIds,
      configuredModelAvailable: modelIds.includes(configuredModel),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
        configuredModel,
      },
      { status: 500 }
    );
  }
}
