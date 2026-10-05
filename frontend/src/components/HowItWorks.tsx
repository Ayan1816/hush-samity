"use client";

import { useEffect, useState } from "react";
import { cofheClient } from "@/src/config/cofhe";

type CofheStatus = "Initialized" | "Connecting" | "Not initialized";

const STEPS = [
  {
    title: "Pay your installment",
    body: "Lock collateral, then transfer the installment for this round.",
  },
  {
    title: "Seal your bid (encrypted)",
    body: "The discount is encrypted on your device before it is submitted.",
  },
  {
    title: "Winner revealed, losing bids stay hidden",
    body: "The winning bid is verified. Losing bids stay encrypted.",
  },
] as const;

function statusFrom(snapshot: { connected: boolean; connecting: boolean }): CofheStatus {
  if (snapshot.connected) return "Initialized";
  if (snapshot.connecting) return "Connecting";
  return "Not initialized";
}

export function HowItWorks() {
  const [status, setStatus] = useState<CofheStatus>("Not initialized");

  useEffect(() => {
    const apply = (snapshot: { connected: boolean; connecting: boolean }) => {
      setStatus(statusFrom(snapshot));
    };
    apply(cofheClient.getSnapshot());
    return cofheClient.subscribe(apply);
  }, []);

  const dot =
    status === "Initialized" ? "bg-emerald-400" : status === "Connecting" ? "animate-pulse bg-amber-300" : "bg-emerald-50/40";

  return (
    <section className="flex flex-col gap-4 rounded-2xl samity-card border border-emerald-200/70 bg-emerald-950/40 p-5">
      <header className="flex flex-col gap-3">
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold">How it works</h2>
          <span className="rounded-full border border-emerald-300/50 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-200">
            Encrypted by Fhenix CoFHE
          </span>
        </div>
        <p className="inline-flex items-center gap-2 text-xs text-emerald-50/80">
          <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
          CoFHE client: {status}
        </p>
      </header>
      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex flex-col gap-1 rounded-xl border border-emerald-200/20 bg-black/20 p-3">
            <span className="font-mono text-xs text-emerald-300">{index + 1}</span>
            <span className="text-sm font-semibold">{step.title}</span>
            <span className="text-sm text-emerald-50/70">{step.body}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
