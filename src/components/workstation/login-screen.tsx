"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActivitySquare, Loader2, Lock, ShieldCheck } from "lucide-react";

export function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e?: React.FormEvent, demo = false) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const res = await signIn("credentials", {
      email: demo ? "demo@ami.local" : email,
      password: demo ? "ami-demo-2026" : password,
      redirect: false,
    });
    if (res?.error) {
      setError("Sign-in failed — check email and password.");
      setBusy(false);
      return;
    }
    // Credentials accepted and the session cookie is now set. Hard-reload so
    // the session gate re-reads it — inside the preview iframe the usual
    // next-auth session-refetch events are not dispatched cross-site, so an
    // explicit reload is the one path that always lands on the desk.
    window.location.reload();
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#080d13] text-[#e5edf4]">
      <main className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-4xl grid md:grid-cols-2 gap-0 overflow-hidden rounded-2xl border border-[#1f303d] shadow-2xl">
          {/* left: brand */}
          <div className="hidden md:flex flex-col justify-between p-10 bg-gradient-to-br from-[#0e1a26] via-[#101923] to-[#0a121a]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#78a9ea] via-[#a58de6] to-[#48b997] grid place-items-center text-[#071019] font-black text-lg">
                A
              </div>
              <div>
                <div className="font-extrabold tracking-[0.14em] text-lg">AMI</div>
                <div className="text-[10px] tracking-[0.12em] text-[#788c9c] font-medium">
                  UNIFIED QUANT WORKSTATION
                </div>
              </div>
            </div>
            <div className="space-y-4">
              <div className="text-[13px] text-[#a8b7c4] leading-relaxed">
                One engine. Fifteen markets — crypto, Nasdaq-100 and gold futures, VIX, EUR/USD,
                USD/JPY. Seven timeframes, 15m → 1w, every run backed by a higher timeframe.
              </div>
              <ul className="text-[11px] text-[#8193a3] space-y-2">
                <li className="flex gap-2"><ActivitySquare className="w-3.5 h-3.5 mt-0.5 text-[#4bc39a]" /> Live OHLC streamed per run from public exchange feeds — no downloads</li>
                <li className="flex gap-2"><ActivitySquare className="w-3.5 h-3.5 mt-0.5 text-[#4bc39a]" /> Signals on closed bars, fills at next open, fees + slippage both sides</li>
                <li className="flex gap-2"><ActivitySquare className="w-3.5 h-3.5 mt-0.5 text-[#4bc39a]" /> Scored by profit factor, t-stat and split-sample robustness — not by return</li>
                <li className="flex gap-2"><ActivitySquare className="w-3.5 h-3.5 mt-0.5 text-[#4bc39a]" /> Auto-review forks every suggestion into a measured re-run</li>
              </ul>
            </div>
            <div className="text-[10px] text-[#687e90] tracking-wide">
              PAPER SIMULATION ONLY · NO LIVE ORDERS · NO BROKER CONNECTION
            </div>
          </div>

          {/* right: form */}
          <div className="p-8 md:p-10 bg-[#0d1520] flex flex-col justify-center">
            <div className="md:hidden flex items-center gap-3 mb-8">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[#78a9ea] via-[#a58de6] to-[#48b997] grid place-items-center text-[#071019] font-black">
                A
              </div>
              <div className="font-extrabold tracking-[0.14em]">AMI</div>
            </div>
            <h1 className="text-xl font-bold mb-1">Sign in to the desk</h1>
            <p className="text-[12px] text-[#8193a3] mb-6">
              Your rule sets and runs stay private, scoped to your account.
            </p>
            <form onSubmit={(e) => submit(e)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-[11px] text-[#a8b7c4]">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@desk.local"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-[#0a121a] border-[#223546] h-10 text-[13px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-[11px] text-[#a8b7c4]">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-[#0a121a] border-[#223546] h-10 text-[13px]"
                />
              </div>
              {error && <div className="text-[11px] text-[#ef777d]">{error}</div>}
              <Button
                type="submit"
                disabled={busy}
                className="w-full h-10 bg-[#1b3347] hover:bg-[#24425c] text-[#e5f0fb] text-[13px] font-semibold"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                Sign in
              </Button>
            </form>
            <div className="flex items-center gap-3 my-5">
              <div className="h-px flex-1 bg-[#1f303d]" />
              <span className="text-[10px] text-[#687e90] tracking-widest">OR</span>
              <div className="h-px flex-1 bg-[#1f303d]" />
            </div>
            <Button
              variant="outline"
              onClick={() => submit(undefined, true)}
              disabled={busy}
              className="w-full h-10 border-[#2b5c48] bg-[#123025] hover:bg-[#17402f] text-[#4bc39a] text-[13px] font-semibold"
            >
              <ShieldCheck className="w-4 h-4" />
              Continue as demo analyst
            </Button>
            <p className="text-[10px] text-[#687e90] mt-5 leading-relaxed">
              Demo account: demo@ami.local / ami-demo-2026 — pre-loaded with the starter strategy
              set and the full research campaign results.
            </p>
          </div>
        </div>
      </main>
      <footer className="border-t border-[#1f303d] py-3 text-center text-[10px] tracking-[0.08em] text-[#687e90]">
        AMI UNIFIED QUANT WORKSTATION · SIMULATION RESEARCH · NOT INVESTMENT ADVICE
      </footer>
    </div>
  );
}
