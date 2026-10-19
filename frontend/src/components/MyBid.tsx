"use client";

import { FheTypes } from "@cofhe/sdk";
import { useEffect, useRef, useState } from "react";
import { isAddress, zeroHash } from "viem";
import { useAccount, usePublicClient, useReadContract, useWalletClient } from "wagmi";
import { Skeleton } from "@/src/components/Skeleton";
import { connectCofheClient, cofheClient, isSupportedChainId } from "@/src/config/cofhe";
import { useI18n } from "@/src/i18n/LanguageProvider";
import { notice } from "@/src/i18n/messages";
import { bidEngineAbi } from "@/src/lib/abis";

export type MyBidProps = {
  /** `BidEngine` that stored this account's `euint32` and called `FHE.allow` for it. */
  bidEngineAddress: `0x${string}`;
  /** Plaintext from `decryptForView`, which unseals the ciphertext for this wallet. */
  onPlaintext?: (bps: bigint | null) => void;
};

export function MyBid({ bidEngineAddress, onPlaintext }: MyBidProps) {
  const { t, format } = useI18n();
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const engineReady = isAddress(bidEngineAddress);
  const chainSupported = isSupportedChainId(chainId);

  const bidQuery = useReadContract({
    address: bidEngineAddress,
    abi: bidEngineAbi,
    functionName: "myBid",
    account: address,
    query: {
      enabled: engineReady && isConnected && address != null,
    },
  });

  const handle = bidQuery.data;
  const handleReady = handle != null && handle !== zeroHash;
  const [decrypting, setDecrypting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [plaintext, setPlaintext] = useState<bigint | null>(null);
  const [status, setStatus] = useState<ReturnType<typeof notice> | null>(null);
  const previousHandle = useRef<typeof handle>(undefined);

  useEffect(() => {
    const previous = previousHandle.current;
    previousHandle.current = handle;
    if (previous != null && previous !== handle) {
      setPlaintext(null);
      onPlaintext?.(null);
    }
  }, [handle, onPlaintext]);

  async function decryptMine() {
    if (!publicClient || !walletClient || !handleReady || handle == null) {
      setError(notice("connectBiddingAccount"));
      return;
    }
    if (!chainSupported) {
      setError(notice("noCoprocessor"));
      return;
    }

    setDecrypting(true);
    setError(null);
    setPlaintext(null);
    setStatus(notice("statusAcp"));

    try {
      await connectCofheClient(publicClient, walletClient);
      const acp = await cofheClient.acp.getOrCreateSelfACP();
      setStatus(notice("statusDecrypting"));
      const value = await cofheClient.decryptForView(handle, FheTypes.Uint32).withACP(acp).execute();
      setPlaintext(value);
      onPlaintext?.(value);
      setStatus(null);
    } catch (caught) {
      setStatus(null);
      setError(caught);
    } finally {
      setDecrypting(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl samity-card border border-emerald-200/70 bg-emerald-950/40 p-5">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t("myBidTitle")}</h2>
        <p className="text-sm text-emerald-50/70">{t("myBidBody")}</p>
      </header>

      <dl className="grid gap-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-emerald-50/60">{t("account")}</dt>
          <dd className="font-mono">{address ?? t("notConnected")}</dd>
        </div>
        <div>
          <dt className="text-emerald-50/60">{t("bidHandle")}</dt>
          <dd className="break-all font-mono text-xs">
            {!isConnected ? (
              t("connectShort")
            ) : bidQuery.isLoading ? (
              <Skeleton className="inline-block h-3 w-40 align-middle" />
            ) : bidQuery.error ? (
              format(bidQuery.error)
            ) : handleReady ? (
              handle
            ) : (
              t("emptyHandle")
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-emerald-50/60">{t("plaintext")}</dt>
          <dd className="font-mono">{plaintext == null ? t("notDecrypted") : t("bps", { value: plaintext.toString() })}</dd>
        </div>
      </dl>

      <button
        type="button"
        className="w-full rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-40"
        onClick={() => {
          void decryptMine();
        }}
        disabled={!handleReady || !chainSupported || publicClient == null || walletClient == null || decrypting}
      >
        {decrypting ? t("decrypting") : t("decryptMyBid")}
      </button>

      {status ? <p className="text-sm text-emerald-50/70">{format(status)}</p> : null}
      {error ? <p className="text-sm text-red-300">{format(error)}</p> : null}
    </section>
  );
}
