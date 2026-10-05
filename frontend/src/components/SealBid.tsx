"use client";

import { EncryptStep, Encryptable, isCofheError, type EncryptStepCallbackContext } from "@cofhe/sdk";
import { useState } from "react";
import { isAddress } from "viem";
import { useAccount, usePublicClient, useReadContract, useWalletClient } from "wagmi";
import { Skeleton } from "@/src/components/Skeleton";
import { cofheClient, connectCofheClient, isSupportedChainId, supportedChains } from "@/src/config/cofhe";

const ENCRYPT_STEPS = [
  EncryptStep.InitTfhe,
  EncryptStep.FetchKeys,
  EncryptStep.Pack,
  EncryptStep.Prove,
  EncryptStep.Verify,
] as const;

const STEP_LABEL: Record<EncryptStep, string> = {
  [EncryptStep.InitTfhe]: "Initialize TFHE",
  [EncryptStep.FetchKeys]: "Fetch the FHE key and CRS",
  [EncryptStep.Pack]: "Pack the ciphertext",
  [EncryptStep.Prove]: "Generate the ZK proof",
  [EncryptStep.Verify]: "Verify with the ZK verifier",
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

function errorText(error: unknown): string {
  if (isCofheError(error)) return error.message;
  if (typeof error === "object" && error !== null && "shortMessage" in error && typeof error.shortMessage === "string") {
    return error.shortMessage;
  }
  if (error instanceof Error) return error.message;
  return "Encryption failed.";
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

export type SealBidProps = {
  /**
   * Address of `BidEngine`. That contract calls `FHE.asEuint32`, so the
   * input proof has to be bound to it. Binding the samity address reverts
   * inside `submitBid`.
   */
  bidEngineAddress: `0x${string}`;
  onSealed?: (sealed: SealedBid) => void;
};

export function SealBid({ bidEngineAddress, onSealed }: SealBidProps) {
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
  const [error, setError] = useState<string | null>(null);
  const [sealed, setSealed] = useState<SealedBid | null>(null);

  const chainSupported = isSupportedChainId(chainId);
  const canSeal = isConnected && chainSupported && engineReady && publicClient != null && walletClient != null && !sealing;

  async function sealBid() {
    if (!publicClient || !walletClient) {
      setError("Connect a wallet on a supported chain before sealing a bid.");
      return;
    }
    if (!isSupportedChainId(chainId)) {
      setError("The connected chain has no CoFHE coprocessor in this client.");
      return;
    }
    if (!engineReady) {
      setError("BidEngine address is not a valid address.");
      return;
    }

    let bid: bigint;
    try {
      bid = parseBasisPoints(basisPoints);
    } catch (caught) {
      setError(errorText(caught));
      return;
    }

    setSealing(true);
    setError(null);
    setSealed(null);
    setDurations({});
    setSteps(idleSteps());

    try {
      await connectCofheClient(publicClient, walletClient);

      const [handle, proof] = await cofheClient
        .encryptInputs([Encryptable.uint32(bid)])
        .setConsumingContract(bidEngineAddress)
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

      const result: SealedBid = { handle, proof };
      setSealed(result);
      onSealed?.(result);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSealing(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl samity-card border border-emerald-200/70 bg-emerald-950/40 p-5">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Seal a discount bid</h2>
        <p className="text-sm text-emerald-50/70">
          The bid is basis points of this cycle&apos;s pot. 10,000 is the whole pot. The ciphertext is bound to
          BidEngine.
        </p>
      </header>

      <dl className="grid gap-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-emerald-50/60">Account</dt>
          <dd className="font-mono">{address ?? "Not connected"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-emerald-50/60">Chain</dt>
          <dd>{chainId == null ? "Not connected" : chainSupported ? String(chainId) : `${chainId} is not a CoFHE chain`}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-emerald-50/60">Creator cap</dt>
          <dd>
            {capQuery.isLoading ? (
              <Skeleton className="inline-block h-3 w-16 align-middle" />
            ) : capQuery.data != null ? (
              `${capQuery.data.toString()} bps`
            ) : capQuery.error ? (
              errorText(capQuery.error)
            ) : (
              "Unavailable"
            )}
          </dd>
        </div>
      </dl>

      {!chainSupported && isConnected ? (
        <p className="text-sm text-emerald-50/70">
          Supported chains: {supportedChains.map((chain) => `${chain.name} (${chain.id})`).join(", ")}.
        </p>
      ) : null}

      <label className="flex flex-col gap-2 text-sm">
        Discount in basis points
        <input
          className="rounded-lg border border-emerald-200/20 bg-black/30 px-3 py-2 font-mono"
          inputMode="numeric"
          autoComplete="off"
          placeholder="500"
          value={basisPoints}
          onChange={(event) => setBasisPoints(event.target.value)}
          disabled={sealing}
        />
      </label>

      <button
        type="button"
        className="w-full rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-40"
        onClick={() => {
          void sealBid();
        }}
        disabled={!canSeal || basisPoints.trim() === ""}
      >
        {sealing ? "Sealing…" : "Seal bid"}
      </button>

      <ol className="flex flex-col gap-2 text-sm">
        {ENCRYPT_STEPS.map((step) => {
          const phase = steps[step];
          const duration = durations[step];
          return (
            <li key={step} className="flex items-baseline justify-between gap-4">
              <span>
                <span className="font-mono text-emerald-200/80">{step}</span>
                <span className="text-emerald-50/60"> · {STEP_LABEL[step]}</span>
              </span>
              <span className="shrink-0 font-mono">
                {phase}
                {phase === "done" && duration != null ? ` · ${duration} ms` : ""}
              </span>
            </li>
          );
        })}
      </ol>

      {sealed ? (
        <dl className="grid gap-2 break-all font-mono text-xs">
          <div>
            <dt className="text-emerald-50/60">Ciphertext handle</dt>
            <dd>{sealed.handle}</dd>
          </div>
          <div>
            <dt className="text-emerald-50/60">Batch proof</dt>
            <dd>{sealed.proof}</dd>
          </div>
        </dl>
      ) : null}

      {error ? <p className="text-sm text-red-300">{error}</p> : null}
    </section>
  );
}
