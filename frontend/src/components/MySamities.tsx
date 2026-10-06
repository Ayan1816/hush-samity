"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { Skeleton } from "@/src/components/Skeleton";
import { isSupportedChainId } from "@/src/config/cofhe";
import { errorText } from "@/src/lib/errors";
import {
  loadMySamities,
  mergeSamityRows,
  mySamitiesQueryKey,
  readCachedScan,
  readDeployedSamities,
  subscribeSamityCache,
  type MySamityRow,
} from "@/src/lib/mySamities";

/** One automatic log scan per wallet per page session. Retry is the only way to scan again. */
const autoLoaded = new Set<string>();

function installmentText(row: MySamityRow): string {
  if (row.decimals == null) return `${row.installmentAmount.toString()} base units`;
  const formatted = formatUnits(row.installmentAmount, row.decimals);
  return row.symbol ? `${formatted} ${row.symbol}` : formatted;
}

export function MySamities() {
  const queryClient = useQueryClient();
  const { address, isConnected, chainId } = useAccount();
  const supported = isSupportedChainId(chainId);
  const walletReady = Boolean(address && supported && chainId != null);
  const [cacheTick, setCacheTick] = useState(0);

  useEffect(() => subscribeSamityCache(() => setCacheTick((tick) => tick + 1)), []);

  const scan = useQuery({
    queryKey: ["my-samities", chainId ?? null, address ?? null],
    enabled: false,
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: () => {
      if (!address || chainId == null) throw new Error("Connect wallet first");
      return loadMySamities(address, chainId);
    },
  });

  useEffect(() => {
    if (!walletReady || !address || chainId == null) return;
    const queryKey = mySamitiesQueryKey(chainId, address);
    const sessionKey = `${chainId}:${address.toLowerCase()}`;
    if (queryClient.getQueryData(queryKey) != null) return;
    const stored = readCachedScan(chainId, address);
    if (stored) {
      queryClient.setQueryData(queryKey, stored);
      autoLoaded.add(sessionKey);
      return;
    }
    if (autoLoaded.has(sessionKey)) return;
    if (queryClient.getQueryState(queryKey)?.fetchStatus === "fetching") return;
    autoLoaded.add(sessionKey);
    void queryClient
      .fetchQuery({
        queryKey,
        retry: false,
        staleTime: Infinity,
        queryFn: () => loadMySamities(address, chainId),
      })
      .catch(() => undefined);
  }, [address, chainId, queryClient, walletReady]);

  const cached =
    walletReady && address && chainId != null && cacheTick >= 0 ? readCachedScan(chainId, address) : null;
  const saved = walletReady && address && chainId != null ? readDeployedSamities(chainId, address) : [];
  const rows = mergeSamityRows(scan.data?.rows ?? cached?.rows ?? [], saved);
  const failed = scan.isError;
  const hasResult = scan.data != null || cached != null || saved.length > 0;
  const visibleRows = failed && !hasResult ? [] : rows;
  const showSkeletons =
    walletReady && !failed && cached == null && visibleRows.length === 0 && (scan.isPending || scan.isFetching);

  function retry() {
    if (!address || chainId == null) return;
    void queryClient
      .fetchQuery({
        queryKey: mySamitiesQueryKey(chainId, address),
        retry: false,
        staleTime: 0,
        queryFn: () => loadMySamities(address, chainId),
      })
      .catch(() => undefined);
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl samity-card border border-emerald-200/70 bg-emerald-950/40 p-5">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">My samities</h2>
        <p className="text-sm text-emerald-50/70">
          Samities this wallet created or joined, read from chain logs. A created samity is one whose first cycle
          opened on-chain and whose creator is this account.
        </p>
      </header>

      {!isConnected ? <p className="text-sm text-emerald-50/70">Connect wallet first</p> : null}
      {isConnected && !supported ? <p className="text-sm text-emerald-50/70">Switch to Sepolia</p> : null}

      {showSkeletons ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="block h-16 w-full" />
          <Skeleton className="block h-16 w-full" />
        </div>
      ) : null}

      {walletReady && failed ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-red-300">{errorText(scan.error)}</p>
          <button
            type="button"
            className="w-full rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:cursor-not-allowed disabled:bg-emerald-950 disabled:text-emerald-50"
            disabled={scan.isFetching}
            onClick={retry}
          >
            {scan.isFetching ? "Trying again" : "Try again"}
          </button>
        </div>
      ) : null}

      {walletReady && !failed && !showSkeletons && (scan.isSuccess || cached != null) && visibleRows.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-emerald-50">No samities found.</p>
          <Link
            href="#create-samity"
            className="w-full rounded-lg bg-emerald-400 px-4 py-2 text-center text-sm font-semibold text-emerald-950"
          >
            Create a samity
          </Link>
        </div>
      ) : null}

      {visibleRows.length > 0 ? (
        <div className="flex flex-col gap-3">
          {scan.data?.limited && !failed ? (
            <p className="text-sm text-emerald-50/70">
              This list starts at block {scan.data.fromBlock.toString()}. No earlier deployment block is saved in this
              browser, so older samities may be missing.
            </p>
          ) : null}
          <ul className="flex flex-col gap-2">
            {visibleRows.map((row) => (
              <li key={row.address}>
                <SamityLink row={row} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function SamityLink({ row }: { row: MySamityRow }) {
  return (
    <Link
      href={`/samity/${row.address}`}
      className="flex flex-col gap-1 rounded-xl border border-emerald-200/20 bg-black/20 p-3"
    >
      <span className="flex flex-col gap-1 text-sm sm:flex-row sm:items-baseline sm:justify-between">
        <span className="font-semibold">{row.role}</span>
        <span>
          {installmentText(row)} installment · {row.memberCap.toString()} member cap
        </span>
      </span>
      <span className="break-all font-mono text-xs text-emerald-50/70">{row.address}</span>
    </Link>
  );
}
