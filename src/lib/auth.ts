import NextAuth, { type NextAuthOptions, getServerSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
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

// NextAuth v4: NextAuth(options) returns the route handler itself.
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
export const auth = () => getServerSession(authOptions);
