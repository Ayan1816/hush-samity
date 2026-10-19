"use client";

import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { formatUnits, getAddress, isAddress, parseUnits, zeroAddress, type Address } from "viem";
import { useAccount, useBytecode, useDeployContract, usePublicClient, useReadContract, useReadContracts } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { Skeleton } from "@/src/components/Skeleton";
import { pushToast } from "@/src/components/Toast";
import { erc20Abi, samityAbi } from "@/src/lib/abis";
import { isSupportedChainId } from "@/src/config/cofhe";
import { useI18n } from "@/src/i18n/LanguageProvider";
import { notice, type Notice } from "@/src/i18n/messages";
import { mySamitiesQueryKey, rememberDeployedSamity } from "@/src/lib/mySamities";
import { waitForSuccess } from "@/src/lib/receipt";

const MAX_DISCOUNT_BPS = 10_000;
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const MONTH_SECONDS = 30 * 24 * 60 * 60;
const TEST_TUSD = "0xafe683fa48d0823772bb290b31720918e5613adc";

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

function bpsConversion(raw: string): { bps: string; percent: string } | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const bps = Number(trimmed);
  if (!Number.isSafeInteger(bps)) return null;
  const percent = bps / 100;
  const percentText = Number.isInteger(percent) ? String(percent) : percent.toFixed(2).replace(/\.?0+$/, "");
  return { bps: trimmed, percent: percentText };
}

function amountError(label: string, raw: string, decimals: number | undefined, submitted: boolean): Notice | null {
  const trimmed = raw.trim();
  if (trimmed === "") return submitted ? notice("errEnterField", { label }) : null;
  if (decimals == null) return null;
  try {
    tokenAmount(label, trimmed, decimals);
    return null;
  } catch (error) {
    if (error instanceof Error && error.message.includes("greater than zero")) return notice("errGreaterThanZero", { label });
    return notice("errDecimals", { label, decimals: decimals ?? 0 });
  }
}

function membersError(raw: string, submitted: boolean): Notice | null {
  const trimmed = raw.trim();
  if (trimmed === "") return submitted ? notice("errEnterMembers") : null;
  if (!/^\d+$/.test(trimmed) || BigInt(trimmed) === 0n) return notice("errMembers");
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

function durationError(mode: DurationMode, custom: string, submitted: boolean): Notice | null {
  if (mode !== "custom") return null;
  const trimmed = custom.trim();
  if (trimmed === "") return submitted ? notice("errEnterSeconds") : null;
  if (!/^\d+$/.test(trimmed) || BigInt(trimmed) === 0n) return notice("errCycleSeconds");
  return null;
}

function quietAmount(raw: string, decimals: number): bigint | null {
  try {
    return tokenAmount("Amount", raw, decimals);
  } catch {
    return null;
  }
}

function quietMembers(raw: string): bigint | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = BigInt(trimmed);
  return value === 0n ? null : value;
}

function quietBps(raw: string): bigint | null {
  if (raw.trim() === "" || discountError(raw, false)) return null;
  return BigInt(raw.trim());
}

function tokenText(amount: bigint | null, decimals: number | undefined, symbol: string | undefined): string {
  if (amount == null || decimals == null) return "—";
  const formatted = formatUnits(amount, decimals);
  return symbol ? `${formatted} ${symbol}` : formatted;
}

function discountError(raw: string, submitted: boolean): Notice | null {
  const trimmed = raw.trim();
  if (trimmed === "") return submitted ? notice("errEnterDiscount") : null;
  if (!/^\d+$/.test(trimmed)) return notice("errDiscountWhole");
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_DISCOUNT_BPS) return notice("errDiscountRange");
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
  const { t, format } = useI18n();
  const queryClient = useQueryClient();
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
  const [error, setError] = useState<unknown>(null);

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

  const tokenName = canRead && hasCode ? readString(metaQuery.data?.[0]) : undefined;
  const tokenSymbol = canRead && hasCode ? readString(metaQuery.data?.[1]) : undefined;
  const decimals = canRead && hasCode ? readDecimals(metaQuery.data?.[2]) : undefined;
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

  const installmentLabel = t("installment");
  const collateralLabel = t("collateral");
  const installmentIssue = amountError(installmentLabel, fields.installment, decimals, submitted);
  const collateralIssue = amountError(collateralLabel, fields.collateral, decimals, submitted);
  const membersIssue = membersError(fields.members, submitted);
  const cycleIssue = durationError(durationMode, fields.customDuration, submitted);
  const discountIssue = discountError(fields.maxDiscountCap, submitted);
  const discountParts = bpsConversion(fields.maxDiscountCap);
  const discountHint = discountParts ? t("bpsHint", discountParts) : null;
  const show = (issue: Notice | null) => (issue ? format(issue) : null);

  const tokenFormatError: Notice | null =
    trimmedToken === ""
      ? null
      : !tokenIsAddress
        ? notice("enterValidToken")
        : trimmedToken === zeroAddress
          ? notice("zeroNotErc20")
          : canRead && !readingToken && codeQuery.isError
            ? notice("errRaw", { text: format(codeQuery.error) })
            : canRead && !readingToken && hasCode && metaQuery.isError
              ? notice("errRaw", { text: format(metaQuery.error) })
              : tokenCallFailed
                ? notice("notErc20")
                : null;

  let blockReason: Notice | null = null;
  if (!isConnected) blockReason = notice("connectWalletFirst");
  else if (!isSupportedChainId(chainId)) blockReason = notice("switchToSepolia");
  else if (tokenAddress == null) blockReason = notice("enterTokenAddress");
  else if (readingToken) blockReason = notice("readingToken");
  else if (tokenFormatError) blockReason = tokenFormatError;
  else if (!metaReady || decimals == null) blockReason = notice("notErc20");
  else
    blockReason =
      amountError(installmentLabel, fields.installment, decimals, true) ??
      amountError(collateralLabel, fields.collateral, decimals, true) ??
      membersError(fields.members, true) ??
      discountError(fields.maxDiscountCap, true);

  const busy = phase === "confirm" || phase === "deploying";
  const txUrl = txHash != null && chainId != null ? txExplorerUrl(chainId, txHash) : null;
  const balanceText =
    canRead && metaReady && decimals != null && balanceQuery.data != null
      ? `${formatUnits(balanceQuery.data, decimals)}${tokenSymbol ? ` ${tokenSymbol}` : ""}`
      : null;

  const memberCount = quietMembers(fields.members);
  const discountBps = quietBps(fields.maxDiscountCap);
  const installmentBase = decimals == null ? null : quietAmount(fields.installment, decimals);
  const collateralBase = decimals == null ? null : quietAmount(fields.collateral, decimals);
  const poolPerRound = installmentBase != null && memberCount != null ? installmentBase * memberCount : null;
  const obligation = installmentBase != null && memberCount != null ? installmentBase * memberCount : null;
  const maxDiscountTokens =
    poolPerRound != null && discountBps != null ? (poolPerRound * discountBps) / BigInt(MAX_DISCOUNT_BPS) : null;
  const summaryLoading = canRead && readingToken;

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
      amountError(installmentLabel, fields.installment, decimals, true) ||
      amountError(collateralLabel, fields.collateral, decimals, true) ||
      membersError(fields.members, true) ||
      durationError(durationMode, fields.customDuration, true) ||
      discountError(fields.maxDiscountCap, true)
    ) {
      return;
    }

    const installment = tokenAmount(installmentLabel, fields.installment, decimals);
    const collateral = tokenAmount(collateralLabel, fields.collateral, decimals);
    const members = wholeNumber(t("membersCycles"), fields.members);
    const cycleDuration = durationSeconds(durationMode, fields.customDuration);
    const maxDiscountCap = wholeNumber(t("maxDiscount"), fields.maxDiscountCap);
    if (cycleDuration == null || members === 0n || maxDiscountCap < 1n || maxDiscountCap > BigInt(MAX_DISCOUNT_BPS)) {
      return;
    }

    setTxHash(null);
    setDeployedAddress(null);

    try {
      const response = await fetch("/api/samity-bytecode");
      const body = (await response.json()) as { bytecode?: string; error?: string };
      if (!response.ok || typeof body.bytecode !== "string" || !body.bytecode.startsWith("0x")) {
        throw body.error ? new Error(body.error) : notice("bytecodeEmpty");
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
      const receipt = await waitForSuccess(publicClient, hash);
      if (!receipt.contractAddress) {
        throw notice("noContractAddress");
      }
      setDeployedAddress(receipt.contractAddress);
      setPhase("done");
      if (chainId != null) {
        const saved = rememberDeployedSamity({
          chainId,
          account: address,
          blockNumber: receipt.blockNumber,
          row: {
            address: receipt.contractAddress,
            role: "Creator",
            creator: address,
            token: getAddress(tokenAddress),
            installmentAmount: installment,
            memberCap: members,
            decimals,
            symbol: tokenSymbol ?? null,
          },
        });
        queryClient.setQueryData(mySamitiesQueryKey(chainId, address), saved);
      }
      pushToast(t("samityDeployed"), "ok");
    } catch (caught) {
      setPhase("idle");
      setError(caught);
      pushToast(format(caught), "err");
    }
  }

  return (
    <section
      id="create-samity"
      className="flex scroll-mt-8 flex-col gap-4 rounded-2xl samity-card border border-emerald-200/70 bg-emerald-950/40 p-5"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{t("createTitle")}</h2>
        <p className="text-sm text-emerald-50/70">{t("createBody")}</p>
      </header>

      <label className="flex flex-col gap-2 text-sm">
        <span className="flex items-baseline justify-between gap-3">
          <span>{t("contributionToken")}</span>
          <button
            type="button"
            className="text-xs font-medium text-emerald-200 underline-offset-2 hover:underline"
            onClick={() => setToken(TEST_TUSD)}
          >
            {t("autofillTusd")}
          </button>
        </span>
        <input
          className={`${inputClass} ${tokenFormatError ? "border-red-400" : "border-emerald-200/20"}`}
          autoComplete="off"
          spellCheck={false}
          placeholder="0x..."
          aria-invalid={tokenFormatError ? true : undefined}
          aria-describedby="contribution-token-help"
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
        <span id="contribution-token-help" className="text-xs text-emerald-50/60">
          {t("tokenHelp")}
        </span>
        {tokenFormatError ? <span className="text-sm text-red-300">{format(tokenFormatError)}</span> : null}
        {metaReady ? (
          <span className="text-sm text-emerald-50/80">
            {t("decimalsMeta", { name: tokenName ?? "", symbol: tokenSymbol ?? "", decimals: decimals ?? "" })}
            {balanceQuery.isLoading ? (
              <>
                {" · "}
                {t("balanceWord")} <Skeleton className="inline-block h-3 w-16 align-middle" />
              </>
            ) : balanceText ? (
              ` · ${t("balanceMeta", { amount: balanceText })}`
            ) : null}
          </span>
        ) : null}
        {metaReady && balanceQuery.isError ? (
          <span className="text-sm text-red-300">{t("couldNotReadBalance", { detail: format(balanceQuery.error) })}</span>
        ) : null}
        {canRead && readingToken ? (
          <span aria-busy="true">
            <Skeleton className="inline-block h-4 w-56" />
          </span>
        ) : null}
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <TextField
          label={t("installment")}
          value={fields.installment}
          placeholder="100"
          inputMode="decimal"
          error={show(installmentIssue)}
          onChange={(value) => setField("installment", value)}
        />
        <TextField
          label={t("collateral")}
          value={fields.collateral}
          placeholder="200"
          inputMode="decimal"
          error={show(collateralIssue)}
          onChange={(value) => setField("collateral", value)}
        />
        <TextField
          label={t("membersCycles")}
          detail={t("membersCyclesDetail")}
          value={fields.members}
          placeholder="5"
          inputMode="numeric"
          error={show(membersIssue)}
          onChange={(value) => setField("members", value)}
        />
        <TextField
          label={t("maxDiscountLabel")}
          hint={discountHint}
          value={fields.maxDiscountCap}
          placeholder="500"
          inputMode="numeric"
          error={show(discountIssue)}
          onChange={(value) => setField("maxDiscountCap", value)}
        />
      </div>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend>{t("cycleDuration")}</legend>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ["weekly", t("weekly")],
              ["monthly", t("monthly")],
              ["custom", t("custom")],
            ] as const
          ).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={durationMode === mode}
              className={`w-full rounded-lg border px-3 py-2 ${durationMode === mode ? "border-emerald-300 bg-emerald-400/20" : "border-emerald-200/20 bg-black/30"}`}
              onClick={() => setDurationMode(mode)}
            >
              {label}
            </button>
          ))}
        </div>
        {durationMode === "weekly" ? <p className="text-emerald-50/70">{t("seconds7", { seconds: WEEK_SECONDS })}</p> : null}
        {durationMode === "monthly" ? <p className="text-emerald-50/70">{t("seconds30", { seconds: MONTH_SECONDS })}</p> : null}
        {durationMode === "custom" ? (
          <TextField
            label={t("customDuration")}
            value={fields.customDuration}
            placeholder="604800"
            inputMode="numeric"
            error={show(cycleIssue)}
            onChange={(value) => setField("customDuration", value)}
          />
        ) : null}
      </fieldset>

      <div
        className="grid grid-cols-1 gap-3 rounded-xl border border-emerald-200/20 bg-black/20 p-4 sm:grid-cols-2"
        aria-busy={summaryLoading}
      >
        <SummaryStat label={t("poolPerRound")} value={tokenText(poolPerRound, decimals, tokenSymbol)} loading={summaryLoading} />
        <SummaryStat
          label={t("totalObligation")}
          value={tokenText(obligation, decimals, tokenSymbol)}
          loading={summaryLoading}
        />
        <SummaryStat label={t("collateral")} value={tokenText(collateralBase, decimals, tokenSymbol)} loading={summaryLoading} />
        <SummaryStat
          label={t("maxDiscount")}
          value={tokenText(maxDiscountTokens, decimals, tokenSymbol)}
          loading={summaryLoading}
        />
      </div>
      <p className="text-xs text-emerald-50/60">{t("summaryFoot")}</p>

      <button
        type="button"
        className={`w-full rounded-lg px-4 py-2 text-sm font-semibold ${
          blockReason != null || busy
            ? "cursor-not-allowed bg-emerald-950 text-emerald-50 ring-1 ring-emerald-200/50"
            : "bg-emerald-400 text-emerald-950"
        }`}
        disabled={blockReason != null || busy}
        onClick={() => {
          void deploy();
        }}
      >
        {phase === "confirm" ? t("confirmInWalletPlain") : phase === "deploying" ? t("deploying") : blockReason ? format(blockReason) : t("deploySamity")}
      </button>

      {phase !== "idle" ? (
        <ol className="flex flex-col gap-1 text-sm">
          {DEPLOY_STEPS.map((step) => {
            const mark = stepMark(phase, step.id);
            return (
              <li key={step.id} className={mark === "upcoming" ? "text-emerald-50/40" : "text-emerald-50"}>
                {mark === "complete" ? t("markComplete") : mark === "current" ? t("markCurrent") : t("markWaiting")} ·{" "}
                {step.id === "confirm" ? t("confirmInWalletPlain") : step.id === "deploying" ? t("deploying") : t("done")}
              </li>
            );
          })}
        </ol>
      ) : null}
      {txUrl ? (
        <a className="break-all font-mono text-xs text-emerald-200 underline" href={txUrl} target="_blank" rel="noreferrer">
          {t("viewTransaction")}
        </a>
      ) : null}
      {deployedAddress ? (
        <Link className="text-sm text-emerald-200 underline" href={`/samity/${deployedAddress}`}>
          {t("openSamity")}
        </Link>
      ) : null}
      {error ? <p className="text-sm text-red-300">{format(error)}</p> : null}
    </section>
  );
}

function SummaryStat({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-emerald-50/60">{label}</p>
      {loading ? <Skeleton className="inline-block h-4 w-28" /> : <p className="break-all font-mono text-xs">{value}</p>}
    </div>
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
      <span>{label}</span>
      <span className="flex flex-wrap items-center gap-2">
        <input
          className={`${inputClass} min-w-0 flex-1 ${error ? "border-red-400" : "border-emerald-200/20"}`}
          inputMode={inputMode}
          autoComplete="off"
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        {hint ? <span className="text-xs text-emerald-100">{hint}</span> : null}
      </span>
      {detail ? <span className="text-xs text-emerald-50/60">{detail}</span> : null}
      {error ? <span className="text-sm text-red-300">{error}</span> : null}
    </label>
  );
}
