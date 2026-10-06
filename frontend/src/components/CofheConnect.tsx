"use client";

import { useEffect, useRef } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { cofheClient, connectCofheClient, isSupportedChainId } from "@/src/config/cofhe";

/**
 * Bind the CoFHE singleton once wagmi has a public client and a wallet client.
 * `connect` reads the chain id and account. It does not ask for a signature.
 * A failed attempt is left on the client snapshot so the status card can retry.
 */
export function CofheConnect() {
  const { address, chainId, isConnected, status } = useAccount();
  const supported = isSupportedChainId(chainId);
  const publicClient = usePublicClient({ chainId: supported ? chainId : undefined });
  const { data: walletClient } = useWalletClient({ chainId: supported ? chainId : undefined });
  const startedFor = useRef<string | null>(null);

  useEffect(() => {
    if (status === "connecting" || status === "reconnecting") return;

    if (!isConnected || !supported) {
      startedFor.current = null;
      const snapshot = cofheClient.getSnapshot();
      if (snapshot.connected || snapshot.connecting) cofheClient.disconnect();
      return;
    }

    if (!publicClient || !walletClient || address == null || chainId == null) return;

    const key = `${chainId}:${address.toLowerCase()}`;
    const snapshot = cofheClient.getSnapshot();
    const sameSession =
      snapshot.connected &&
      snapshot.chainId === chainId &&
      snapshot.account?.toLowerCase() === address.toLowerCase();
    if (sameSession) {
      startedFor.current = key;
      return;
    }
    if (startedFor.current === key) return;

    startedFor.current = key;
    void connectCofheClient(publicClient, walletClient).catch(() => {
      // connect() records connectError on the snapshot before it throws.
    });
  }, [address, chainId, isConnected, publicClient, status, supported, walletClient]);

  return null;
}
