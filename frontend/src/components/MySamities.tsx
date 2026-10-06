"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { Skeleton } from "@/src/components/Skeleton";
import { isSupportedChainId } from "@/src/config/cofhe";
import { errorText } from "@/src/lib/errors";
import { loadMySamities, type MySamityRow } from "@/src/lib/mySamities";

function installmentText(row: MySamityRow): string {
  if (row.decimals == null) return `${row.installmentAmount.toString()} base units`;
  const formatted = formatUnits(row.installmentAmount, row.decimals);
  return row.symbol ? `${formatted} ${row.symbol}` : formatted;
}

export function MySamities() {
  const { address, isConnected, chainId } = useAccount();
  const supported = isSupportedChainId(chainId);
  const client = usePublicClient({ chainId: supported ? chainId : undefined });
  const enabled = Boolean(client && address && supported);

  const scan = useQuery({
    queryKey: ["my-samities", chainId ?? null, address ?? null],
    enabled,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: () => {
      if (!client || !address) throw new Error("Connect wallet first");
      return loadMySamities(client, address);
    },
  });

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

      {enabled && scan.isLoading && !scan.isError ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="block h-16 w-full" />
          <Skeleton className="block h-16 w-full" />
        </div>
      ) : null}

      {enabled && scan.isError ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-emerald-50">No samities found.</p>
          <p className="text-sm text-red-300">{errorText(scan.error)}</p>
          <button
            type="button"
            className="w-full rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950"
            onClick={() => {
              void scan.refetch();
            }}
          >
            Try again
          </button>
        </div>
      ) : null}

      {scan.data ? (
        <div className="flex flex-col gap-3">
          {scan.data.limited ? (
            <p className="text-sm text-emerald-50/70">
              This list is limited to blocks {scan.data.fromBlock.toString()}–{scan.data.toBlock.toString()}. The RPC
              rejected a full-history log query, so older samities may be missing.
            </p>
          ) : null}
          {scan.data.rows.length === 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-emerald-50">No samities found.</p>
              <Link
                href="#create-samity"
                className="w-full rounded-lg bg-emerald-400 px-4 py-2 text-center text-sm font-semibold text-emerald-950"
              >
                Create a samity
              </Link>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {scan.data.rows.map((row) => (
                <li key={row.address}>
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
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
