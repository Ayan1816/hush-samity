"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { encodeFunctionData, formatUnits, getAddress, isAddress, zeroAddress, type Address, type PublicClient } from "viem";
import {
  useAccount,
  useBlock,
  useBlockNumber,
  useBytecode,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useWalletClient,
} from "wagmi";
import { MyBid } from "@/src/components/MyBid";
import { SealBid } from "@/src/components/SealBid";
import { Skeleton } from "@/src/components/Skeleton";
import { pushToast } from "@/src/components/Toast";
import { bidEngineAbi, collateralAbi, erc20Abi, phaseName, samityAbi } from "@/src/lib/abis";
import { encodeErc20Approve, MAX_UINT256, spenderApprovalAmount } from "@/src/lib/approve";
import { isSupportedChainId } from "@/src/config/cofhe";
import { errorText } from "@/src/lib/errors";
import { sendTransactionHash, waitForSuccess } from "@/src/lib/receipt";

type ReadRow = {
  status: "success" | "failure";
  result?: unknown;
  error?: unknown;
};

function succeeded<T>(row: ReadRow | undefined): T | undefined {
  if (!row || row.status !== "success") return undefined;
  return row.result as T;
}

function failure(row: ReadRow | undefined): string | null {
  if (!row || row.status !== "failure") return null;
  return errorText(row.error);
}

const quietRead = { placeholderData: keepPreviousData };

type LocalAllowance = {
  amount: bigint;
  mode: "raise" | "lower";
  /** Last chain value that is still from before this local adjustment. */
  staleChain?: bigint;
};

type MemberFlags = {
  isMember?: boolean;
  hasLocked?: boolean;
  hasPaid?: boolean;
};

function spendKey(spender: Address): string {
  return spender.toLowerCase();
}

function formatToken(amount: bigint, decimals: number, symbol: string | undefined): string {
  const raw = formatUnits(amount, decimals);
  const trimmed = raw.includes(".") ? raw.replace(/0+$/, "").replace(/\.$/, "") : raw;
  const text = trimmed === "" ? "0" : trimmed;
  return symbol ? `${text} ${symbol}` : text;
}

function amountText(amount: bigint, decimals: number | undefined, symbol: string | undefined): string {
  if (amount === MAX_UINT256) return "the maximum allowance";
  if (decimals == null) return "Reading…";
  return formatToken(amount, decimals, symbol);
}

function shownAllowance(chain: bigint | undefined, local: LocalAllowance | undefined): bigint | undefined {
  if (!local) return chain;
  if (chain == null) return local.amount;
  if (local.mode === "raise") return chain >= local.amount ? chain : local.amount;
  if (local.staleChain != null && chain === local.staleChain) return local.amount;
  if (chain > local.amount) return local.amount;
  return chain;
}

function localStillNeeded(chain: bigint | undefined, local: LocalAllowance | undefined): boolean {
  if (!local) return false;
  if (chain == null) return true;
  if (local.mode === "raise") return chain < local.amount;
  if (local.staleChain != null && chain === local.staleChain) return true;
  return chain > local.amount;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeText(value: bigint): string {
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds)) return value.toString();
  return `${value.toString()} · ${new Date(seconds * 1000).toISOString()}`;
}

function bidBlockedReason(input: {
  address: Address | undefined;
  windowKnown: boolean;
  windowClosed: boolean;
  phase: number | undefined;
  isMember: boolean | undefined;
  slashed: boolean | undefined;
  hasWon: boolean | undefined;
  hasLocked: boolean | undefined;
  hasPaid: boolean | undefined;
  canBid: boolean | undefined;
  hasSubmitted: boolean | undefined;
  submittedError: string | null;
  readingSubmission: boolean;
}): string | null {
  if (input.address == null) return "Connect the wallet that will bid.";
  if (!input.windowKnown) return "Waiting for the latest block timestamp.";
  if (input.windowClosed) return "This cycle's window is closed.";
  if (input.phase == null || input.isMember == null || input.hasLocked == null || input.hasPaid == null || input.canBid == null) {
    return "Reading membership and the bidding window.";
  }
  if (input.phase !== 0) return "Bidding is not open in this phase.";
  if (!input.isMember) return "Join the samity before bidding.";
  if (input.slashed) return "This member is slashed and cannot bid.";
  if (input.hasWon) return "This member already won a cycle and cannot bid again.";
  if (!input.hasLocked) return "Lock collateral before bidding.";
  if (!input.hasPaid) return "Pay the installment before bidding.";
  if (input.submittedError) return input.submittedError;
  if (input.readingSubmission || input.hasSubmitted == null) return "Reading whether this wallet already bid.";
  if (input.hasSubmitted) return "This wallet already submitted a bid for this cycle.";
  if (!input.canBid) return "This account cannot bid right now.";
  return null;
}

export function SamityDesk({ samity }: { samity: Address }) {
  const { address, chain } = useAccount();
  const chainId = isSupportedChainId(chain?.id) ? chain.id : undefined;
  const ready = chainId != null;
  const alive = useRef(true);
  const refreshGeneration = useRef(0);
  const seenText = useRef(new Map<string, string>());
  const seenDecimals = useRef<number | undefined>(undefined);
  const seenSymbol = useRef<string | undefined>(undefined);
  const [locals, setLocals] = useState<Record<string, LocalAllowance>>({});
  const [memberOverride, setMemberOverride] = useState<MemberFlags | null>(null);
  const [bidSent, setBidSent] = useState(false);

  const codeQuery = useBytecode({
    address: samity,
    chainId,
    query: { enabled: ready, ...quietRead },
  });
  const hasCode = codeQuery.data != null && codeQuery.data !== "0x";

  const blockNumberQuery = useBlockNumber({
    chainId,
    watch: true,
    query: { enabled: ready && hasCode, ...quietRead },
  });
  const blockNumber = blockNumberQuery.data;
  const blockQuery = useBlock({
    chainId,
    blockNumber,
    query: { enabled: ready && blockNumber != null, ...quietRead },
  });

  const publicQuery = useReadContracts({
    allowFailure: true,
    blockNumber,
    contracts: [
      { address: samity, chainId, abi: samityAbi, functionName: "currentCycle" },
      { address: samity, chainId, abi: samityAbi, functionName: "totalCycles" },
      { address: samity, chainId, abi: samityAbi, functionName: "phase" },
      { address: samity, chainId, abi: samityAbi, functionName: "collectedPot" },
      { address: samity, chainId, abi: samityAbi, functionName: "token" },
      { address: samity, chainId, abi: samityAbi, functionName: "bidEngine" },
      { address: samity, chainId, abi: samityAbi, functionName: "collateral" },
      { address: samity, chainId, abi: samityAbi, functionName: "installmentAmount" },
      { address: samity, chainId, abi: samityAbi, functionName: "collateralAmount" },
      { address: samity, chainId, abi: samityAbi, functionName: "cycleDeadline" },
      { address: samity, chainId, abi: samityAbi, functionName: "memberCount" },
      { address: samity, chainId, abi: samityAbi, functionName: "memberCap" },
      { address: samity, chainId, abi: samityAbi, functionName: "maxDiscountCap" },
    ],
    query: { enabled: ready && hasCode && blockNumber != null, ...quietRead },
  });

  const userQuery = useReadContracts({
    allowFailure: true,
    blockNumber,
    contracts: address
      ? [
          { address: samity, chainId, abi: samityAbi, functionName: "isMember", args: [address] },
          { address: samity, chainId, abi: samityAbi, functionName: "slashed", args: [address] },
          { address: samity, chainId, abi: samityAbi, functionName: "hasLocked", args: [address] },
          { address: samity, chainId, abi: samityAbi, functionName: "hasPaid", args: [address] },
          { address: samity, chainId, abi: samityAbi, functionName: "hasWon", args: [address] },
          { address: samity, chainId, abi: samityAbi, functionName: "canBid", args: [address] },
        ]
      : [],
    query: { enabled: ready && hasCode && address != null && blockNumber != null, ...quietRead },
  });

  const rows = publicQuery.data as ReadRow[] | undefined;
  const userRows = userQuery.data as ReadRow[] | undefined;
  const currentCycle = succeeded<bigint>(rows?.[0]);
  const totalCycles = succeeded<bigint>(rows?.[1]);
  const phase = succeeded<number>(rows?.[2]);
  const collectedPot = succeeded<bigint>(rows?.[3]);
  const token = succeeded<Address>(rows?.[4]);
  const bidEngine = succeeded<Address>(rows?.[5]);
  const collateral = succeeded<Address>(rows?.[6]);
  const installmentAmount = succeeded<bigint>(rows?.[7]);
  const collateralAmount = succeeded<bigint>(rows?.[8]);
  const cycleDeadline = succeeded<bigint>(rows?.[9]);
  const memberCount = succeeded<bigint>(rows?.[10]);
  const memberCap = succeeded<bigint>(rows?.[11]);
  const maxDiscountCap = succeeded<number>(rows?.[12]);

  const tokenReady = token != null && isAddress(token) && token !== zeroAddress;
  const collateralReady = collateral != null && isAddress(collateral) && collateral !== zeroAddress;
  const engineReady = bidEngine != null && isAddress(bidEngine) && bidEngine !== zeroAddress;

  const decimalsQuery = useReadContract({
    address: tokenReady ? token : undefined,
    abi: erc20Abi,
    functionName: "decimals",
    chainId,
    blockNumber,
    query: { enabled: ready && tokenReady && blockNumber != null, ...quietRead },
  });
  const symbolQuery = useReadContract({
    address: tokenReady ? token : undefined,
    abi: erc20Abi,
    functionName: "symbol",
    chainId,
    blockNumber,
    query: { enabled: ready && tokenReady && blockNumber != null, ...quietRead },
  });
  const balanceQuery = useReadContract({
    address: tokenReady ? token : undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId,
    blockNumber,
    query: { enabled: ready && tokenReady && address != null && blockNumber != null, ...quietRead },
  });
  const lockedQuery = useReadContract({
    address: collateralReady ? collateral : undefined,
    abi: collateralAbi,
    functionName: "locked",
    args: address ? [address] : undefined,
    chainId,
    blockNumber,
    query: { enabled: ready && collateralReady && address != null && blockNumber != null, ...quietRead },
  });

  if (typeof decimalsQuery.data === "number") seenDecimals.current = decimalsQuery.data;
  if (typeof symbolQuery.data === "string" && symbolQuery.data !== "") seenSymbol.current = symbolQuery.data;
  const decimals = typeof decimalsQuery.data === "number" ? decimalsQuery.data : seenDecimals.current;
  const symbol = typeof symbolQuery.data === "string" && symbolQuery.data !== "" ? symbolQuery.data : seenSymbol.current;
  const chainIsMember = succeeded<boolean>(userRows?.[0]);
  const slashed = succeeded<boolean>(userRows?.[1]);
  const chainHasLocked = succeeded<boolean>(userRows?.[2]);
  const chainHasPaid = succeeded<boolean>(userRows?.[3]);
  const hasWon = succeeded<boolean>(userRows?.[4]);
  const isMember = memberOverride?.isMember ?? chainIsMember;
  const hasLocked = memberOverride?.hasLocked ?? chainHasLocked;
  const hasPaid = memberOverride?.hasPaid ?? chainHasPaid;
  const canBid = succeeded<boolean>(userRows?.[5]);
  const blockTimestamp = blockQuery.data?.timestamp;
  const windowKnown = cycleDeadline != null && blockTimestamp != null;
  const windowClosed = windowKnown && blockTimestamp >= cycleDeadline;

  const submittedQuery = useReadContract({
    address: engineReady ? bidEngine : undefined,
    abi: bidEngineAbi,
    functionName: "hasSubmitted",
    args: address ? [address] : undefined,
    chainId,
    blockNumber,
    query: { enabled: ready && engineReady && address != null && blockNumber != null, ...quietRead },
  });
  const hasSubmitted = submittedQuery.data;
  const blockedReason = bidBlockedReason({
    address,
    windowKnown,
    windowClosed,
    phase,
    isMember,
    slashed,
    hasWon,
    hasLocked,
    hasPaid,
    canBid,
    hasSubmitted,
    submittedError: submittedQuery.isError ? errorText(submittedQuery.error) : null,
    readingSubmission: address != null && engineReady && submittedQuery.isLoading,
  });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (hasSubmitted) setBidSent(false);
  }, [hasSubmitted]);

  useEffect(() => {
    setMemberOverride((current) => {
      if (!current) return current;
      const memberOk = current.isMember == null || current.isMember === chainIsMember;
      const lockedOk = current.hasLocked == null || current.hasLocked === chainHasLocked;
      const paidOk = current.hasPaid == null || current.hasPaid === chainHasPaid;
      return memberOk && lockedOk && paidOk ? null : current;
    });
  }, [chainHasLocked, chainHasPaid, chainIsMember]);

  const raiseAllowance = useCallback((spender: Address, amount: bigint) => {
    setLocals((current) => ({
      ...current,
      [spendKey(spender)]: { amount, mode: "raise" },
    }));
  }, []);

  const lowerAllowance = useCallback((spender: Address, spent: bigint, chain: bigint | undefined) => {
    setLocals((current) => {
      const key = spendKey(spender);
      const existing = current[key];
      const base = existing ? existing.amount : chain;
      if (base == null) return current;
      const amount = base > spent ? base - spent : 0n;
      return {
        ...current,
        [key]: { amount, mode: "lower", staleChain: chain },
      };
    });
  }, []);

  const clearAllowance = useCallback((spender: Address) => {
    setLocals((current) => {
      const key = spendKey(spender);
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  function remember(key: string, next: string): string {
    if (next === "Reading…") return seenText.current.get(key) ?? next;
    seenText.current.set(key, next);
    return next;
  }

  function scheduleRefresh() {
    const generation = ++refreshGeneration.current;
    void (async () => {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await sleep(1500);
        if (!alive.current || refreshGeneration.current !== generation) return;
        await blockNumberQuery.refetch();
      }
    })();
  }

  function publish(kind?: "join" | "lockCollateral" | "payInstallment") {
    if (kind === "join") setMemberOverride((current) => ({ ...current, isMember: true, hasLocked: true }));
    if (kind === "lockCollateral") setMemberOverride((current) => ({ ...current, hasLocked: true }));
    if (kind === "payInstallment") setMemberOverride((current) => ({ ...current, hasPaid: true }));
    void blockNumberQuery.refetch();
    scheduleRefresh();
  }

  const cycles = totalCycles != null && totalCycles > 0n ? totalCycles : null;
  const collateralApprove =
    cycles != null && collateralAmount != null && collateralAmount > 0n && installmentAmount != null && installmentAmount > 0n
      ? spenderApprovalAmount("collateral", collateralAmount, installmentAmount, cycles)
      : null;
  const installmentApprove =
    cycles != null && collateralAmount != null && collateralAmount > 0n && installmentAmount != null && installmentAmount > 0n
      ? spenderApprovalAmount("installment", collateralAmount, installmentAmount, cycles)
      : null;

  const showActions =
    ready &&
    chainId != null &&
    tokenReady &&
    collateralReady &&
    collateralApprove != null &&
    installmentApprove != null &&
    installmentAmount != null &&
    collateralAmount != null &&
    phase != null &&
    currentCycle != null &&
    address != null &&
    isMember != null &&
    slashed != null &&
    hasLocked != null &&
    hasPaid != null;

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Samity</h1>
        <p className="break-all font-mono text-xs text-emerald-50/70">{samity}</p>
        <p className="text-sm text-emerald-50/70">
          {chainId == null
            ? "Connect a wallet on Ethereum Sepolia, Arbitrum Sepolia, or Base Sepolia. Reads use that chain."
            : `Reading ${chain?.name ?? chainId}.`}
        </p>
      </header>

      {!ready ? null : codeQuery.isLoading && codeQuery.data == null ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-busy="true">
          {["code-a", "code-b", "code-c", "code-d"].map((key) => (
            <div key={key} className="flex flex-col gap-2">
              <Skeleton className="inline-block h-3 w-20" />
              <Skeleton className="inline-block h-4 w-32" />
            </div>
          ))}
        </div>
      ) : codeQuery.isError ? (
        <p className="text-sm text-red-300">{errorText(codeQuery.error)}</p>
      ) : !hasCode ? (
        <p className="text-sm text-emerald-50/70">No contract code at this address on {chain?.name}.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 rounded-2xl samity-card border border-emerald-200/70 bg-emerald-950/40 p-5 text-sm sm:grid-cols-2">
            <Stat
              label="Round"
              value={remember(
                "round",
                failure(rows?.[0]) ??
                  (currentCycle == null || totalCycles == null
                    ? "Reading…"
                    : `${currentCycle.toString()} of ${totalCycles.toString()}`),
              )}
            />
            <Stat label="Phase" value={remember("phase", failure(rows?.[2]) ?? (phase == null ? "Reading…" : phaseName(phase)))} />
            <Stat
              label="Pool"
              value={remember(
                "pool",
                failure(rows?.[3]) ?? (collectedPot == null ? "Reading…" : amountText(collectedPot, decimals, symbol)),
              )}
            />
            <Stat
              label="Your locked collateral"
              value={remember(
                "locked",
                address == null
                  ? "Connect a wallet."
                  : lockedQuery.data == null
                    ? lockedQuery.isError
                      ? errorText(lockedQuery.error)
                      : "Reading…"
                    : amountText(lockedQuery.data, decimals, symbol),
              )}
            />
            <Stat
              label="Deadline"
              value={remember("deadline", failure(rows?.[9]) ?? (cycleDeadline == null ? "Reading…" : timeText(cycleDeadline)))}
            />
            <Stat
              label="Chain time"
              value={remember(
                "chain-time",
                blockQuery.data == null
                  ? blockQuery.isError
                    ? errorText(blockQuery.error)
                    : "Reading…"
                  : timeText(blockQuery.data.timestamp),
              )}
            />
            <Stat
              label="Members"
              value={remember(
                "members",
                failure(rows?.[10]) ??
                  (memberCount == null || memberCap == null
                    ? "Reading…"
                    : `${memberCount.toString()} of ${memberCap.toString()}`),
              )}
            />
            <Stat
              label="Installment"
              value={remember(
                "installment",
                failure(rows?.[7]) ?? (installmentAmount == null ? "Reading…" : amountText(installmentAmount, decimals, symbol)),
              )}
            />
            <Stat
              label="Collateral required"
              value={remember(
                "collateral",
                failure(rows?.[8]) ?? (collateralAmount == null ? "Reading…" : amountText(collateralAmount, decimals, symbol)),
              )}
            />
            <Stat
              label="Max discount"
              value={remember(
                "discount",
                failure(rows?.[12]) ?? (maxDiscountCap == null ? "Reading…" : `${maxDiscountCap.toString()} bps`),
              )}
            />
            <Stat
              label="Your token balance"
              value={remember(
                "balance",
                address == null
                  ? "Connect a wallet."
                  : balanceQuery.data == null
                    ? balanceQuery.isError
                      ? errorText(balanceQuery.error)
                      : "Reading…"
                    : amountText(balanceQuery.data, decimals, symbol),
              )}
            />
            <Stat
              label="Your seat"
              value={remember(
                "seat",
                address == null
                  ? "Connect a wallet."
                  : failure(userRows?.[0]) ??
                    (isMember == null
                      ? "Reading…"
                      : !isMember
                        ? "Not a member."
                        : slashed
                          ? "Slashed."
                          : `Member. Locked this cycle: ${String(hasLocked)}. Paid: ${String(hasPaid)}. Won a round: ${String(hasWon)}.`),
              )}
            />
          </div>

          {showActions && token != null && collateral != null ? (
            <section className="flex flex-col gap-3">
              {!windowKnown ? <p className="text-sm text-emerald-50/70">Waiting for the latest block timestamp.</p> : null}
              {windowClosed ? (
                <p className="text-sm text-emerald-50/70">
                  This cycle&apos;s window is closed. Join, collateral, payment, and bids are no longer accepted.
                </p>
              ) : null}
              {windowKnown && !windowClosed && isMember === false && phase === 0 && currentCycle === 1n ? (
                <PullAndCall
                  title="Join and lock collateral"
                  buttonLabel="Join"
                  token={token}
                  samity={samity}
                  chainId={chainId}
                  functionName="join"
                  decimals={decimals}
                  symbol={symbol}
                  locals={locals}
                  spends={[
                    {
                      spender: collateral,
                      need: collateralApprove,
                      approve: collateralApprove,
                      spentOnSuccess: collateralAmount,
                      title: "Collateral",
                    },
                    {
                      spender: samity,
                      need: installmentApprove,
                      approve: installmentApprove,
                      spentOnSuccess: 0n,
                      title: "Installments",
                    },
                  ]}
                  onRaise={raiseAllowance}
                  onSpend={lowerAllowance}
                  onClear={clearAllowance}
                  onDone={() => publish("join")}
                />
              ) : null}
              {windowKnown && !windowClosed && isMember && slashed === false && hasLocked === false && phase === 0 ? (
                <PullAndCall
                  title="Lock collateral"
                  buttonLabel="Lock collateral"
                  token={token}
                  samity={samity}
                  chainId={chainId}
                  functionName="lockCollateral"
                  decimals={decimals}
                  symbol={symbol}
                  locals={locals}
                  spends={[
                    {
                      spender: collateral,
                      need: collateralAmount,
                      approve: collateralApprove,
                      spentOnSuccess: collateralAmount,
                      title: "Collateral",
                    },
                  ]}
                  onRaise={raiseAllowance}
                  onSpend={lowerAllowance}
                  onClear={clearAllowance}
                  onDone={() => publish("lockCollateral")}
                />
              ) : null}
              {windowKnown && !windowClosed && isMember && slashed === false && hasLocked === true && hasPaid === false && phase === 0 ? (
                <PullAndCall
                  title="Pay installment"
                  buttonLabel="Pay installment"
                  token={token}
                  samity={samity}
                  chainId={chainId}
                  functionName="payInstallment"
                  decimals={decimals}
                  symbol={symbol}
                  locals={locals}
                  spends={[
                    {
                      spender: samity,
                      need: installmentAmount,
                      approve: installmentApprove,
                      spentOnSuccess: installmentAmount,
                      title: "Installments",
                    },
                  ]}
                  onRaise={raiseAllowance}
                  onSpend={lowerAllowance}
                  onClear={clearAllowance}
                  onDone={() => publish("payInstallment")}
                />
              ) : null}
              {phase === 0 ? (
                <CloseCycle
                  samity={samity}
                  chainId={chainId}
                  blockReady={blockQuery.data != null}
                  windowClosed={windowClosed}
                  onDone={() => publish()}
                />
              ) : null}
            </section>
          ) : null}

          {engineReady && bidEngine != null && chainId != null ? (
            <section className="flex flex-col gap-4">
              <p className="break-all text-sm text-emerald-50/70">
                BidEngine {bidEngine}. canBid:{" "}
                {address == null ? (
                  "connect a wallet"
                ) : failure(userRows?.[5]) ? (
                  failure(userRows?.[5])
                ) : canBid == null ? (
                  <Skeleton className="inline-block h-3 w-16 align-middle" />
                ) : (
                  String(canBid)
                )}
              </p>
              <SealedBidSubmit
                bidEngine={bidEngine}
                samity={samity}
                chainId={chainId}
                blockedReason={bidSent ? "This wallet already submitted a bid for this cycle." : blockedReason}
                onDone={() => {
                  setBidSent(true);
                  publish();
                }}
              />
              <MyBid bidEngineAddress={bidEngine} />
            </section>
          ) : (blockNumber == null || publicQuery.isLoading) && publicQuery.data == null ? (
            <Skeleton className="inline-block h-4 w-40" />
          ) : (
            <p className="text-sm text-emerald-50/70">{failure(rows?.[5]) ?? "BidEngine is unavailable."}</p>
          )}
        </>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-emerald-50/60">{label}</p>
      {value === "Reading…" ? (
        <Skeleton className="inline-block h-4 w-28" />
      ) : (
        <p className="break-all font-mono text-xs">{value}</p>
      )}
    </div>
  );
}

type Spend = {
  spender: Address;
  need: bigint;
  approve: bigint;
  spentOnSuccess: bigint;
  title: string;
};

function useSpenderAllowance(
  token: Address,
  owner: Address | undefined,
  spender: Address | undefined,
  chainId: number,
  enabled: boolean,
) {
  return useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: owner && spender ? [owner, spender] : undefined,
    chainId,
    query: {
      enabled: enabled && owner != null && spender != null,
      ...quietRead,
    },
  });
}

function PullAndCall({
  title,
  buttonLabel,
  token,
  samity,
  chainId,
  functionName,
  decimals,
  symbol,
  locals,
  spends,
  onRaise,
  onSpend,
  onClear,
  onDone,
}: {
  title: string;
  buttonLabel: string;
  token: Address;
  samity: Address;
  chainId: number;
  functionName: "join" | "lockCollateral" | "payInstallment";
  decimals: number | undefined;
  symbol: string | undefined;
  locals: Record<string, LocalAllowance>;
  spends: readonly Spend[];
  onRaise: (spender: Address, amount: bigint) => void;
  onSpend: (spender: Address, spent: bigint, chain: bigint | undefined) => void;
  onClear: (spender: Address) => void;
  onDone: () => void;
}) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId });
  const { data: walletClient } = useWalletClient({ chainId });
  const alive = useRef(true);
  const first = spends[0];
  const second = spends[1];
  const firstQuery = useSpenderAllowance(token, address, first?.spender, chainId, first != null);
  const secondQuery = useSpenderAllowance(token, address, second?.spender, chainId, second != null);
  const [phase, setPhase] = useState<"idle" | "wallet" | "mining">("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queries = [firstQuery, secondQuery];
  const reads = spends.map((spend, index) => {
    const query = queries[index];
    const chain = query?.data;
    const local = locals[spendKey(spend.spender)];
    return { spend, chain, local, shown: shownAllowance(chain, local), query };
  });
  const needsApproval = reads.some((read) => read.shown != null && read.shown < read.spend.need);
  const waitingAllowance = reads.some((read) => read.shown == null);
  const busy = phase !== "idle";

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    for (const read of reads) {
      if (read.local && !localStillNeeded(read.chain, read.local)) onClear(read.spend.spender);
    }
  }, [firstQuery.data, secondQuery.data, locals, onClear, reads]);

  async function pollAllowances() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await sleep(1000);
      if (!alive.current) return;
      await firstQuery.refetch();
      if (second) await secondQuery.refetch();
    }
  }

  async function run() {
    if (!address || !publicClient || !walletClient || !first) {
      setError("Connect a wallet on this chain.");
      return;
    }
    setError(null);
    setHash(null);
    try {
      const owner = getAddress(address);
      const deadline = await publicClient.readContract({
        address: samity,
        abi: samityAbi,
        functionName: "cycleDeadline",
      });
      const block = await publicClient.getBlock();
      if (block.timestamp >= deadline) throw new Error("This cycle's window is closed.");

      const snapshot = spends.map((spend, index) => {
        const chain = index === 0 ? firstQuery.data : secondQuery.data;
        const local = locals[spendKey(spend.spender)];
        return { spend, chain, shown: shownAllowance(chain, local) };
      });
      if (snapshot.some((item) => item.shown == null)) {
        const failed = reads.find((read) => read.shown == null && read.query?.isError);
        setError(failed?.query?.error ? errorText(failed.query.error) : "Waiting for the allowance.");
        return;
      }
      const short = snapshot.filter((item) => (item.shown ?? 0n) < item.spend.need);
      if (short.length > 0) {
        for (const item of short) {
          const approval = encodeErc20Approve(token, item.spend.spender, item.spend.approve);
          setPhase("wallet");
          setDetail(`Confirm the ${item.spend.title.toLowerCase()} approval in your wallet.`);
          await publicClient.call({
            account: owner,
            to: approval.to,
            data: approval.data,
            value: approval.value,
          });
          const approveHash = await sendTransactionHash(walletClient, {
            account: owner,
            to: approval.to,
            data: approval.data,
            value: approval.value,
          });
          setHash(approveHash);
          setPhase("mining");
          setDetail(`Waiting for the ${item.spend.title.toLowerCase()} approval.`);
          await waitForSuccess(publicClient, approveHash);
          onRaise(item.spend.spender, item.spend.approve);
        }
        setPhase("idle");
        setDetail(null);
        pushToast("Token approval confirmed.", "ok");
        void pollAllowances();
        return;
      }

      setPhase("wallet");
      setDetail(`Confirm ${buttonLabel} in your wallet.`);
      const data = encodeFunctionData({ abi: samityAbi, functionName });
      const txHash = await sendTransactionHash(walletClient, { account: owner, to: samity, data });
      setHash(txHash);
      setPhase("mining");
      setDetail(`Waiting for ${buttonLabel}.`);
      await waitForSuccess(publicClient, txHash);
      for (const item of snapshot) {
        if (item.spend.spentOnSuccess > 0n) onSpend(item.spend.spender, item.spend.spentOnSuccess, item.chain);
      }
      const doneText =
        functionName === "join" ? "Joined the samity." : functionName === "lockCollateral" ? "Collateral locked." : "Installment paid.";
      onDone();
      setPhase("idle");
      setDetail(null);
      pushToast(doneText, "ok");
      void pollAllowances();
    } catch (caught) {
      setPhase("idle");
      setDetail(null);
      const message = errorText(caught);
      setError(message);
      pushToast(message, "err");
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl samity-card border border-emerald-200/70 bg-emerald-950/40 p-5 text-sm">
      <p className="font-semibold">{title}</p>
      <p className="text-emerald-50/70">
        {needsApproval
          ? "One approval covers this samity. Pay installment will not ask for another approval. "
          : null}
        {reads.map((read) => {
          const short = read.shown != null && read.shown < read.spend.need;
          return (
            <span key={read.spend.spender}>
              {read.spend.title}{" "}
              {read.shown == null ? (
                read.query?.isError && read.query.data == null ? (
                  errorText(read.query.error)
                ) : (
                  <Skeleton className="inline-block h-3 w-24 align-middle" />
                )
              ) : (
                amountText(read.shown, decimals, symbol)
              )}
              {short ? ` · approving ${amountText(read.spend.approve, decimals, symbol)}` : ""}
              .{" "}
            </span>
          );
        })}
      </p>
      <button
        type="button"
        className="w-full rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-40"
        disabled={busy || waitingAllowance}
        onClick={() => {
          void run();
        }}
      >
        {busy ? "Waiting…" : needsApproval ? "Approve and continue" : buttonLabel}
      </button>
      {detail ? <p className="text-emerald-50/70">{detail}</p> : null}
      {hash ? <p className="break-all font-mono text-xs">{hash}</p> : null}
      {error ? <p className="text-red-300">{error}</p> : null}
    </div>
  );
}

function CloseCycle({
  samity,
  chainId,
  blockReady,
  windowClosed,
  onDone,
}: {
  samity: Address;
  chainId: number;
  blockReady: boolean;
  windowClosed: boolean;
  onDone: () => void;
}) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId });
  const { data: walletClient } = useWalletClient({ chainId });
  const [phase, setPhase] = useState<"idle" | "wallet" | "mining">("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const busy = phase !== "idle";

  async function close() {
    if (!address || !publicClient || !walletClient) {
      setError("Connect a wallet on this chain.");
      return;
    }
    setError(null);
    setHash(null);
    try {
      const data = encodeFunctionData({ abi: samityAbi, functionName: "closeCycle" });
      setPhase("wallet");
      setDetail("Confirm close cycle in your wallet.");
      const txHash = await sendTransactionHash(walletClient, {
        account: getAddress(address),
        to: samity,
        data,
      });
      setHash(txHash);
      setPhase("mining");
      setDetail("Waiting for close cycle.");
      await waitForSuccess(publicClient, txHash);
      setDone(true);
      setPhase("idle");
      setDetail("Cycle closed.");
      pushToast("Cycle closed.", "ok");
      onDone();
    } catch (caught) {
      setPhase("idle");
      setDetail(null);
      const message = errorText(caught);
      setError(message);
      pushToast(message, "err");
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl samity-card border border-emerald-200/70 bg-emerald-950/40 p-5 text-sm">
      <p className="font-semibold">Close the bidding window</p>
      <p className="text-emerald-50/70">
        {!blockReady
          ? "Waiting for the latest block timestamp."
          : windowClosed
            ? "The latest block is at or past the deadline."
            : "The latest block is still before the deadline."}
      </p>
      <button
        type="button"
        className="w-full rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-40"
        disabled={!windowClosed || busy || done}
        onClick={() => {
          void close();
        }}
      >
        {busy ? "Waiting…" : done ? "Cycle closed" : "Close cycle"}
      </button>
      {detail ? <p className="text-emerald-50/70">{detail}</p> : null}
      {hash ? <p className="break-all font-mono text-xs">{hash}</p> : null}
      {error ? <p className="text-red-300">{error}</p> : null}
    </div>
  );
}

function SealedBidSubmit({
  bidEngine,
  samity,
  chainId,
  blockedReason,
  onDone,
}: {
  bidEngine: Address;
  samity: Address;
  chainId: number;
  blockedReason: string | null;
  onDone: () => void;
}) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId });
  const { data: walletClient } = useWalletClient({ chainId });
  const [status, setStatus] = useState<string | null>(null);
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSealed(sealed: { handle: `0x${string}`; proof: `0x${string}` }, client: PublicClient) {
    if (!address || !walletClient) {
      setError("Connect the wallet that sealed this bid.");
      return;
    }
    setError(null);
    setHash(null);
    setStatus("Checking membership and the bidding window.");
    try {
      const owner = getAddress(address);
      const engine = getAddress(bidEngine);
      const [member, paid, deadline, submitted, allowed, block] = await Promise.all([
        client.readContract({ address: samity, abi: samityAbi, functionName: "isMember", args: [owner] }),
        client.readContract({ address: samity, abi: samityAbi, functionName: "hasPaid", args: [owner] }),
        client.readContract({ address: samity, abi: samityAbi, functionName: "cycleDeadline" }),
        client.readContract({ address: engine, abi: bidEngineAbi, functionName: "hasSubmitted", args: [owner] }),
        client.readContract({ address: samity, abi: samityAbi, functionName: "canBid", args: [owner] }),
        client.getBlock(),
      ]);
      if (!member) {
        throw new Error("This wallet is not registered in the samity. Join before bidding.");
      }
      if (block.timestamp >= deadline) {
        throw new Error("This cycle's window is closed.");
      }
      if (!paid) {
        throw new Error("Pay the installment before bidding.");
      }
      if (submitted) {
        throw new Error("This wallet already submitted a bid for this cycle.");
      }
      if (!allowed) {
        throw new Error("This account cannot bid right now.");
      }
      // `externalEuint32` is a bytes32. The second argument is the 65-byte
      // batch signature, bound to this wallet and this BidEngine.
      const data = encodeFunctionData({
        abi: bidEngineAbi,
        functionName: "submitBid",
        args: [sealed.handle, sealed.proof],
      });
      setStatus("Checking the encrypted bid.");
      await client.simulateContract({
        address: engine,
        abi: bidEngineAbi,
        functionName: "submitBid",
        args: [sealed.handle, sealed.proof],
        account: owner,
      });
      setStatus("Confirm submitBid in your wallet.");
      const txHash = await sendTransactionHash(walletClient, {
        account: owner,
        to: engine,
        data,
        value: 0n,
      });
      setHash(txHash);
      setStatus("Waiting for submitBid.");
      await waitForSuccess(client, txHash);
      setStatus("Bid submitted.");
      pushToast("Bid submitted.", "ok");
      onDone();
    } catch (caught) {
      setStatus(null);
      const message = errorText(caught);
      setError(message);
      pushToast(message, "err");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <SealBid
        bidEngineAddress={bidEngine}
        disabledReason={blockedReason}
        onSealed={(sealed) => {
          if (blockedReason) {
            setError(blockedReason);
            return;
          }
          if (!publicClient) {
            setError("No public client for this chain.");
            return;
          }
          void onSealed(sealed, publicClient);
        }}
      />
      {status ? <p className="text-sm text-emerald-50/70">{status}</p> : null}
      {hash ? <p className="break-all font-mono text-xs">{hash}</p> : null}
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
    </div>
  );
}
