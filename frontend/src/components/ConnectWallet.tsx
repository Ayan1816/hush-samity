"use client";

import { useEffect, useId, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useBalance, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { errorText } from "@/src/lib/errors";
import { isSupportedChainId } from "@/src/config/cofhe";

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatBalance(value: bigint, decimals: number, symbol: string): string {
  const raw = formatUnits(value, decimals);
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const dot = unsigned.indexOf(".");
  if (dot === -1) return `${raw} ${symbol}`;
  const whole = unsigned.slice(0, dot);
  const fraction = unsigned.slice(dot + 1, dot + 5).replace(/0+$/, "");
  const amount = fraction.length > 0 ? `${whole}.${fraction}` : whole;
  return `${negative ? "-" : ""}${amount} ${symbol}`;
}

export function ConnectWallet() {
  const [mounted, setMounted] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const dialogTitleId = useId();
  const { address, chain, isConnected } = useAccount();
  const { connect, connectors, isPending, variables, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain();
  const { data: balance } = useBalance({
    address,
    query: { enabled: Boolean(address) },
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isConnected) setWalletOpen(false);
  }, [isConnected]);

  useEffect(() => {
    if (!walletOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setWalletOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [walletOpen]);

  if (!mounted) {
    return (
      <div className="w-full sm:w-auto">
        <div className="h-10 w-full rounded-lg border border-emerald-200/40 sm:w-40" />
      </div>
    );
  }

  const inSafeApp = window.parent !== window;
  const availableConnectors = connectors.filter((connector) => connector.id !== "safe" || inSafeApp);
  const wrongNetwork = Boolean(isConnected && !isSupportedChainId(chain?.id));
  const switchTarget = wagmiConfig.chains[0];
  const balanceText =
    balance == null ? "Balance loading…" : formatBalance(balance.value, balance.decimals, balance.symbol);

  return (
    <div className="flex w-full flex-col gap-2 text-sm sm:w-72">
      {wrongNetwork ? (
        <div className="rounded-lg border border-red-400 bg-red-950 px-3 py-2 text-red-100">
          <p>
            {chain?.name ?? "This network"} is not a CoFHE testnet.
            {switchTarget ? ` Switch to ${switchTarget.name}.` : null}
          </p>
          <button
            type="button"
            className="mt-2 w-full rounded-lg bg-red-500 px-3 py-2 font-medium text-white disabled:opacity-40"
            disabled={switching || switchTarget == null}
            onClick={() => {
              if (switchTarget) switchChain({ chainId: switchTarget.id });
            }}
          >
            {switching ? "Switching…" : "Switch network"}
          </button>
          {switchError ? <p className="mt-2 text-red-200">{errorText(switchError)}</p> : null}
        </div>
      ) : null}

      {isConnected && address ? (
        <div className="samity-card flex flex-col gap-1 rounded-xl border bg-emerald-950/40 px-3 py-2">
          <p className="font-mono font-medium">{shortAddress(address)}</p>
          <p className="text-emerald-50/80">{chain?.name ?? "Unknown network"}</p>
          <p className="text-emerald-50/80">{balanceText}</p>
          <button
            type="button"
            className="mt-1 w-fit text-emerald-200 underline-offset-2 hover:underline"
            onClick={() => disconnect()}
          >
            Disconnect
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="w-full rounded-lg bg-emerald-400 px-4 py-2 font-medium text-emerald-950"
          onClick={() => setWalletOpen(true)}
        >
          Connect Wallet
        </button>
      )}

      {walletOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
          onClick={() => setWalletOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            className="samity-card w-full max-w-sm rounded-2xl border bg-[#0c1210] p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id={dialogTitleId} className="text-lg font-medium">
              Connect a wallet
            </h2>
            <div className="mt-4 flex flex-col gap-2">
              {availableConnectors.length === 0 ? (
                <p className="text-emerald-50/70">No injected wallet is available in this browser.</p>
              ) : (
                availableConnectors.map((connector) => {
                  const pending = isPending && variables?.connector.uid === connector.uid;
                  return (
                    <button
                      key={connector.uid}
                      type="button"
                      className="w-full rounded-lg border border-emerald-200/50 px-3 py-2 text-left font-medium hover:border-emerald-300 hover:shadow-[0_0_16px_rgba(16,185,129,0.28)] disabled:opacity-40"
                      disabled={isPending}
                      onClick={() => connect({ connector })}
                    >
                      {pending ? "Confirm in the wallet…" : connector.name}
                    </button>
                  );
                })
              )}
            </div>
            {error ? <p className="mt-3 text-red-300">{errorText(error)}</p> : null}
            <button
              type="button"
              className="mt-4 w-full rounded-lg border border-emerald-200/40 px-3 py-2"
              onClick={() => setWalletOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
