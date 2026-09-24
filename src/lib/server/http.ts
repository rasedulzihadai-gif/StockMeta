export function jsonError(message: string, status = 400, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error: message, ...extra }, { status });
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const v = await req.json();
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export type IdContext = { params: Promise<{ id: string }> };
