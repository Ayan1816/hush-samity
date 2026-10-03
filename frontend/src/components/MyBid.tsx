"use client";

import { FheTypes, isCofheError } from "@cofhe/sdk";
import { useState } from "react";
import { isAddress, zeroHash } from "viem";
import { useAccount, usePublicClient, useReadContract, useWalletClient } from "wagmi";
import { connectCofheClient, cofheClient, isSupportedChainId } from "@/src/config/cofhe";

const bidEngineReads = [
  {
    type: "function",
    name: "myBid",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

function errorText(error: unknown): string {
  if (isCofheError(error)) return error.message;
  if (typeof error === "object" && error !== null && "shortMessage" in error && typeof error.shortMessage === "string") {
    return error.shortMessage;
  }
  if (error instanceof Error) return error.message;
  return "Could not read the bid.";
}

export type MyBidProps = {
  /** `BidEngine` that stored this account's `euint32` and called `FHE.allow` for it. */
  bidEngineAddress: `0x${string}`;
};

export function MyBid({ bidEngineAddress }: MyBidProps) {
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const engineReady = isAddress(bidEngineAddress);
  const chainSupported = isSupportedChainId(chainId);

  const bidQuery = useReadContract({
    address: bidEngineAddress,
    abi: bidEngineReads,
    functionName: "myBid",
    account: address,
    query: {
      enabled: engineReady && isConnected && address != null,
    },
  });

  const handle = bidQuery.data;
  const handleReady = handle != null && handle !== zeroHash;

  const [decrypting, setDecrypting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plaintext, setPlaintext] = useState<bigint | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function decryptMine() {
    if (!publicClient || !walletClient || !handleReady || handle == null) {
      setError("Connect the bidding account. The bid handle comes from BidEngine.myBid.");
      return;
    }
    if (!chainSupported) {
      setError("The connected chain has no CoFHE coprocessor in this client.");
      return;
    }

    setDecrypting(true);
    setError(null);
    setPlaintext(null);
    setStatus("Requesting access control permission…");

    try {
      await connectCofheClient(publicClient, walletClient);
      const acp = await cofheClient.acp.getOrCreateSelfACP();
      setStatus("Decrypting your bid…");
      const value = await cofheClient.decryptForView(handle, FheTypes.Uint32).withACP(acp).execute();
      setPlaintext(value);
      setStatus(null);
    } catch (caught) {
      setStatus(null);
      setError(errorText(caught));
    } finally {
      setDecrypting(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl samity-card border border-emerald-200/70 bg-emerald-950/40 p-5">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">My bid</h2>
        <p className="text-sm text-emerald-50/70">
          myBid returns only the connected account&apos;s handle. Decryption uses that account&apos;s self ACP.
        </p>
      </header>

      <dl className="grid gap-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-emerald-50/60">Account</dt>
          <dd className="font-mono">{address ?? "Not connected"}</dd>
        </div>
        <div>
          <dt className="text-emerald-50/60">Bid handle</dt>
          <dd className="break-all font-mono text-xs">
            {!isConnected
              ? "Connect a wallet."
              : bidQuery.isLoading
                ? "Reading BidEngine.myBid…"
                : bidQuery.error
                  ? errorText(bidQuery.error)
                  : handleReady
                    ? handle
                    : "BidEngine returned an empty handle."}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-emerald-50/60">Plaintext</dt>
          <dd className="font-mono">{plaintext == null ? "Not decrypted" : `${plaintext.toString()} bps`}</dd>
        </div>
      </dl>

      <button
        type="button"
        className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-40"
        onClick={() => {
          void decryptMine();
        }}
        disabled={!handleReady || !chainSupported || publicClient == null || walletClient == null || decrypting}
      >
        {decrypting ? "Decrypting…" : "Decrypt my bid"}
      </button>

      {status ? <p className="text-sm text-emerald-50/70">{status}</p> : null}
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
    </section>
  );
}
