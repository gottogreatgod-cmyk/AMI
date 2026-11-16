"use client";

import { SessionProvider, useSession } from "next-auth/react";
import { LoginScreen } from "@/components/workstation/login-screen";
import { Workstation } from "@/components/workstation/workstation";
import { useAuthGate } from "@/components/workstation/hooks";

function Gate() {
  const { session, ready } = useAuthGate();
  if (!ready) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#080d13] text-[#8193a3] text-[12px]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#78a9ea] via-[#a58de6] to-[#48b997] grid place-items-center text-[#071019] font-black">
            A
          </div>
          initializing workstation…
        </div>
      </div>
    );
  }
  if (!session?.user) return <LoginScreen />;
  return <Workstation sessionEmail={session.user.email ?? null} />;
}

export default function Home() {
  return (
    <SessionProvider>
      <Gate />
    </SessionProvider>
  );
}
