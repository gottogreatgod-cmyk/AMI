import NextAuth, { type NextAuthOptions, getServerSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { headers } from "next/headers";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Password hashing (node crypto scrypt — no external dependency)
// ---------------------------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export const DEMO_EMAIL = "demo@ami.local";
export const DEMO_PASSWORD = "ami-demo-2026";

async function ensureDemoUser() {
  let user = await db.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) {
    user = await db.user.create({
      data: {
        email: DEMO_EMAIL,
        name: "Demo Analyst",
        passwordHash: hashPassword(DEMO_PASSWORD),
        isDemo: true,
      },
    });
  }
  return user;
}

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/" },
  secret: process.env.NEXTAUTH_SECRET,
  providers: [
    Credentials({
      name: "AMI Account",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = (credentials?.email || "").trim().toLowerCase();
        const password = credentials?.password || "";
        if (!email || !password) return null;

        // one-click demo path
        if (email === DEMO_EMAIL && password === DEMO_PASSWORD) {
          const user = await ensureDemoUser();
          return { id: user.id, email: user.email, name: user.name };
        }

        const user = await db.user.findUnique({ where: { email } });
        if (!user || !verifyPassword(password, user.passwordHash)) return null;
        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.uid = (user as { id: string }).id;
      return token;
    },
    async session({ session, token }) {
      if (session.user) (session.user as { id?: string }).id = token.uid as string;
      return session;
    },
  },
};

// ---------------------------------------------------------------------------
// Proxy-aware cookie strategy
//
// The workstation is reached two ways:
//   1. directly — http://localhost:3000 (local dev / in-sandbox checks)
//   2. through the HTTPS preview gateway — preview-chat-*.space-z.ai, where the
//      app runs inside a cross-site iframe of the chat UI.
//
// NextAuth v4 defaults to SameSite=Lax cookies (NEXTAUTH_URL is http), and
// browsers DROP SameSite=Lax cookies in cross-site iframe contexts. The result:
// "Continue as demo analyst" succeeds server-side, but the session cookie never
// comes back with the next request, so the desk never opens in the preview.
// When the request host is a public hostname (the HTTPS gateway path), switch
// to SameSite=None; Secure cookies with the __Secure- prefix, which survive
// the iframe context.
// ---------------------------------------------------------------------------

const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/;
const IPV4_HOST_RE = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/;

function isGatewayRequest(h: Headers): boolean {
  const host =
    h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host")?.split(",")[0]?.trim() || "";
  if (!host) return false;
  if (LOCAL_HOST_RE.test(host) || IPV4_HOST_RE.test(host)) return false;
  return true; // public hostname → served through the HTTPS preview edge
}

/** Cookies for the HTTPS gateway / iframe context (cross-site-safe). */
export const GATEWAY_COOKIES: NextAuthOptions["cookies"] = {
  sessionToken: {
    name: "__Secure-next-auth.session-token",
    options: { httpOnly: true, sameSite: "none", path: "/", secure: true },
  },
  callbackUrl: {
    name: "__Secure-next-auth.callback-url",
    options: { sameSite: "none", path: "/", secure: true },
  },
  csrfToken: {
    name: "__Secure-next-auth.csrf-token",
    options: { httpOnly: true, sameSite: "none", path: "/", secure: true },
  },
};

export function authOptionsForHeaders(h?: Headers | null): NextAuthOptions {
  if (!h || !isGatewayRequest(h)) return authOptions;
  return { ...authOptions, cookies: GATEWAY_COOKIES };
}

// ---------------------------------------------------------------------------
// Route handlers — built per request so the cookie config can adapt to how the
// request arrived (direct vs gateway). Behavior for the direct path is
// identical to the static `NextAuth(authOptions)` handler.
// ---------------------------------------------------------------------------

type AuthRouteCtx = { params: Promise<{ nextauth: string[] }> } | undefined;

async function handleAuthRequest(req: Request, ctx?: AuthRouteCtx) {
  const options = authOptionsForHeaders(req.headers);
  const handler = NextAuth(options);
  return handler(req as never, ctx as never);
}

export { handleAuthRequest as GET, handleAuthRequest as POST };

/** Server-side session lookup (API routes). Uses gateway cookies when the
 *  incoming request came through the preview gateway, so the __Secure- session
 *  cookie resolves to the same JWT that was issued at sign-in. */
export const auth = async () => {
  let h: Headers | null = null;
  try {
    h = (await headers()) as unknown as Headers;
  } catch {
    h = null; // outside a request scope — fall back to default options
  }
  return getServerSession(authOptionsForHeaders(h));
};
