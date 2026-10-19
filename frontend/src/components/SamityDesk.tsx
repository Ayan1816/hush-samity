"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { encodeFunctionData, getAddress, isAddress, zeroAddress, type Address, type PublicClient } from "viem";
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
import { ChainView } from "@/src/components/ChainView";
import { InviteBar } from "@/src/components/InviteBar";
import { MyBid } from "@/src/components/MyBid";
import { RoundReceipts } from "@/src/components/RoundReceipts";
import { RoundTimeline } from "@/src/components/RoundTimeline";
import { SealBid } from "@/src/components/SealBid";
import { Skeleton } from "@/src/components/Skeleton";
import { pushToast } from "@/src/components/Toast";
import { useI18n } from "@/src/i18n/LanguageProvider";
import { notice, type MessageKey, type Notice } from "@/src/i18n/messages";
import { bidEngineAbi, collateralAbi, erc20Abi, samityAbi } from "@/src/lib/abis";
import { encodeErc20Approve, MAX_UINT256, requiredForCurrentStep, wholeSamityAllowance } from "@/src/lib/approve";
import { formatTokenAmount } from "@/src/lib/tokenFormat";
import { isSupportedChainId } from "@/src/config/cofhe";
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

const quietRead = { placeholderData: keepPreviousData };
const READING = "Reading…";

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
  return formatTokenAmount(amount, decimals, symbol);
}

function amountText(
  amount: bigint,
  decimals: number | undefined,
  symbol: string | undefined,
  reading = READING,
  maximum = READING,
): string {
  if (amount === MAX_UINT256) return maximum;
  if (decimals == null) return reading;
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
}, t: (key: MessageKey) => string): string | null {
  if (input.address == null) return t("connectBidder");
  if (!input.windowKnown) return t("gateWaitingTimestamp");
  if (input.windowClosed) return t("err_WindowClosed");
  if (input.phase == null || input.isMember == null || input.hasLocked == null || input.hasPaid == null || input.canBid == null) {
    return t("gateReadingMembership");
  }
  if (input.phase !== 0) return t("gatePhase");
  if (!input.isMember) return t("gateJoinFirst");
  if (input.slashed) return t("gateSlashed");
  if (input.hasWon) return t("gateWon");
  if (!input.hasLocked) return t("gateLockFirst");
  if (!input.hasPaid) return t("gatePayFirst");
  if (input.submittedError) return input.submittedError;
  if (input.readingSubmission || input.hasSubmitted == null) return t("gateReadingSubmission");
  if (input.hasSubmitted) return t("alreadySubmitted");
  if (!input.canBid) return t("gateCannotBid");
  return null;
}

export function SamityDesk({ samity }: { samity: Address }) {
  const { t, format } = useI18n();
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
  const [draftBps, setDraftBps] = useState<bigint | null>(null);
  const [unsealedBps, setUnsealedBps] = useState<bigint | null>(null);

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
  function failureText(row: ReadRow | undefined): string | null {
    if (!row || row.status !== "failure") return null;
    return format(row.error);
  }
  function phaseLabel(value: number): string {
    if (value === 0) return t("phaseBidding");
    if (value === 1) return t("phaseReveal");
    if (value === 2) return t("phaseComplete");
    return t("phaseUnknown", { phase: value });
  }
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
    submittedError: submittedQuery.isError ? format(submittedQuery.error) : null,
    readingSubmission: address != null && engineReady && submittedQuery.isLoading,
  }, t);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (hasSubmitted) setBidSent(false);
  }, [hasSubmitted]);

  const roundKey = `${address ?? ""}:${bidEngine ?? ""}:${currentCycle?.toString() ?? ""}`;
  const roundRef = useRef(roundKey);
  useEffect(() => {
    if (roundRef.current === roundKey) return;
    roundRef.current = roundKey;
    setUnsealedBps(null);
  }, [roundKey]);

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
  const obligation =
    cycles != null && collateralAmount != null && collateralAmount > 0n && installmentAmount != null && installmentAmount > 0n
      ? wholeSamityAllowance(collateralAmount, installmentAmount, cycles)
      : null;
  const collateralNeed =
    collateralAmount != null && collateralAmount > 0n && installmentAmount != null
      ? requiredForCurrentStep("lockCollateral", collateralAmount, installmentAmount)
      : null;
  const installmentNeed =
    collateralAmount != null && installmentAmount != null && installmentAmount > 0n
      ? requiredForCurrentStep("payInstallment", collateralAmount, installmentAmount)
      : null;

  const showActions =
    ready &&
    chainId != null &&
    tokenReady &&
    collateralReady &&
    obligation != null &&
    collateralNeed != null &&
    installmentNeed != null &&
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
        <h1 className="text-2xl font-semibold">{t("samityHeading")}</h1>
        <p className="break-all font-mono text-xs text-emerald-50/70">{samity}</p>
        <p className="text-sm text-emerald-50/70">
          {chainId == null ? t("connectSupported") : t("readingChain", { chain: chain?.name ?? chainId })}
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
        <p className="text-sm text-red-300">{format(codeQuery.error)}</p>
      ) : !hasCode ? (
        <p className="text-sm text-emerald-50/70">{t("noCodeOnChain", { chain: chain?.name ?? "" })}</p>
      ) : (
        <>
          {chainId != null ? (
            <InviteBar
              samity={samity}
              installmentAmount={installmentAmount ?? null}
              collateralAmount={collateralAmount ?? null}
              deadline={cycleDeadline ?? null}
              currentCycle={currentCycle ?? null}
              decimals={decimals}
              symbol={symbol}
            />
          ) : null}
          <div className="grid grid-cols-1 gap-3 rounded-2xl samity-card border border-emerald-200/70 bg-emerald-950/40 p-5 text-sm sm:grid-cols-2">
            <Stat
              label={t("statRound")}
              value={remember(
                "round",
                failureText(rows?.[0]) ??
                  (currentCycle == null || totalCycles == null
                    ? READING
                    : t("roundOf", { current: currentCycle.toString(), total: totalCycles.toString() })),
              )}
            />
            <Stat label={t("statPhase")} value={remember("phase", failureText(rows?.[2]) ?? (phase == null ? READING : phaseLabel(phase)))} />
            <Stat
              label={t("statPool")}
              value={remember(
                "pool",
                failureText(rows?.[3]) ?? (collectedPot == null ? READING : amountText(collectedPot, decimals, symbol)),
              )}
            />
            <Stat
              label={t("statLocked")}
              value={remember(
                "locked",
                address == null
                  ? t("connectShort")
                  : lockedQuery.data == null
                    ? lockedQuery.isError
                      ? format(lockedQuery.error)
                      : READING
                    : amountText(lockedQuery.data, decimals, symbol),
              )}
            />
            <Stat
              label={t("statDeadline")}
              value={remember("deadline", failureText(rows?.[9]) ?? (cycleDeadline == null ? READING : timeText(cycleDeadline)))}
            />
            <Stat
              label={t("statChainTime")}
              value={remember(
                "chain-time",
                blockQuery.data == null
                  ? blockQuery.isError
                    ? format(blockQuery.error)
                    : READING
                  : timeText(blockQuery.data.timestamp),
              )}
            />
            <Stat
              label={t("statMembers")}
              value={remember(
                "members",
                failureText(rows?.[10]) ??
                  (memberCount == null || memberCap == null
                    ? READING
                    : t("membersOf", { count: memberCount.toString(), cap: memberCap.toString() })),
              )}
            />
            <Stat
              label={t("statInstallment")}
              value={remember(
                "installment",
                failureText(rows?.[7]) ?? (installmentAmount == null ? READING : amountText(installmentAmount, decimals, symbol)),
              )}
            />
            <Stat
              label={t("statCollateralRequired")}
              value={remember(
                "collateral",
                failureText(rows?.[8]) ?? (collateralAmount == null ? READING : amountText(collateralAmount, decimals, symbol)),
              )}
            />
            <Stat
              label={t("statMaxDiscount")}
              value={remember(
                "discount",
                failureText(rows?.[12]) ?? (maxDiscountCap == null ? READING : t("bps", { value: maxDiscountCap.toString() })),
              )}
            />
            <Stat
              label={t("statBalance")}
              value={remember(
                "balance",
                address == null
                  ? t("connectShort")
                  : balanceQuery.data == null
                    ? balanceQuery.isError
                      ? format(balanceQuery.error)
                      : READING
                    : amountText(balanceQuery.data, decimals, symbol),
              )}
            />
            <Stat
              label={t("statSeat")}
              value={remember(
                "seat",
                address == null
                  ? t("connectShort")
                  : failureText(userRows?.[0]) ??
                    (isMember == null
                      ? READING
                      : !isMember
                        ? t("notAMember")
                        : slashed
                          ? t("slashed")
                          : t("memberSeat", {
                              locked: hasLocked ? t("yes") : t("no"),
                              paid: hasPaid ? t("yes") : t("no"),
                              won: hasWon ? t("yes") : t("no"),
                            })),
              )}
            />
          </div>

          {chainId != null ? (
            <RoundTimeline
              samity={samity}
              bidEngine={engineReady && bidEngine != null ? bidEngine : null}
              chainId={chainId}
              account={address}
              blockNumber={blockNumber}
              currentRound={currentCycle}
              phase={phase}
              deadline={cycleDeadline}
              chainTime={blockTimestamp}
              memberCount={memberCount}
              memberCap={memberCap}
            />
          ) : null}

          {chainId != null ? (
            <RoundReceipts
              samity={samity}
              bidEngine={engineReady && bidEngine != null ? bidEngine : null}
              token={tokenReady && token != null ? token : null}
              chainId={chainId}
              account={address}
              blockNumber={blockNumber}
              currentRound={currentCycle}
              phase={phase}
              decimals={decimals}
              symbol={symbol}
            />
          ) : null}

          {showActions &&
          token != null &&
          collateral != null &&
          obligation != null &&
          collateralNeed != null &&
          installmentNeed != null &&
          collateralAmount != null &&
          installmentAmount != null ? (
            <section className="flex flex-col gap-3">
              {!windowKnown ? <p className="text-sm text-emerald-50/70">{t("gateWaitingTimestamp")}</p> : null}
              {windowClosed ? <p className="text-sm text-emerald-50/70">{t("windowClosedActions")}</p> : null}
              {windowKnown && !windowClosed && isMember === false && phase === 0 && currentCycle === 1n ? (
                <PullAndCall
                  title={t("joinLockTitle")}
                  buttonLabel={t("joinBtn")}
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
                      need: collateralNeed,
                      approve: obligation,
                      spentOnSuccess: collateralAmount,
                      title: t("collateralTitle"),
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
                  title={t("lockTitle")}
                  buttonLabel={t("lockBtn")}
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
                      need: collateralNeed,
                      approve: obligation,
                      spentOnSuccess: collateralAmount,
                      title: t("collateralTitle"),
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
                  title={t("payTitle")}
                  buttonLabel={t("payBtn")}
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
                      need: installmentNeed,
                      approve: obligation,
                      spentOnSuccess: installmentAmount,
                      title: t("installmentsTitle"),
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
                {t("bidEngineLine", { address: bidEngine })}{" "}
                {address == null ? (
                  t("connectLower")
                ) : failureText(userRows?.[5]) ? (
                  failureText(userRows?.[5])
                ) : canBid == null ? (
                  <Skeleton className="inline-block h-3 w-16 align-middle" />
                ) : canBid ? (
                  t("yes")
                ) : (
                  t("no")
                )}
              </p>
              <SealedBidSubmit
                bidEngine={bidEngine}
                samity={samity}
                chainId={chainId}
                currentCycle={currentCycle}
                installmentAmount={installmentAmount ?? null}
                memberCap={memberCap ?? null}
                decimals={decimals}
                symbol={symbol}
                maxDiscountBps={maxDiscountCap ?? null}
                onDraftBps={setDraftBps}
                alreadyOnChain={hasSubmitted === true || bidSent}
                blockedReason={bidSent ? t("alreadySubmitted") : blockedReason}
                onDone={() => {
                  setBidSent(true);
                  publish();
                }}
              />
              <ChainView
                bidEngine={bidEngine}
                chainId={chainId}
                blockNumber={blockNumber}
                installmentAmount={installmentAmount ?? null}
                memberCap={memberCap ?? null}
                decimals={decimals}
                symbol={symbol}
                draftBps={draftBps}
                unsealedBps={unsealedBps}
                onUnsealed={setUnsealedBps}
              />
              <MyBid bidEngineAddress={bidEngine} onPlaintext={setUnsealedBps} />
            </section>
          ) : (blockNumber == null || publicQuery.isLoading) && publicQuery.data == null ? (
            <Skeleton className="inline-block h-4 w-40" />
          ) : (
            <p className="text-sm text-emerald-50/70">{failureText(rows?.[5]) ?? t("bidEngineUnavailable")}</p>
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
      {value === READING ? (
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
  const { t, format } = useI18n();
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId });
  const { data: walletClient } = useWalletClient({ chainId });
  const alive = useRef(true);
  const first = spends[0];
  const second = spends[1];
  const firstQuery = useSpenderAllowance(token, address, first?.spender, chainId, first != null);
  const secondQuery = useSpenderAllowance(token, address, second?.spender, chainId, second != null);
  const [phase, setPhase] = useState<"idle" | "wallet" | "mining">("idle");
  const [intent, setIntent] = useState<"approve" | "act" | null>(null);
  const [detail, setDetail] = useState<Notice | null>(null);
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<unknown>(null);
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

  function currentSnapshot() {
    return spends.map((spend, index) => {
      const chain = index === 0 ? firstQuery.data : secondQuery.data;
      const local = locals[spendKey(spend.spender)];
      return { spend, chain, shown: shownAllowance(chain, local) };
    });
  }

  async function refreshAllowances() {
    if (!alive.current) return;
    await firstQuery.refetch();
    if (second) await secondQuery.refetch();
  }

  async function approve() {
    if (!address || !publicClient || !walletClient || !first) {
      setError(notice("connectWalletOnChain"));
      return;
    }
    setError(null);
    setHash(null);
    setIntent("approve");
    try {
      const owner = getAddress(address);
      const deadline = await publicClient.readContract({
        address: samity,
        abi: samityAbi,
        functionName: "cycleDeadline",
      });
      const block = await publicClient.getBlock();
      if (block.timestamp >= deadline) throw notice("err_WindowClosed");

      const snapshot = currentSnapshot();
      if (snapshot.some((item) => item.shown == null)) {
        const failed = reads.find((read) => read.shown == null && read.query?.isError);
        setError(failed?.query?.error ?? notice("waitingAllowance"));
        setIntent(null);
        return;
      }
      const item = snapshot.find((entry) => (entry.shown ?? 0n) < entry.spend.need);
      if (!item) {
        setIntent(null);
        return;
      }
      const approval = encodeErc20Approve(token, item.spend.spender, item.spend.approve);
      setPhase("wallet");
      setDetail(notice("confirmApproval", { title: item.spend.title }));
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
      if (!alive.current) return;
      setHash(approveHash);
      setPhase("mining");
      setDetail(notice("waitingApproval", { title: item.spend.title }));
      await waitForSuccess(publicClient, approveHash);
      if (!alive.current) return;
      onRaise(item.spend.spender, item.spend.approve);
      setPhase("idle");
      setDetail(null);
      setIntent(null);
      pushToast(t("approvalConfirmed"), "ok");
      await refreshAllowances();
    } catch (caught) {
      if (!alive.current) return;
      setPhase("idle");
      setDetail(null);
      setIntent(null);
      setError(caught);
      pushToast(format(caught), "err");
    }
  }

  async function act() {
    if (!address || !publicClient || !walletClient || !first) {
      setError(notice("connectWalletOnChain"));
      return;
    }
    setError(null);
    setHash(null);
    setIntent("act");
    try {
      const owner = getAddress(address);
      const deadline = await publicClient.readContract({
        address: samity,
        abi: samityAbi,
        functionName: "cycleDeadline",
      });
      const block = await publicClient.getBlock();
      if (block.timestamp >= deadline) throw notice("err_WindowClosed");

      const snapshot = currentSnapshot();
      if (snapshot.some((item) => item.shown == null)) {
        const failed = reads.find((read) => read.shown == null && read.query?.isError);
        setError(failed?.query?.error ?? notice("waitingAllowance"));
        setIntent(null);
        return;
      }
      if (snapshot.some((item) => (item.shown ?? 0n) < item.spend.need)) {
        setError(notice("allowanceBelow"));
        setIntent(null);
        return;
      }

      setPhase("wallet");
      setDetail(notice("confirmNamed", { action: buttonLabel }));
      const data = encodeFunctionData({ abi: samityAbi, functionName });
      const txHash = await sendTransactionHash(walletClient, { account: owner, to: samity, data });
      if (!alive.current) return;
      setHash(txHash);
      setPhase("mining");
      setDetail(notice("waitingNamed", { action: buttonLabel }));
      await waitForSuccess(publicClient, txHash);
      if (!alive.current) return;
      for (const item of snapshot) {
        if (item.spend.spentOnSuccess > 0n) onSpend(item.spend.spender, item.spend.spentOnSuccess, item.chain);
      }
      const doneText =
        functionName === "join" ? t("joined") : functionName === "lockCollateral" ? t("collateralLocked") : t("installmentPaid");
      onDone();
      setPhase("idle");
      setDetail(null);
      setIntent(null);
      pushToast(doneText, "ok");
      await refreshAllowances();
    } catch (caught) {
      if (!alive.current) return;
      setPhase("idle");
      setDetail(null);
      setIntent(null);
      setError(caught);
      pushToast(format(caught), "err");
    }
  }

  const priced = (amount: bigint) => amountText(amount, decimals, symbol, t("reading"), t("maxAllowance"));

  return (
    <div className="flex flex-col gap-2 rounded-2xl samity-card border border-emerald-200/70 bg-emerald-950/40 p-5 text-sm">
      <p className="font-semibold">{title}</p>
      <p className="text-emerald-50/70">
        {reads.map((read) => {
          const short = read.shown != null && read.shown < read.spend.need;
          return (
            <span key={read.spend.spender}>
              {t("allowanceLead", { title: read.spend.title })}{" "}
              {read.shown == null ? (
                read.query?.isError && read.query.data == null ? (
                  format(read.query.error)
                ) : (
                  <Skeleton className="inline-block h-3 w-24 align-middle" />
                )
              ) : (
                priced(read.shown)
              )}
              {". "}
              {t("allowancePull", { need: priced(read.spend.need) })}
              {short ? ` ${t("approveFull", { amount: priced(read.spend.approve) })}` : ""}{" "}
            </span>
          );
        })}
      </p>
      {needsApproval ? (
        <button
          type="button"
          className="w-full rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-40"
          disabled={busy || waitingAllowance}
          onClick={() => {
            void approve();
          }}
        >
          {busy && intent === "approve" ? t("waiting") : t("approve")}
        </button>
      ) : null}
      <button
        type="button"
        className="w-full rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-40"
        disabled={busy || waitingAllowance || needsApproval}
        onClick={() => {
          void act();
        }}
      >
        {busy && intent === "act" ? t("waiting") : buttonLabel}
      </button>
      {detail ? <p className="text-emerald-50/70">{format(detail)}</p> : null}
      {hash ? <p className="break-all font-mono text-xs">{hash}</p> : null}
      {error ? <p className="text-red-300">{format(error)}</p> : null}
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
  const { t, format } = useI18n();
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId });
  const { data: walletClient } = useWalletClient({ chainId });
  const [phase, setPhase] = useState<"idle" | "wallet" | "mining">("idle");
  const [detail, setDetail] = useState<Notice | null>(null);
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  const busy = phase !== "idle";

  async function close() {
    if (!address || !publicClient || !walletClient) {
      setError(notice("connectWalletOnChain"));
      return;
    }
    setError(null);
    setHash(null);
    try {
      const data = encodeFunctionData({ abi: samityAbi, functionName: "closeCycle" });
      setPhase("wallet");
      setDetail(notice("confirmClose"));
      const txHash = await sendTransactionHash(walletClient, {
        account: getAddress(address),
        to: samity,
        data,
      });
      setHash(txHash);
      setPhase("mining");
      setDetail(notice("waitingClose"));
      await waitForSuccess(publicClient, txHash);
      setDone(true);
      setPhase("idle");
      setDetail(notice("cycleClosed"));
      pushToast(t("cycleClosed"), "ok");
      onDone();
    } catch (caught) {
      setPhase("idle");
      setDetail(null);
      setError(caught);
      pushToast(format(caught), "err");
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl samity-card border border-emerald-200/70 bg-emerald-950/40 p-5 text-sm">
      <p className="font-semibold">{t("closeTitle")}</p>
      <p className="text-emerald-50/70">
        {!blockReady ? t("closeWaitingBlock") : windowClosed ? t("closePast") : t("closeBefore")}
      </p>
      <button
        type="button"
        className="w-full rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-40"
        disabled={!windowClosed || busy || done}
        onClick={() => {
          void close();
        }}
      >
        {busy ? t("waiting") : done ? t("cycleClosed") : t("closeBtn")}
      </button>
      {detail ? <p className="text-emerald-50/70">{format(detail)}</p> : null}
      {hash ? <p className="break-all font-mono text-xs">{hash}</p> : null}
      {error ? <p className="text-red-300">{format(error)}</p> : null}
    </div>
  );
}

type BidSubmitStatus =
  | "checkingMembership"
  | "checkingEncrypted"
  | "confirmSubmit"
  | "waitingSubmit"
  | "bidSubmitted";

function SealedBidSubmit({
  bidEngine,
  samity,
  chainId,
  currentCycle,
  installmentAmount,
  memberCap,
  decimals,
  symbol,
  maxDiscountBps,
  onDraftBps,
  alreadyOnChain,
  blockedReason,
  onDone,
}: {
  bidEngine: Address;
  samity: Address;
  chainId: number;
  currentCycle: bigint | undefined;
  installmentAmount: bigint | null;
  memberCap: bigint | null;
  decimals: number | undefined;
  symbol: string | undefined;
  maxDiscountBps: number | null;
  onDraftBps: (bps: bigint | null) => void;
  alreadyOnChain: boolean;
  blockedReason: string | null;
  onDone: () => void;
}) {
  const { t, format } = useI18n();
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId });
  const { data: walletClient } = useWalletClient({ chainId });
  const [status, setStatus] = useState<BidSubmitStatus | null>(null);
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<unknown>(null);
  const seenRound = useRef<{ engine: Address; cycle: bigint | undefined } | null>(null);

  useEffect(() => {
    const previous = seenRound.current;
    seenRound.current = { engine: bidEngine, cycle: currentCycle };
    if (previous == null) return;
    if (previous.engine === bidEngine && previous.cycle === currentCycle) return;
    if (previous.engine === bidEngine && previous.cycle == null) return;
    setStatus(null);
    setHash(null);
    setError(null);
  }, [bidEngine, currentCycle]);

  async function onSealed(sealed: { handle: `0x${string}`; proof: `0x${string}` }, client: PublicClient) {
    if (!address || !walletClient) {
      setError(notice("connectSealed"));
      return;
    }
    setError(null);
    setHash(null);
    setStatus("checkingMembership");
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
      if (!member) throw notice("notRegistered");
      if (block.timestamp >= deadline) throw notice("err_WindowClosed");
      if (!paid) throw notice("gatePayFirst");
      if (submitted) throw notice("alreadySubmitted");
      if (!allowed) throw notice("gateCannotBid");
      // `externalEuint32` is a bytes32. The second argument is the 65-byte
      // batch signature, bound to this wallet and this BidEngine.
      const data = encodeFunctionData({
        abi: bidEngineAbi,
        functionName: "submitBid",
        args: [sealed.handle, sealed.proof],
      });
      setStatus("checkingEncrypted");
      await client.simulateContract({
        address: engine,
        abi: bidEngineAbi,
        functionName: "submitBid",
        args: [sealed.handle, sealed.proof],
        account: owner,
      });
      setStatus("confirmSubmit");
      const txHash = await sendTransactionHash(walletClient, {
        account: owner,
        to: engine,
        data,
        value: 0n,
      });
      setHash(txHash);
      setStatus("waitingSubmit");
      await waitForSuccess(client, txHash);
      setStatus("bidSubmitted");
      pushToast(t("bidSubmitted"), "ok");
      onDone();
    } catch (caught) {
      setStatus(null);
      setError(caught);
      pushToast(format(caught), "err");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <SealBid
        key={`${bidEngine}-${currentCycle?.toString() ?? "cycle"}`}
        bidEngineAddress={bidEngine}
        installmentAmount={installmentAmount}
        memberCap={memberCap}
        decimals={decimals}
        symbol={symbol}
        maxDiscountBps={maxDiscountBps}
        onDraftBps={onDraftBps}
        chainPending={status != null && status !== "bidSubmitted"}
        chainConfirmed={status === "bidSubmitted"}
        alreadyOnChain={alreadyOnChain}
        disabledReason={blockedReason}
        onSealed={(sealed) => {
          if (blockedReason) return;
          if (!publicClient) {
            setError(notice("noPublicClient"));
            return;
          }
          void onSealed(sealed, publicClient);
        }}
      />
      {status ? <p className="text-sm text-emerald-50/70">{t(status)}</p> : null}
      {hash ? <p className="break-all font-mono text-xs">{hash}</p> : null}
      {error ? <p className="text-sm text-red-300">{format(error)}</p> : null}
    </div>
  );
}
