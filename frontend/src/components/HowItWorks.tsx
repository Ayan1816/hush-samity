"use client";

import { useEffect, useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { cofheClient, connectCofheClient, isSupportedChainId } from "@/src/config/cofhe";
import { errorText } from "@/src/lib/errors";

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

type ConnectionSnapshot = {
  connected: boolean;
  connecting: boolean;
  connectError?: unknown;
};

function statusFrom(snapshot: ConnectionSnapshot): CofheStatus {
  if (snapshot.connected) return "Initialized";
  if (snapshot.connecting) return "Connecting";
  return "Not initialized";
}

export function HowItWorks() {
  const { isConnected, chainId } = useAccount();
  const supported = isSupportedChainId(chainId);
  const publicClient = usePublicClient({ chainId: supported ? chainId : undefined });
  const { data: walletClient } = useWalletClient({ chainId: supported ? chainId : undefined });
  const [status, setStatus] = useState<CofheStatus>("Not initialized");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [manualPending, setManualPending] = useState(false);

  useEffect(() => {
    const apply = (snapshot: ConnectionSnapshot) => {
      setStatus(statusFrom(snapshot));
      setConnectError(snapshot.connectError ? errorText(snapshot.connectError) : null);
    };
    apply(cofheClient.getSnapshot());
    return cofheClient.subscribe(apply);
  }, []);

  async function initialize() {
    if (!publicClient || !walletClient) {
      setConnectError("The wallet provider is not ready yet.");
      return;
    }
    setManualPending(true);
    setConnectError(null);
    try {
      await connectCofheClient(publicClient, walletClient);
    } catch (caught) {
      setConnectError(errorText(caught));
    } finally {
      setManualPending(false);
    }
  }

  const dot =
    status === "Initialized" ? "bg-emerald-400" : status === "Connecting" ? "animate-pulse bg-amber-300" : "bg-emerald-50/40";
  const needsAction = connectError != null || publicClient == null || walletClient == null;
  const showInitialize = isConnected && supported && status === "Not initialized" && !manualPending && needsAction;

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
          CoFHE client: {manualPending ? "Connecting" : status}
        </p>
        {showInitialize ? (
          <button
            type="button"
            className="w-full rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950"
            onClick={() => {
              void initialize();
            }}
          >
            Initialize CoFHE
          </button>
        ) : null}
        {connectError && status !== "Initialized" ? <p className="text-sm text-red-300">{connectError}</p> : null}
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
