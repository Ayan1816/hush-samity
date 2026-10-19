"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { FheTypes } from "@cofhe/sdk";
import { useState } from "react";
import { zeroHash, type Address, type Hex } from "viem";
import { useAccount, usePublicClient, useReadContract, useWalletClient } from "wagmi";
import { Skeleton } from "@/src/components/Skeleton";
import { connectCofheClient, cofheClient, isSupportedChainId } from "@/src/config/cofhe";
import { useI18n } from "@/src/i18n/LanguageProvider";
import { notice } from "@/src/i18n/messages";
import { TASK_MANAGER_ADDRESS, bidEngineAbi, taskManagerAbi } from "@/src/lib/abis";
import { quoteBid } from "@/src/lib/bidQuote";
import { normalizeHandle } from "@/src/lib/ciphertext";
import { classifyError } from "@/src/lib/errors";
import { formatTokenAmount } from "@/src/lib/tokenFormat";

const quietRead = { placeholderData: keepPreviousData };

type ChainViewProps = {
  bidEngine: Address;
  chainId: number;
  blockNumber: bigint | undefined;
  installmentAmount: bigint | null;
  memberCap: bigint | null;
  decimals: number | undefined;
  symbol: string | undefined;
  draftBps: bigint | null;
  unsealedBps: bigint | null;
  onUnsealed: (bps: bigint | null) => void;
};

function discountText(
  bps: bigint,
  installmentAmount: bigint | null,
  memberCap: bigint | null,
  decimals: number | undefined,
  symbol: string | undefined,
  readingTerms: string,
  readingDecimals: string,
  explain: (error: unknown) => string,
): string {
  if (installmentAmount == null || memberCap == null) return readingTerms;
  if (decimals == null) return readingDecimals;
  try {
    const quote = quoteBid(installmentAmount, memberCap, bps);
    return formatTokenAmount(quote.discountAmount, decimals, symbol);
  } catch (caught) {
    return explain(caught);
  }
}

export function ChainView({
  bidEngine,
  chainId,
  blockNumber,
  installmentAmount,
  memberCap,
  decimals,
  symbol,
  draftBps,
  unsealedBps,
  onUnsealed,
}: ChainViewProps) {
  const { t, format } = useI18n();
  const { address, chain } = useAccount();
  const publicClient = usePublicClient({ chainId });
  const { data: walletClient } = useWalletClient({ chainId });
  const chainSupported = isSupportedChainId(chainId);
  const [decrypting, setDecrypting] = useState(false);
  const [status, setStatus] = useState<ReturnType<typeof notice> | null>(null);
  const [error, setError] = useState<unknown>(null);

  const bidQuery = useReadContract({
    address: bidEngine,
    abi: bidEngineAbi,
    functionName: "myBid",
    account: address,
    chainId,
    blockNumber,
    query: {
      enabled: address != null && blockNumber != null,
      ...quietRead,
    },
  });

  const classifiedBid = bidQuery.isError ? classifyError(bidQuery.error) : null;
  const noBid = classifiedBid?.key === "err_NoBid";
  const bidError = classifiedBid ? t(classifiedBid.key, classifiedBid.vars) : null;
  const rawHandle = bidQuery.data;
  let handleError: string | null = null;
  let bytes32: Hex | null = null;
  if (rawHandle != null && rawHandle !== zeroHash) {
    try {
      bytes32 = normalizeHandle(rawHandle);
    } catch (caught) {
      handleError = format(caught);
    }
  }
  const ctHash = bytes32 == null ? undefined : BigInt(bytes32);
  const uint256Hex = ctHash == null ? null : `0x${ctHash.toString(16)}`;

  const allowedQuery = useReadContract({
    address: TASK_MANAGER_ADDRESS,
    abi: taskManagerAbi,
    functionName: "isAllowed",
    args: address && ctHash != null ? [ctHash, address] : undefined,
    chainId,
    blockNumber,
    query: { enabled: address != null && ctHash != null && blockNumber != null, ...quietRead },
  });
  const publicQuery = useReadContract({
    address: TASK_MANAGER_ADDRESS,
    abi: taskManagerAbi,
    functionName: "isPubliclyAllowed",
    args: ctHash != null ? [ctHash] : undefined,
    chainId,
    blockNumber,
    query: { enabled: ctHash != null && blockNumber != null, ...quietRead },
  });

  const allowedError = allowedQuery.isError ? format(allowedQuery.error) : null;
  const publicError = publicQuery.isError ? format(publicQuery.error) : null;
  const shownBps = unsealedBps ?? draftBps;
  const rightTitle = chainId === 11155111 ? t("chainSeesSepolia") : t("chainSeesNamed", { chain: chain?.name ?? t("chainFallback") });
  const priced = (bps: bigint) =>
    discountText(
      bps,
      installmentAmount,
      memberCap,
      decimals,
      symbol,
      t("readingInstallmentCap"),
      t("readingDecimals"),
      format,
    );

  let zkStatus: string;
  if (address == null) zkStatus = t("zkConnect");
  else if (noBid) zkStatus = t("zkNoCipher");
  else if (bidError) zkStatus = bidError;
  else if (handleError) zkStatus = handleError;
  else if (rawHandle === zeroHash) zkStatus = t("emptyHandle");
  else if (bidQuery.isLoading || bytes32 == null) zkStatus = t("zkReadingBid");
  else if (allowedError) zkStatus = allowedError;
  else if (publicError) zkStatus = publicError;
  else if (allowedQuery.data == null || publicQuery.data == null) zkStatus = t("zkReadingFlags");
  else if (allowedQuery.data && !publicQuery.data) zkStatus = t("zkVerified");
  else if (allowedQuery.data && publicQuery.data) zkStatus = t("zkPublic");
  else zkStatus = t("zkNotAllowed");

  async function unseal() {
    if (!publicClient || !walletClient || bytes32 == null) {
      setError(notice("connectBiddingAccount"));
      return;
    }
    if (!chainSupported) {
      setError(notice("noCoprocessor"));
      return;
    }
    setDecrypting(true);
    setError(null);
    setStatus(notice("requestingAcp"));
    try {
      await connectCofheClient(publicClient, walletClient);
      const acp = await cofheClient.acp.getOrCreateSelfACP();
      setStatus(notice("unsealingDevice"));
      const value = await cofheClient.decryptForView(bytes32, FheTypes.Uint32).withACP(acp).execute();
      onUnsealed(value);
      setStatus(null);
    } catch (caught) {
      setStatus(null);
      setError(caught);
    } finally {
      setDecrypting(false);
    }
  }

  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <article className="flex flex-col gap-3 rounded-2xl samity-card border border-emerald-200/70 bg-emerald-950/40 p-5 text-sm">
        <header className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{t("privateTitle")}</h2>
          <p className="text-emerald-50/70">{t("privateOnly")}</p>
        </header>
        <p className="break-all font-mono text-xs">{address ?? t("notConnected")}</p>
        {shownBps == null ? (
          <p className="text-emerald-50/70">{t("noPlaintext")}</p>
        ) : (
          <>
            <p className="font-mono">{t("bpsAmount", { bps: shownBps.toString(), amount: priced(shownBps) })}</p>
            <p className="text-emerald-50/70">{unsealedBps != null ? t("unsealedHere") : t("typedHere")}</p>
          </>
        )}
        {unsealedBps != null && draftBps != null && unsealedBps !== draftBps ? (
          <p className="font-mono text-xs">
            {t("draftOnDevice", { bps: draftBps.toString(), amount: priced(draftBps) })}
          </p>
        ) : null}
        <button
          type="button"
          className="w-full rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-40"
          onClick={() => {
            void unseal();
          }}
          disabled={bytes32 == null || !chainSupported || publicClient == null || walletClient == null || decrypting}
        >
          {decrypting ? t("unsealing") : t("unsealBid")}
        </button>
        {status ? <p className="text-emerald-50/70">{format(status)}</p> : null}
        {error ? <p className="text-red-300">{format(error)}</p> : null}
      </article>

      <article className="flex flex-col gap-3 rounded-2xl samity-card border border-emerald-200/70 bg-emerald-950/40 p-5 text-sm">
        <header className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{rightTitle}</h2>
          <p className="text-emerald-50/70">{t("chainSeesBody")}</p>
        </header>
        <dl className="grid gap-3">
          <div>
            <dt className="text-emerald-50/60">{t("bidEngine")}</dt>
            <dd className="break-all font-mono text-xs">{bidEngine}</dd>
          </div>
          <div>
            <dt className="text-emerald-50/60">{t("handleBytes")}</dt>
            <dd className="break-all font-mono text-xs">
              {address == null ? (
                t("connectShort")
              ) : bidQuery.isLoading && bytes32 == null && rawHandle !== zeroHash && !noBid ? (
                <Skeleton className="inline-block h-3 w-40 align-middle" />
              ) : noBid ? (
                t("noHandle")
              ) : rawHandle === zeroHash ? (
                t("emptyHandle")
              ) : (
                (bytes32 ?? bidError ?? handleError ?? t("reading"))
              )}
            </dd>
          </div>
          <div>
            <dt className="text-emerald-50/60">{t("handleUint")}</dt>
            <dd className="break-all font-mono text-xs">
              {address == null ? (
                t("connectShort")
              ) : bidQuery.isLoading && uint256Hex == null && rawHandle !== zeroHash && !noBid ? (
                <Skeleton className="inline-block h-3 w-40 align-middle" />
              ) : rawHandle === zeroHash ? (
                t("emptyHandle")
              ) : (
                (uint256Hex ?? (noBid ? t("noHandle") : (bidError ?? handleError ?? t("reading"))))
              )}
            </dd>
          </div>
          <div>
            <dt className="text-emerald-50/60">{t("taskManager")}</dt>
            <dd className="break-all font-mono text-xs">{TASK_MANAGER_ADDRESS}</dd>
          </div>
          <div>
            <dt className="text-emerald-50/60">{t("zkProof")}</dt>
            <dd>{zkStatus}</dd>
          </div>
          {bytes32 != null ? (
            <div>
              <dt className="text-emerald-50/60">{t("allowedPair")}</dt>
              <dd className="font-mono text-xs">
                {allowedQuery.data == null && !allowedError ? (
                  <Skeleton className="inline-block h-3 w-24 align-middle" />
                ) : allowedError ? (
                  allowedError
                ) : allowedQuery.data ? (
                  t("yes")
                ) : (
                  t("no")
                )}
                {" / "}
                {publicQuery.data == null && !publicError ? (
                  <Skeleton className="inline-block h-3 w-24 align-middle" />
                ) : publicError ? (
                  publicError
                ) : publicQuery.data ? (
                  t("yes")
                ) : (
                  t("no")
                )}
              </dd>
            </div>
          ) : null}
        </dl>
      </article>
    </section>
  );
}
