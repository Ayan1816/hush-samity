"use client";

import { useEffect, useRef, useState } from "react";
import { zeroAddress, type Address, type Hash, type PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { Skeleton } from "@/src/components/Skeleton";
import { useI18n } from "@/src/i18n/LanguageProvider";
import type { MessageKey } from "@/src/i18n/messages";
import { loadRoundReceipts, type ReceiptLoad, type RoundReceipt } from "@/src/lib/roundReceipts";
import { formatTokenAmount } from "@/src/lib/tokenFormat";

const EXPLORERS: Record<number, string> = {
  11155111: "https://sepolia.etherscan.io/tx/",
  421614: "https://sepolia.arbiscan.io/tx/",
  84532: "https://sepolia.basescan.org/tx/",
};

type RoundReceiptsProps = {
  samity: Address;
  bidEngine: Address | null;
  token: Address | null;
  chainId: number;
  account: Address | undefined;
  blockNumber: bigint | undefined;
  currentRound: bigint | undefined;
  phase: number | undefined;
  decimals: number | undefined;
  symbol: string | undefined;
};

function explorerHref(chainId: number, hash: Hash): string | null {
  const base = EXPLORERS[chainId];
  if (!base) return null;
  return `${base}${hash}`;
}

function linkKey(chainId: number, kind: "closing" | "settlement"): MessageKey {
  if (chainId === 11155111) return kind === "closing" ? "viewClosingSepolia" : "viewSettlementSepolia";
  return kind === "closing" ? "viewClosing" : "viewSettlement";
}

function money(
  amount: bigint,
  decimals: number | undefined,
  symbol: string | undefined,
  reading: string,
): string {
  if (decimals == null) return reading;
  return formatTokenAmount(amount, decimals, symbol);
}

function privacyBadge(receipt: RoundReceipt): {
  text: { key: MessageKey; vars?: Record<string, string | number> } | null;
  source: { key: MessageKey; vars?: Record<string, string | number> };
} {
  if (!receipt.settled) return { text: null, source: { key: "cycleUnsettled" } };
  if (!receipt.hadBids) return { text: { key: "privacyZero" }, source: { key: "privacySourceNone" } };
  if (receipt.submittedCount == null) return { text: null, source: { key: "privacyUnknown" } };
  if (receipt.submittedCount < 1n) {
    return { text: null, source: { key: "privacyConflict", vars: { count: receipt.submittedCount.toString() } } };
  }
  const losing = receipt.submittedCount - 1n;
  return {
    text: { key: "privacyCount", vars: { count: losing.toString() } },
    source: { key: "privacySourceCount", vars: { count: receipt.submittedCount.toString() } },
  };
}

function TxLink({ chainId, hash, kind }: { chainId: number; hash: Hash; kind: "closing" | "settlement" }) {
  const { t } = useI18n();
  const href = explorerHref(chainId, hash);
  if (href == null) return <p className="break-all font-mono text-xs">{hash}</p>;
  return (
    <a className="break-all font-semibold text-emerald-200 underline" href={href} target="_blank" rel="noreferrer">
      {t(linkKey(chainId, kind))}
    </a>
  );
}

function ReceiptCard({
  receipt,
  chainId,
  decimals,
  symbol,
}: {
  receipt: RoundReceipt;
  chainId: number;
  decimals: number | undefined;
  symbol: string | undefined;
}) {
  const { t, format } = useI18n();
  const badge = privacyBadge(receipt);
  const priced = (amount: bigint) => money(amount, decimals, symbol, t("readingDecimals"));
  const sameHash =
    receipt.closeHash != null && receipt.settlementHash != null && receipt.closeHash.toLowerCase() === receipt.settlementHash.toLowerCase();

  if (!receipt.settled) {
    return (
      <article className="flex flex-col gap-2 rounded-2xl border border-emerald-200/40 p-4">
        <h3 className="font-semibold">{t("roundHeading", { round: receipt.cycle.toString() })}</h3>
        <p className="text-emerald-50/70">{t("cycleUnsettled")}</p>
      </article>
    );
  }

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-emerald-200/40 p-4">
      <h3 className="text-base font-semibold">{t("roundHeading", { round: receipt.cycle.toString() })}</h3>
      <dl className="grid gap-2">
        <div>
          <dt className="text-emerald-50/60">{t("winner")}</dt>
          <dd className="break-all font-mono text-xs">
            {receipt.winner === zeroAddress ? t("noWinner") : receipt.winner}
          </dd>
        </div>
        <div>
          <dt className="text-emerald-50/60">{t("winningDiscount")}</dt>
          <dd className="font-mono text-xs">
            {t("bps", { value: receipt.discountBps.toString() })} · {priced(receipt.dividend)}
          </dd>
        </div>
        <div>
          <dt className="text-emerald-50/60">{t("netPayout")}</dt>
          <dd className="font-mono text-xs">{priced(receipt.winnerPayout)}</dd>
        </div>
        <div>
          <dt className="text-emerald-50/60">{t("retained")}</dt>
          <dd className="font-mono text-xs">{priced(receipt.retained)}</dd>
        </div>
        <div>
          <dt className="text-emerald-50/60">{t("dividendEach")}</dt>
          <dd>
            {receipt.credits == null ? (
              <p className="text-emerald-50/70">{t("transfersNotRead")}</p>
            ) : receipt.credits.length === 0 ? (
              <p className="text-emerald-50/70">{t("noNonWinner")}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {receipt.credits.map((credit) => (
                  <li key={credit.account} className="break-all font-mono text-xs">
                    {credit.account} · {priced(credit.amount)}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
      {receipt.closeHash != null ? <TxLink chainId={chainId} hash={receipt.closeHash} kind="closing" /> : <p className="text-emerald-50/70">{t("closingMissing")}</p>}
      {receipt.settlementHash != null && !sameHash ? <TxLink chainId={chainId} hash={receipt.settlementHash} kind="settlement" /> : null}
      {badge.text != null ? (
        <p className="rounded-xl border border-emerald-300/80 bg-emerald-400/15 px-3 py-2 font-semibold text-emerald-100">
          {t(badge.text.key, badge.text.vars)}
        </p>
      ) : null}
      <p className="text-emerald-50/60">{t(badge.source.key, badge.source.vars)}</p>
      {receipt.duplicateLogs ? <p className="text-emerald-50/70">{t("duplicateLogs")}</p> : null}
      {receipt.notes.map((note, index) => (
        <p key={`${receipt.cycle.toString()}-${index}`} className="text-red-300">
          {"key" in note ? t(note.key) : format(note.error)}
        </p>
      ))}
    </article>
  );
}

export function RoundReceipts({
  samity,
  bidEngine,
  token,
  chainId,
  account,
  blockNumber,
  currentRound,
  phase,
  decimals,
  symbol,
}: RoundReceiptsProps) {
  const { t, format } = useI18n();
  const publicClient = usePublicClient({ chainId });
  const scopeKey = `${samity}:${chainId}:${currentRound?.toString() ?? ""}:${phase ?? ""}:${token ?? ""}:${bidEngine ?? ""}`;
  const [scope, setScope] = useState(scopeKey);
  const [data, setData] = useState<ReceiptLoad | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const loadedKey = useRef<string | null>(null);

  if (scope !== scopeKey) {
    setScope(scopeKey);
    setData(null);
    setError(null);
    loadedKey.current = null;
  }

  useEffect(() => {
    if (!publicClient || blockNumber == null || currentRound == null || phase == null) return;
    const key = `${scopeKey}:${attempt}`;
    if (loadedKey.current === key) return;
    let cancelled = false;
    const client = publicClient;
    void loadRoundReceipts(client as PublicClient, {
      samity,
      bidEngine,
      token,
      chainId,
      account,
      blockNumber,
      currentCycle: currentRound,
      phase,
    })
      .then((next) => {
        if (cancelled) return;
        loadedKey.current = key;
        setData(next);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        loadedKey.current = key;
        setError(caught);
      });
    return () => {
      cancelled = true;
    };
  }, [account, attempt, bidEngine, blockNumber, chainId, currentRound, phase, publicClient, samity, scopeKey, token]);

  const waiting = currentRound == null || phase == null || blockNumber == null || (data == null && error == null);

  return (
    <section className="flex flex-col gap-4 rounded-2xl samity-card border border-emerald-200/70 bg-emerald-950/40 p-5 text-sm">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t("receiptsTitle")}</h2>
        <p className="text-emerald-50/70">{t("receiptsBody")}</p>
      </header>
      {waiting ? <Skeleton className="inline-block h-4 w-48" /> : null}
      {error ? (
        <div className="flex flex-col gap-2">
          <p className="text-red-300">{format(error)}</p>
          <button
            type="button"
            className="w-fit rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950"
            onClick={() => {
              loadedKey.current = null;
              setError(null);
              setAttempt((value) => value + 1);
            }}
          >
            {t("tryAgain")}
          </button>
        </div>
      ) : null}
      {data != null && data.receipts.length === 0 ? <p className="text-emerald-50/70">{t("noRoundSettled")}</p> : null}
      {data != null && data.logError ? <p className="text-red-300">{format(data.logError)}</p> : null}
      {data != null &&
      data.fromBlock != null &&
      data.toBlock != null &&
      data.receipts.some((receipt) => receipt.settled && (receipt.closeHash == null || receipt.settlementHash == null)) ? (
        <p className="text-emerald-50/70">
          {t("searchWindow", { from: data.fromBlock.toString(), to: data.toBlock.toString() })}
        </p>
      ) : null}
      {data != null
        ? data.receipts.map((receipt) => (
            <ReceiptCard key={receipt.cycle.toString()} receipt={receipt} chainId={chainId} decimals={decimals} symbol={symbol} />
          ))
        : null}
    </section>
  );
}
