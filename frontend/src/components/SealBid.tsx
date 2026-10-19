"use client";

import { EncryptStep, Encryptable, isCofheError, type EncryptStepCallbackContext } from "@cofhe/sdk";
import { useEffect, useState } from "react";
import { getAddress, isAddress } from "viem";
import { useAccount, usePublicClient, useReadContract, useWalletClient } from "wagmi";
import { Skeleton } from "@/src/components/Skeleton";
import { WaxSeal, type WaxSealStage } from "@/src/components/WaxSeal";
import { cofheClient, connectCofheClient, isSupportedChainId, supportedChains } from "@/src/config/cofhe";
import { useI18n } from "@/src/i18n/LanguageProvider";
import { notice, type MessageKey, type Notice } from "@/src/i18n/messages";
import { quoteBid } from "@/src/lib/bidQuote";
import { normalizeHandle, normalizeProof } from "@/src/lib/ciphertext";
import { formatTokenAmount } from "@/src/lib/tokenFormat";

const ENCRYPT_STEPS = [
  EncryptStep.InitTfhe,
  EncryptStep.FetchKeys,
  EncryptStep.Pack,
  EncryptStep.Prove,
  EncryptStep.Verify,
] as const;

const STEP_KEY: Record<EncryptStep, MessageKey> = {
  [EncryptStep.InitTfhe]: "stepInit",
  [EncryptStep.FetchKeys]: "stepFetch",
  [EncryptStep.Pack]: "stepPack",
  [EncryptStep.Prove]: "stepProve",
  [EncryptStep.Verify]: "stepVerify",
};

type StepPhase = "idle" | "running" | "done";

type SealedBid = {
  handle: `0x${string}`;
  proof: `0x${string}`;
};

const bidEngineReads = [
  {
    type: "function",
    name: "maxDiscountCap",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }],
  },
] as const;

const UINT32_MAX = 4_294_967_295n;

function idleSteps(): Record<EncryptStep, StepPhase> {
  return {
    [EncryptStep.InitTfhe]: "idle",
    [EncryptStep.FetchKeys]: "idle",
    [EncryptStep.Pack]: "idle",
    [EncryptStep.Prove]: "idle",
    [EncryptStep.Verify]: "idle",
  };
}

function parseBasisPoints(raw: string): bigint {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error("Enter the discount as a whole number of basis points.");
  }
  const bid = BigInt(trimmed);
  if (bid > UINT32_MAX) {
    throw new Error("The discount does not fit in a uint32.");
  }
  return bid;
}

function chainCap(value: number | bigint | undefined): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000) return value;
  if (typeof value === "bigint" && value >= 0n && value <= 10_000n) return Number(value);
  return null;
}

function liveBps(raw: string, maxBps: number | null): bigint | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed) || maxBps == null) return null;
  const bid = BigInt(trimmed);
  if (bid > UINT32_MAX || bid > BigInt(maxBps)) return null;
  return bid;
}

function sealStage(
  steps: Record<EncryptStep, StepPhase>,
  chainPending: boolean,
  chainConfirmed: boolean,
  alreadyOnChain: boolean,
): { stage: WaxSealStage; running: boolean } {
  if (chainConfirmed) return { stage: "stamped", running: false };
  const running = (step: EncryptStep) => steps[step] === "running";
  if (running(EncryptStep.Verify)) return { stage: "verify", running: true };
  if (running(EncryptStep.Prove)) return { stage: "prove", running: true };
  if (running(EncryptStep.Pack)) return { stage: "pack", running: true };
  if (running(EncryptStep.FetchKeys)) return { stage: "fetchKeys", running: true };
  if (running(EncryptStep.InitTfhe)) return { stage: "initTfhe", running: true };
  if (steps[EncryptStep.Verify] === "done") {
    return { stage: chainPending ? "awaitingReceipt" : alreadyOnChain ? "locked" : "awaitingReceipt", running: false };
  }
  if (alreadyOnChain) return { stage: "locked", running: false };
  if (steps[EncryptStep.Prove] === "done") return { stage: "prove", running: false };
  if (steps[EncryptStep.Pack] === "done") return { stage: "pack", running: false };
  if (steps[EncryptStep.FetchKeys] === "done") return { stage: "fetchKeys", running: false };
  if (steps[EncryptStep.InitTfhe] === "done") return { stage: "initTfhe", running: false };
  return { stage: "idle", running: false };
}

function rejectReason(raw: string, maxBps: number | null): Notice | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return notice("enterWholeBps");
  if (maxBps == null) return notice("readingDiscountCap");
  const bid = BigInt(trimmed);
  if (bid > UINT32_MAX) return notice("errUint32");
  if (bid > BigInt(maxBps)) return notice("capIs", { max: maxBps.toString() });
  return null;
}

export type SealBidProps = {
  /**
   * Address of `BidEngine`. That contract calls `FHE.asEuint32`, so the
   * input proof has to be bound to it. Binding the samity address reverts
   * inside `submitBid`.
   */
  bidEngineAddress: `0x${string}`;
  onSealed?: (sealed: SealedBid) => void;
  /** Set when `submitBid` would revert. Sealing stays disabled. */
  disabledReason?: string | null;
  installmentAmount?: bigint | null;
  memberCap?: bigint | null;
  decimals?: number;
  symbol?: string;
  /** Samity `maxDiscountCap` from the same block as the installment. */
  maxDiscountBps?: number | null;
  onDraftBps?: (bps: bigint | null) => void;
  /** True while submitBid has been sent and the receipt is not confirmed yet. */
  chainPending?: boolean;
  /** True once the submitBid receipt succeeded. */
  chainConfirmed?: boolean;
  /** True when this wallet already has a bid stored for the round. */
  alreadyOnChain?: boolean;
};

export function SealBid({
  bidEngineAddress,
  onSealed,
  disabledReason = null,
  installmentAmount = null,
  memberCap = null,
  decimals,
  symbol,
  maxDiscountBps = null,
  onDraftBps,
  chainPending = false,
  chainConfirmed = false,
  alreadyOnChain = false,
}: SealBidProps) {
  const { t, format } = useI18n();
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const engineReady = isAddress(bidEngineAddress);

  const capQuery = useReadContract({
    address: bidEngineAddress,
    abi: bidEngineReads,
    functionName: "maxDiscountCap",
    query: { enabled: engineReady },
  });

  const [basisPoints, setBasisPoints] = useState("");
  const [steps, setSteps] = useState(idleSteps);
  const [durations, setDurations] = useState<Partial<Record<EncryptStep, number>>>({});
  const [sealing, setSealing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sealed, setSealed] = useState<SealedBid | null>(null);

  const chainSupported = isSupportedChainId(chainId);
  const canSeal = isConnected && chainSupported && engineReady && publicClient != null && walletClient != null && !sealing;
  const engineCap = chainCap(capQuery.data);
  const capInvalid = capQuery.data != null && engineCap == null;
  const maxBps = capInvalid ? null : (engineCap ?? chainCap(maxDiscountBps ?? undefined));
  const draft = liveBps(basisPoints, maxBps);
  const rejected = rejectReason(basisPoints, maxBps);
  const wax = sealStage(steps, chainPending, chainConfirmed, alreadyOnChain);

  useEffect(() => {
    onDraftBps?.(draft);
  }, [draft, onDraftBps]);

  async function sealBid() {
    if (disabledReason) return;
    if (!publicClient || !walletClient || address == null) {
      setError(notice("connectSubmitter"));
      return;
    }
    if (chainId == null || !isSupportedChainId(chainId)) {
      setError(notice("noCoprocessor"));
      return;
    }
    if (!engineReady) {
      setError(notice("badEngine"));
      return;
    }

    let bid: bigint;
    try {
      bid = parseBasisPoints(basisPoints);
    } catch (caught) {
      setError(caught);
      return;
    }

    setSealing(true);
    setError(null);
    setSealed(null);
    setDurations({});
    setSteps(idleSteps());

    try {
      await connectCofheClient(publicClient, walletClient);

      const bidder = getAddress(address);
      const engine = getAddress(bidEngineAddress);
      const [handle, proof] = await cofheClient
        .encryptInputs([Encryptable.uint32(bid)])
        .setAccount(bidder)
        .setChainId(chainId)
        .setConsumingContract(engine)
        .onStep((step: EncryptStep, context?: EncryptStepCallbackContext) => {
          setSteps((current) => ({
            ...current,
            [step]: context?.isEnd ? "done" : "running",
          }));
          if (context?.isEnd) {
            setDurations((current) => ({ ...current, [step]: context.duration }));
          }
        })
        .execute();

      const result: SealedBid = { handle: normalizeHandle(handle), proof: normalizeProof(proof) };
      setSealed(result);
      onSealed?.(result);
    } catch (caught) {
      setError(isCofheError(caught) ? caught : caught instanceof Error ? caught : notice("errEncryptionFailed"));
    } finally {
      setSealing(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl samity-card border border-emerald-200/70 bg-emerald-950/40 p-5">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t("sealTitle")}</h2>
        <p className="text-sm text-emerald-50/70">{t("sealBody")}</p>
      </header>

      <WaxSeal stage={wax.stage} running={wax.running} />

      <dl className="grid gap-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-emerald-50/60">{t("account")}</dt>
          <dd className="font-mono">{address ?? t("notConnected")}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-emerald-50/60">{t("chain")}</dt>
          <dd>
            {chainId == null
              ? t("notConnected")
              : chainSupported
                ? String(chainId)
                : t("notCofheChain", { chain: String(chainId) })}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-emerald-50/60">{t("creatorCap")}</dt>
          <dd>
            {capQuery.isLoading ? (
              <Skeleton className="inline-block h-3 w-16 align-middle" />
            ) : capQuery.data != null ? (
              t("bps", { value: capQuery.data.toString() })
            ) : capQuery.error ? (
              format(capQuery.error)
            ) : (
              t("unavailable")
            )}
          </dd>
        </div>
      </dl>

      {!chainSupported && isConnected ? (
        <p className="text-sm text-emerald-50/70">
          {t("supportedChains", { chains: supportedChains.map((chain) => `${chain.name} (${chain.id})`).join(", ") })}
        </p>
      ) : null}

      <label className="flex flex-col gap-2 text-sm">
        {t("discountLabel")}
        <input
          className="rounded-lg border border-emerald-200/20 bg-black/30 px-3 py-2 font-mono"
          inputMode="numeric"
          autoComplete="off"
          value={basisPoints}
          onChange={(event) => setBasisPoints(event.target.value)}
          disabled={sealing}
        />
      </label>

      {maxBps == null ? (
        capQuery.isLoading ? (
          <Skeleton className="inline-block h-3 w-full" />
        ) : (
          <p className="text-sm text-emerald-50/70">
            {capInvalid ? t("capNotBps", { cap: capQuery.data?.toString() ?? "" }) : t("readingDiscountCap")}
          </p>
        )
      ) : (
        <label className="flex flex-col gap-2 text-sm">
          {t("discountRange", { max: maxBps.toString() })}
          <input
            type="range"
            min={0}
            max={maxBps}
            step={1}
            value={draft == null ? 0 : Number(draft)}
            onChange={(event) => setBasisPoints(event.target.value)}
            disabled={sealing}
          />
        </label>
      )}

      <BidCalculator
        bps={draft}
        reject={rejected}
        installmentAmount={installmentAmount}
        memberCap={memberCap}
        decimals={decimals}
        symbol={symbol}
      />

      <button
        type="button"
        className="w-full rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-40"
        onClick={() => {
          void sealBid();
        }}
        disabled={!canSeal || basisPoints.trim() === "" || disabledReason != null}
      >
        {sealing ? t("sealing") : t("sealBid")}
      </button>

      {disabledReason ? <p className="text-sm text-emerald-50/70">{disabledReason}</p> : null}

      <ol className="flex flex-col gap-2 text-sm">
        {ENCRYPT_STEPS.map((step) => {
          const phase = steps[step];
          const duration = durations[step];
          return (
            <li key={step} className="flex items-baseline justify-between gap-4">
              <span>
                <span className="font-mono text-emerald-200/80">{step}</span>
                <span className="text-emerald-50/60"> · {t(STEP_KEY[step])}</span>
              </span>
              <span className="shrink-0 font-mono">
                {phase === "idle" ? t("stepIdle") : phase === "running" ? t("stepRunning") : t("stepDone")}
                {phase === "done" && duration != null ? ` · ${t("durationMs", { duration })}` : ""}
              </span>
            </li>
          );
        })}
      </ol>

      {sealed ? (
        <dl className="grid gap-2 break-all font-mono text-xs">
          <div>
            <dt className="text-emerald-50/60">{t("ciphertextHandle")}</dt>
            <dd>{sealed.handle}</dd>
          </div>
          <div>
            <dt className="text-emerald-50/60">{t("batchProof")}</dt>
            <dd>{sealed.proof}</dd>
          </div>
        </dl>
      ) : null}

      {error ? <p className="text-sm text-red-300">{format(error)}</p> : null}
    </section>
  );
}

function BidCalculator({
  bps,
  reject,
  installmentAmount,
  memberCap,
  decimals,
  symbol,
}: {
  bps: bigint | null;
  reject: Notice | null;
  installmentAmount: bigint | null;
  memberCap: bigint | null;
  decimals: number | undefined;
  symbol: string | undefined;
}) {
  const { t, format } = useI18n();
  if (reject) return <p className="text-sm text-emerald-50/70">{format(reject)}</p>;
  if (bps == null) return <p className="text-sm text-emerald-50/70">{t("enterCapRange")}</p>;
  if (installmentAmount == null || memberCap == null) {
    return <p className="text-sm text-emerald-50/70">{t("readingInstallmentCap")}</p>;
  }

  let quote: ReturnType<typeof quoteBid>;
  try {
    quote = quoteBid(installmentAmount, memberCap, bps);
  } catch (caught) {
    return <p className="text-sm text-red-300">{format(caught)}</p>;
  }

  const priced = (amount: bigint) => (decimals == null ? t("readingDecimals") : formatTokenAmount(amount, decimals, symbol));

  return (
    <dl className="grid gap-2 text-sm">
      <div className="flex justify-between gap-4">
        <dt className="text-emerald-50/60">{t("poolLabel")}</dt>
        <dd className="font-mono">{priced(quote.pool)}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-emerald-50/60">{t("discountAmount")}</dt>
        <dd className="font-mono">{priced(quote.discountAmount)}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-emerald-50/60">{t("ifYouWin")}</dt>
        <dd className="text-right font-mono">{priced(quote.winPayout)}</dd>
      </div>
      <div className="flex justify-between gap-4">
        <dt className="text-emerald-50/60">{t("ifOtherWins")}</dt>
        <dd className="text-right font-mono">{priced(quote.dividend)}</dd>
      </div>
    </dl>
  );
}
