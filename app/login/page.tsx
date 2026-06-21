"use client";

import { useState } from "react";

export default function Login() {
  const [pw, setPw] = useState("");
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function loginPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    const r = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    setBusy(false);
    if (r.ok) window.location.href = "/";
    else setMsg("Wrong password.");
  }

  async function sendMagic(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    const r = await fetch("/api/auth/magic", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setBusy(false);
    setMsg(
      r.ok
        ? "If that address is allowed, a login link is on its way."
        : "Email isn't set up yet — use the password above for now.",
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <h1 className="mb-1 text-3xl font-bold tracking-tight">
        Hopping<span className="text-accent">.</span>
      </h1>
      <p className="mb-6 text-sm text-muted">Which project should I hop to next?</p>

      <form onSubmit={loginPassword} className="space-y-2">
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Password"
          className="w-full rounded-xl border border-border bg-surface px-3 py-3 outline-none focus:border-accent"
        />
        <button
          disabled={busy}
          className="w-full rounded-xl bg-accent px-4 py-3 font-semibold text-black disabled:opacity-50"
        >
          Enter
        </button>
      </form>

      <div className="my-5 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={sendMagic} className="space-y-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          className="w-full rounded-xl border border-border bg-surface px-3 py-3 outline-none focus:border-accent"
        />
        <button
          disabled={busy}
          className="w-full rounded-xl border border-border bg-surface-2 px-4 py-3 font-medium text-foreground disabled:opacity-50"
        >
          Email me a login link
        </button>
      </form>

      {msg && <p className="mt-4 text-center text-sm text-muted">{msg}</p>}
    </main>
  );
}
