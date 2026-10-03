"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { isAddress, parseUnits, zeroAddress } from "viem";
import { useAccount, useDeployContract, usePublicClient, useReadContract } from "wagmi";
import { erc20Abi, samityAbi } from "@/src/lib/abis";
import { isSupportedChainId } from "@/src/config/cofhe";
import { errorText } from "@/src/lib/errors";

const MAX_DISCOUNT_BPS = 10_000;

type Field = "installment" | "collateral" | "memberCap" | "cycleDuration" | "totalCycles" | "maxDiscountCap";

const EMPTY: Record<Field, string> = {
  installment: "",
  collateral: "",
  memberCap: "",
  cycleDuration: "",
  totalCycles: "",
  maxDiscountCap: "",
};

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

export function CreateSamity() {
  const router = useRouter();
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { deployContractAsync, isPending } = useDeployContract();

  const [token, setToken] = useState("");
  const [fields, setFields] = useState(EMPTY);
  const [status, setStatus] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmedToken = token.trim();
  const tokenAddress = isAddress(trimmedToken) && trimmedToken !== zeroAddress ? trimmedToken : undefined;
  const decimalsQuery = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "decimals",
    chainId,
    query: { enabled: tokenAddress != null && isSupportedChainId(chainId) },
  });
  const symbolQuery = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "symbol",
    chainId,
    query: { enabled: tokenAddress != null && isSupportedChainId(chainId) },
  });

  const chainReady = isConnected && isSupportedChainId(chainId) && address != null;
  const decimals = decimalsQuery.data;

  function setField(field: Field, value: string) {
    setFields((current) => ({ ...current, [field]: value }));
  }

  async function deploy() {
    if (!chainReady || !address || !publicClient || !isSupportedChainId(chainId)) {
      setError("Connect a wallet on Ethereum Sepolia, Arbitrum Sepolia, or Base Sepolia.");
      return;
    }
    if (!tokenAddress) {
      setError("Enter the contribution ERC-20 address.");
      return;
    }
    if (decimals == null) {
      setError(decimalsQuery.error ? errorText(decimalsQuery.error) : "Waiting for the token decimals.");
      return;
    }

    setError(null);
    setTxHash(null);
    setStatus(null);

    try {
      const installment = tokenAmount("Installment", fields.installment, decimals);
      const collateral = tokenAmount("Collateral", fields.collateral, decimals);
      const memberCap = wholeNumber("Member cap", fields.memberCap);
      const cycleDuration = wholeNumber("Cycle duration", fields.cycleDuration);
      const totalCycles = wholeNumber("Total cycles", fields.totalCycles);
      const maxDiscountCap = wholeNumber("Max discount", fields.maxDiscountCap);
      if (memberCap === 0n || cycleDuration === 0n || totalCycles === 0n) {
        throw new Error("Member cap, cycle duration, and total cycles must be greater than zero.");
      }
      if (maxDiscountCap > BigInt(MAX_DISCOUNT_BPS)) {
        throw new Error("Max discount cannot be above 10,000 basis points.");
      }

      setStatus("Loading the compiled Samity bytecode.");
      const response = await fetch("/api/samity-bytecode");
      const body = (await response.json()) as { bytecode?: string; error?: string };
      if (!response.ok || typeof body.bytecode !== "string" || !body.bytecode.startsWith("0x")) {
        throw new Error(body.error ?? "The Samity bytecode response was empty.");
      }

      setStatus("Confirm the deployment in the wallet.");
      const hash = await deployContractAsync({
        abi: samityAbi,
        bytecode: body.bytecode as `0x${string}`,
        chainId,
        args: [
          address,
          tokenAddress,
          installment,
          collateral,
          memberCap,
          cycleDuration,
          totalCycles,
          Number(maxDiscountCap),
        ],
      });
      setTxHash(hash);
      setStatus("Waiting for the deployment receipt.");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (!receipt.contractAddress) {
        throw new Error("The receipt did not include a contract address.");
      }
      setStatus(null);
      router.push(`/samity/${receipt.contractAddress}`);
    } catch (caught) {
      setStatus(null);
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
          className="rounded-lg border border-emerald-200/20 bg-black/30 px-3 py-2 font-mono"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(event) => setToken(event.target.value)}
        />
      </label>
      <p className="text-sm text-emerald-50/70">
        {tokenAddress == null
          ? "Token decimals appear after a valid address."
          : decimalsQuery.isLoading
            ? "Reading decimals…"
            : decimalsQuery.error
              ? errorText(decimalsQuery.error)
              : decimals == null
                ? "Decimals were not returned."
                : `${decimalsQuery.data} decimals${symbolQuery.data ? ` · ${symbolQuery.data}` : ""}`}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <AmountField label="Installment" value={fields.installment} onChange={(value) => setField("installment", value)} />
        <AmountField label="Collateral" value={fields.collateral} onChange={(value) => setField("collateral", value)} />
        <AmountField label="Member cap" value={fields.memberCap} onChange={(value) => setField("memberCap", value)} />
        <AmountField
          label="Cycle duration (seconds)"
          value={fields.cycleDuration}
          onChange={(value) => setField("cycleDuration", value)}
        />
        <AmountField label="Total cycles" value={fields.totalCycles} onChange={(value) => setField("totalCycles", value)} />
        <AmountField
          label="Max discount (basis points)"
          value={fields.maxDiscountCap}
          onChange={(value) => setField("maxDiscountCap", value)}
        />
      </div>

      <button
        type="button"
        className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-40"
        disabled={!chainReady || decimals == null || isPending || status != null}
        onClick={() => {
          void deploy();
        }}
      >
        {isPending || status ? "Deploying…" : "Deploy samity"}
      </button>

      {status ? <p className="text-sm text-emerald-50/70">{status}</p> : null}
      {txHash ? <p className="break-all font-mono text-xs">Deployment {txHash}</p> : null}
      {error ? <p className="text-sm text-red-300">{error}</p> : null}
    </section>
  );
}

function AmountField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-2 text-sm">
      {label}
      <input
        className="rounded-lg border border-emerald-200/20 bg-black/30 px-3 py-2 font-mono"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
