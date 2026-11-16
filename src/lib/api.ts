import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import type { Session } from "next-auth";

export async function requireSession(): Promise<
  { ok: true; session: Session; userId: string } | { ok: false; res: NextResponse }
> {
  const session = await auth();
  if (!session?.user) {
    return {
      ok: false,
      res: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 }),
    };
  }
  const userId = (session.user as { id?: string }).id ?? "";
  if (!userId) {
    return {
      ok: false,
      res: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 }),
    };
  }
  return { ok: true, session, userId };
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function serverError(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: message }, { status: 500 });
}

export function parseJson<T>(body: unknown): T | null {
  try {
    return JSON.parse(typeof body === "string" ? body : JSON.stringify(body)) as T;
  } catch {
    return null;
  }
}
