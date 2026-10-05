"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatUnits, isAddress, parseUnits, zeroAddress, type Address } from "viem";
import { useAccount, useBytecode, useDeployContract, usePublicClient, useReadContract, useReadContracts } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { erc20Abi, samityAbi } from "@/src/lib/abis";
import { isSupportedChainId } from "@/src/config/cofhe";
import { errorText } from "@/src/lib/errors";

const MAX_DISCOUNT_BPS = 10_000;
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const MONTH_SECONDS = 30 * 24 * 60 * 60;

type Field = "installment" | "collateral" | "members" | "customDuration" | "maxDiscountCap";
type DurationMode = "weekly" | "monthly" | "custom";
type DeployPhase = "idle" | "confirm" | "deploying" | "done";

const EMPTY: Record<Field, string> = {
  installment: "",
  collateral: "",
  members: "",
  customDuration: "",
  maxDiscountCap: "",
};

const DEPLOY_STEPS = [
  { id: "confirm", label: "Confirm in wallet" },
  { id: "deploying", label: "Deploying" },
  { id: "done", label: "Done" },
] as const;

const inputClass = "rounded-lg border bg-black/30 px-3 py-2 font-mono placeholder:text-emerald-50/40";

function wholeNumber(label: string, raw: string): bigint {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) throw new Error(`${label} must be a whole number.`);
  return BigInt(trimmed);
}

function tokenAmount(label: string, raw: string, decimals: number): bigint {
  try {
    const amount = parseUnits(raw.trim(), decimals);
    if (amount === 0n) throw new Error(`${label} must be greater than zero.`);
    return amount;
  } catch (error) {
    if (error instanceof Error && error.message.includes("greater than zero")) throw error;
    throw new Error(`${label} does not fit this token's ${decimals} decimals.`);
  }
}

function bpsConversion(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const bps = Number(trimmed);
  if (!Number.isSafeInteger(bps)) return null;
  const percent = bps / 100;
  const percentText = Number.isInteger(percent) ? String(percent) : percent.toFixed(2).replace(/\.?0+$/, "");
  return `${trimmed} bps = ${percentText}%`;
}

function amountError(label: string, raw: string, decimals: number | undefined, submitted: boolean): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return submitted ? `Enter ${label.toLowerCase()}.` : null;
  if (decimals == null) return null;
  try {
    tokenAmount(label, trimmed, decimals);
    return null;
  } catch (error) {
    return errorText(error);
  }
}

function membersError(raw: string, submitted: boolean): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return submitted ? "Enter members and cycles." : null;
  if (!/^\d+$/.test(trimmed)) return "Members and cycles must be a whole number greater than zero.";
  if (BigInt(trimmed) === 0n) return "Members and cycles must be a whole number greater than zero.";
  return null;
}

function durationSeconds(mode: DurationMode, custom: string): bigint | null {
  if (mode === "weekly") return BigInt(WEEK_SECONDS);
  if (mode === "monthly") return BigInt(MONTH_SECONDS);
  const trimmed = custom.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = BigInt(trimmed);
  return value === 0n ? null : value;
}

function durationError(mode: DurationMode, custom: string, submitted: boolean): string | null {
  if (mode !== "custom") return null;
  const trimmed = custom.trim();
  if (trimmed === "") return submitted ? "Enter the cycle length in seconds." : null;
  if (!/^\d+$/.test(trimmed) || BigInt(trimmed) === 0n) return "Cycle duration must be a whole number of seconds greater than zero.";
  return null;
}

function discountError(raw: string, submitted: boolean): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return submitted ? "Enter a max discount." : null;
  if (!/^\d+$/.test(trimmed)) return "Max discount must be a whole number of basis points.";
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_DISCOUNT_BPS) {
    return "Max discount must be between 1 and 10000 basis points.";
  }
  return null;
}

function txExplorerUrl(chainId: number, hash: `0x${string}`): string | null {
  const chain = wagmiConfig.chains.find((item) => item.id === chainId);
  const base = chain?.blockExplorers?.default.url;
  if (!base) return null;
  return `${base}/tx/${hash}`;
}

function readString(row: { status: string; result?: unknown } | undefined): string | undefined {
  if (!row || row.status !== "success" || typeof row.result !== "string") return undefined;
  return row.result;
}

function readDecimals(row: { status: string; result?: unknown } | undefined): number | undefined {
  if (!row || row.status !== "success") return undefined;
  if (typeof row.result === "number" && Number.isInteger(row.result) && row.result >= 0 && row.result <= 255) return row.result;
  return undefined;
}

function stepMark(phase: DeployPhase, id: (typeof DEPLOY_STEPS)[number]["id"]): "upcoming" | "current" | "complete" {
  const order = { confirm: 0, deploying: 1, done: 2 } as const;
  if (phase === "idle") return "upcoming";
  const current = order[phase];
  const index = order[id];
  if (index < current || phase === "done") return "complete";
  if (index === current) return "current";
  return "upcoming";
}

export function CreateSamity() {
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { deployContractAsync } = useDeployContract();

  const [token, setToken] = useState("");
  const [fields, setFields] = useState(EMPTY);
  const [durationMode, setDurationMode] = useState<DurationMode>("weekly");
  const [submitted, setSubmitted] = useState(false);
  const [phase, setPhase] = useState<DeployPhase>("idle");
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [deployedAddress, setDeployedAddress] = useState<Address | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showToast, setShowToast] = useState(false);

  const trimmedToken = token.trim();
  const tokenIsAddress = isAddress(trimmedToken);
  const tokenAddress = tokenIsAddress && trimmedToken !== zeroAddress ? trimmedToken : undefined;
  const chainReady = isConnected && isSupportedChainId(chainId) && address != null;
  const canRead = tokenAddress != null && chainReady;

  const codeQuery = useBytecode({
    address: tokenAddress,
    chainId,
    query: { enabled: canRead },
  });
  const hasCode = codeQuery.data != null && codeQuery.data !== "0x";

  const metaQuery = useReadContracts({
    allowFailure: true,
    contracts: tokenAddress
      ? [
          { address: tokenAddress, chainId, abi: erc20Abi, functionName: "name" },
          { address: tokenAddress, chainId, abi: erc20Abi, functionName: "symbol" },
          { address: tokenAddress, chainId, abi: erc20Abi, functionName: "decimals" },
        ]
      : [],
    query: { enabled: canRead && hasCode },
  });

  const tokenName = readString(metaQuery.data?.[0]);
  const tokenSymbol = readString(metaQuery.data?.[1]);
  const decimals = readDecimals(metaQuery.data?.[2]);
  const metaReady = tokenName != null && tokenSymbol != null && decimals != null;

  const balanceQuery = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address ?? zeroAddress],
    chainId,
    query: { enabled: canRead && hasCode && metaReady && address != null },
  });

  const readingToken =
    canRead &&
    ((!codeQuery.isFetched && !codeQuery.isError) || (hasCode && !metaQuery.isFetched && !metaQuery.isError));
  const tokenCallFailed =
    canRead &&
    !readingToken &&
    !codeQuery.isError &&
    !metaQuery.isError &&
    ((codeQuery.isFetched && !hasCode) || (hasCode && metaQuery.isFetched && !metaReady));

  const installmentError = amountError("Installment", fields.installment, decimals, submitted);
  const collateralError = amountError("Collateral", fields.collateral, decimals, submitted);
  const membersFieldError = membersError(fields.members, submitted);
  const cycleError = durationError(durationMode, fields.customDuration, submitted);
  const discountFieldError = discountError(fields.maxDiscountCap, submitted);
  const discountHint = bpsConversion(fields.maxDiscountCap);

  const tokenFormatError =
    trimmedToken === ""
      ? null
      : !tokenIsAddress
        ? "Enter a valid token address (0x…)."
        : trimmedToken === zeroAddress
          ? "The zero address is not an ERC-20 contract."
          : canRead && !readingToken && codeQuery.isError
            ? errorText(codeQuery.error)
            : canRead && !readingToken && hasCode && metaQuery.isError
              ? errorText(metaQuery.error)
              : tokenCallFailed
                ? "This address is not an ERC-20 contract."
                : null;

  let blockReason: string | null = null;
  if (!isConnected) blockReason = "Connect wallet first";
  else if (!isSupportedChainId(chainId)) blockReason = "Switch to Sepolia";
  else if (tokenAddress == null) blockReason = "Enter token address";
  else if (readingToken) blockReason = "Reading token from the chain…";
  else if (tokenFormatError) blockReason = tokenFormatError;
  else if (!metaReady) blockReason = "This address is not an ERC-20 contract.";

  const busy = phase === "confirm" || phase === "deploying";
  const txUrl = txHash != null && chainId != null ? txExplorerUrl(chainId, txHash) : null;
  const balanceText =
    decimals != null && balanceQuery.data != null
      ? `${formatUnits(balanceQuery.data, decimals)}${tokenSymbol ? ` ${tokenSymbol}` : ""}`
      : null;

  useEffect(() => {
    if (!showToast) return;
    const timeout = window.setTimeout(() => setShowToast(false), 8000);
    return () => window.clearTimeout(timeout);
  }, [showToast]);

  function setField(field: Field, value: string) {
    setFields((current) => ({ ...current, [field]: value }));
  }

  async function deploy() {
    setSubmitted(true);
    setError(null);
    if (!chainReady || !address || !publicClient || !isSupportedChainId(chainId) || !tokenAddress || decimals == null) {
      return;
    }
    if (
      amountError("Installment", fields.installment, decimals, true) ||
      amountError("Collateral", fields.collateral, decimals, true) ||
      membersError(fields.members, true) ||
      durationError(durationMode, fields.customDuration, true) ||
      discountError(fields.maxDiscountCap, true)
    ) {
      return;
    }

    const installment = tokenAmount("Installment", fields.installment, decimals);
    const collateral = tokenAmount("Collateral", fields.collateral, decimals);
    const members = wholeNumber("Members and cycles", fields.members);
    const cycleDuration = durationSeconds(durationMode, fields.customDuration);
    const maxDiscountCap = wholeNumber("Max discount", fields.maxDiscountCap);
    if (cycleDuration == null || members === 0n || maxDiscountCap < 1n || maxDiscountCap > BigInt(MAX_DISCOUNT_BPS)) {
      return;
    }

    setTxHash(null);
    setDeployedAddress(null);
    setShowToast(false);

    try {
      const response = await fetch("/api/samity-bytecode");
      const body = (await response.json()) as { bytecode?: string; error?: string };
      if (!response.ok || typeof body.bytecode !== "string" || !body.bytecode.startsWith("0x")) {
        throw new Error(body.error ?? "The Samity bytecode response was empty.");
      }

      setPhase("confirm");
      const hash = await deployContractAsync({
        abi: samityAbi,
        bytecode: body.bytecode as `0x${string}`,
        chainId,
        args: [address, tokenAddress, installment, collateral, members, cycleDuration, members, Number(maxDiscountCap)],
      });
      setTxHash(hash);
      setPhase("deploying");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success" || !receipt.contractAddress) {
        throw new Error("The deployment transaction failed.");
      }
      setDeployedAddress(receipt.contractAddress);
      setPhase("done");
      setShowToast(true);
    } catch (caught) {
      setPhase("idle");
      setError(errorText(caught));
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl samity-card border border-emerald-200/70 bg-emerald-950/40 p-5">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Create a new samity</h2>
        <p className="text-sm text-emerald-50/70">
          Deploys <span className="font-mono">Samity</span> with your account as creator. The discount cap is fixed in
          that transaction. Amounts use the token&apos;s on-chain decimals.
        </p>
      </header>

      <label className="flex flex-col gap-2 text-sm">
        Contribution ERC-20
        <input
          className={`${inputClass} ${tokenFormatError ? "border-red-400" : "border-emerald-200/20"}`}
          autoComplete="off"
          spellCheck={false}
          placeholder="0x..."
          aria-invalid={tokenFormatError ? true : undefined}
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
        {tokenFormatError ? <span className="text-sm text-red-300">{tokenFormatError}</span> : null}
        {metaReady ? (
          <span className="text-sm text-emerald-50/80">
            {tokenName} · {tokenSymbol} · {decimals} decimals
            {balanceQuery.isLoading ? " · Balance loading…" : balanceText ? ` · Balance ${balanceText}` : null}
          </span>
        ) : null}
        {metaReady && balanceQuery.isError ? (
          <span className="text-sm text-red-300">Could not read your balance. {errorText(balanceQuery.error)}</span>
        ) : null}
        {canRead && readingToken ? <span className="text-sm text-emerald-50/70">Reading token from the chain…</span> : null}
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label="Installment"
          value={fields.installment}
          placeholder="100"
          inputMode="decimal"
          error={installmentError}
          onChange={(value) => setField("installment", value)}
        />
        <TextField
          label="Collateral"
          value={fields.collateral}
          placeholder="200"
          inputMode="decimal"
          error={collateralError}
          onChange={(value) => setField("collateral", value)}
        />
        <TextField
          label="Members & Cycles"
          detail="Each member wins once, so this number is both the member cap and the number of cycles."
          value={fields.members}
          placeholder="5"
          inputMode="numeric"
          error={membersFieldError}
          onChange={(value) => setField("members", value)}
        />
        <TextField
          label="Max discount (basis points)"
          hint={discountHint}
          value={fields.maxDiscountCap}
          placeholder="500"
          inputMode="numeric"
          error={discountFieldError}
          onChange={(value) => setField("maxDiscountCap", value)}
        />
      </div>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend>Cycle duration</legend>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["weekly", "Weekly"],
              ["monthly", "Monthly"],
              ["custom", "Custom"],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={durationMode === mode}
              className={`rounded-lg border px-3 py-2 ${durationMode === mode ? "border-emerald-300 bg-emerald-400/20" : "border-emerald-200/20 bg-black/30"}`}
              onClick={() => setDurationMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>
        {durationMode === "weekly" ? <p className="text-emerald-50/70">{WEEK_SECONDS} seconds (7 days)</p> : null}
        {durationMode === "monthly" ? <p className="text-emerald-50/70">{MONTH_SECONDS} seconds (30 days)</p> : null}
        {durationMode === "custom" ? (
          <TextField
            label="Custom duration (seconds)"
            value={fields.customDuration}
            placeholder="604800"
            inputMode="numeric"
            error={cycleError}
            onChange={(value) => setField("customDuration", value)}
          />
        ) : null}
      </fieldset>

      <button
        type="button"
        className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-40"
        disabled={blockReason != null || busy}
        onClick={() => {
          void deploy();
        }}
      >
        {phase === "confirm" ? "Confirm in wallet" : phase === "deploying" ? "Deploying" : "Deploy samity"}
      </button>
      {phase === "idle" && blockReason ? <p className="text-sm text-emerald-50/70">{blockReason}</p> : null}

      {phase !== "idle" ? (
        <ol className="flex flex-col gap-1 text-sm">
          {DEPLOY_STEPS.map((step) => {
            const mark = stepMark(phase, step.id);
            return (
              <li key={step.id} className={mark === "upcoming" ? "text-emerald-50/40" : "text-emerald-50"}>
                {mark === "complete" ? "Complete" : mark === "current" ? "Current" : "Waiting"} · {step.label}
              </li>
            );
          })}
        </ol>
      ) : null}
      {txUrl ? (
        <a className="break-all font-mono text-xs text-emerald-200 underline" href={txUrl} target="_blank" rel="noreferrer">
          View transaction
        </a>
      ) : null}
      {deployedAddress ? (
        <Link className="text-sm text-emerald-200 underline" href={`/samity/${deployedAddress}`}>
          Open samity
        </Link>
      ) : null}
      {error ? <p className="text-sm text-red-300">{error}</p> : null}

      {showToast ? (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-50 w-[min(24rem,calc(100%-2rem))] -translate-x-1/2 rounded-lg bg-emerald-400 px-4 py-3 text-sm font-semibold text-emerald-950"
        >
          Samity deployed.
          {txUrl ? (
            <a className="mt-1 block font-mono text-xs underline" href={txUrl} target="_blank" rel="noreferrer">
              View transaction
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function TextField({
  label,
  hint,
  detail,
  value,
  placeholder,
  inputMode,
  error,
  onChange,
}: {
  label: string;
  hint?: string | null;
  detail?: string;
  value: string;
  placeholder: string;
  inputMode: "decimal" | "numeric";
  error: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm">
      <span className="flex items-baseline justify-between gap-3">
        <span>{label}</span>
        {hint ? <span className="text-emerald-50/70">{hint}</span> : null}
      </span>
      {detail ? <span className="text-emerald-50/60">{detail}</span> : null}
      <input
        className={`${inputClass} ${error ? "border-red-400" : "border-emerald-200/20"}`}
        inputMode={inputMode}
        autoComplete="off"
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? <span className="text-sm text-red-300">{error}</span> : null}
    </label>
  );
}
