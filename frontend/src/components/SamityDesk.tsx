"use client";

import { useState } from "react";
import { formatUnits, isAddress, zeroAddress, type Address, type PublicClient } from "viem";
import {
  useAccount,
  useBlock,
  useBlockNumber,
  useBytecode,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useWriteContract,
} from "wagmi";
import { MyBid } from "@/src/components/MyBid";
import { SealBid } from "@/src/components/SealBid";
import { bidEngineAbi, collateralAbi, erc20Abi, phaseName, samityAbi } from "@/src/lib/abis";
import { isSupportedChainId } from "@/src/config/cofhe";
import { errorText } from "@/src/lib/errors";

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

function amountText(amount: bigint, decimals: number | undefined, symbol: string | undefined): string {
  if (decimals == null) return `${amount.toString()} base units`;
  const formatted = formatUnits(amount, decimals);
  return symbol ? `${formatted} ${symbol}` : formatted;
}

function timeText(value: bigint): string {
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds)) return value.toString();
  return `${value.toString()} · ${new Date(seconds * 1000).toISOString()}`;
}

export function SamityDesk({ samity }: { samity: Address }) {
  const { address, chain } = useAccount();
  const chainId = isSupportedChainId(chain?.id) ? chain.id : undefined;
  const ready = chainId != null;

  const codeQuery = useBytecode({
    address: samity,
    chainId,
    query: { enabled: ready },
  });
  const hasCode = codeQuery.data != null && codeQuery.data !== "0x";

  const blockNumberQuery = useBlockNumber({
    chainId,
    watch: true,
    query: { enabled: ready && hasCode },
  });
  const blockNumber = blockNumberQuery.data;
  const blockQuery = useBlock({
    chainId,
    blockNumber,
    query: { enabled: ready && blockNumber != null },
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
    query: { enabled: ready && hasCode && blockNumber != null },
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
    query: { enabled: ready && hasCode && address != null && blockNumber != null },
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
    query: { enabled: ready && tokenReady && blockNumber != null },
  });
  const symbolQuery = useReadContract({
    address: tokenReady ? token : undefined,
    abi: erc20Abi,
    functionName: "symbol",
    chainId,
    blockNumber,
    query: { enabled: ready && tokenReady && blockNumber != null },
  });
  const balanceQuery = useReadContract({
    address: tokenReady ? token : undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId,
    blockNumber,
    query: { enabled: ready && tokenReady && address != null && blockNumber != null },
  });
  const lockedQuery = useReadContract({
    address: collateralReady ? collateral : undefined,
    abi: collateralAbi,
    functionName: "locked",
    args: address ? [address] : undefined,
    chainId,
    blockNumber,
    query: { enabled: ready && collateralReady && address != null && blockNumber != null },
  });

  const decimals = decimalsQuery.data;
  const symbol = symbolQuery.data;
  const isMember = succeeded<boolean>(userRows?.[0]);
  const slashed = succeeded<boolean>(userRows?.[1]);
  const hasLocked = succeeded<boolean>(userRows?.[2]);
  const hasPaid = succeeded<boolean>(userRows?.[3]);
  const hasWon = succeeded<boolean>(userRows?.[4]);
  const canBid = succeeded<boolean>(userRows?.[5]);
  const windowClosed =
    cycleDeadline != null && blockQuery.data != null && blockQuery.data.timestamp >= cycleDeadline;

  function reload() {
    void publicQuery.refetch();
    void userQuery.refetch();
    void lockedQuery.refetch();
    void balanceQuery.refetch();
  }

  const showActions =
    ready &&
    chainId != null &&
    tokenReady &&
    collateralReady &&
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

      {!ready ? null : codeQuery.isPending ? (
        <p className="text-sm text-emerald-50/70">Reading contract code…</p>
      ) : codeQuery.isError ? (
        <p className="text-sm text-red-300">{errorText(codeQuery.error)}</p>
      ) : !hasCode ? (
        <p className="text-sm text-emerald-50/70">No contract code at this address on {chain?.name}.</p>
      ) : (
        <>
          <div className="grid gap-3 rounded-2xl samity-card border border-emerald-200/70 bg-emerald-950/40 p-5 text-sm sm:grid-cols-2">
            <Stat
              label="Round"
              value={
                failure(rows?.[0]) ??
                (currentCycle == null || totalCycles == null
                  ? "Reading…"
                  : `${currentCycle.toString()} of ${totalCycles.toString()}`)
              }
            />
            <Stat label="Phase" value={failure(rows?.[2]) ?? (phase == null ? "Reading…" : phaseName(phase))} />
            <Stat
              label="Pool"
              value={
                failure(rows?.[3]) ?? (collectedPot == null ? "Reading…" : amountText(collectedPot, decimals, symbol))
              }
            />
            <Stat
              label="Your locked collateral"
              value={
                address == null
                  ? "Connect a wallet."
                  : lockedQuery.isError
                    ? errorText(lockedQuery.error)
                    : lockedQuery.data == null
                      ? "Reading…"
                      : amountText(lockedQuery.data, decimals, symbol)
              }
            />
            <Stat
              label="Deadline"
              value={failure(rows?.[9]) ?? (cycleDeadline == null ? "Reading…" : timeText(cycleDeadline))}
            />
            <Stat
              label="Chain time"
              value={
                blockQuery.isError
                  ? errorText(blockQuery.error)
                  : blockQuery.data == null
                    ? "Reading…"
                    : timeText(blockQuery.data.timestamp)
              }
            />
            <Stat
              label="Members"
              value={
                failure(rows?.[10]) ??
                (memberCount == null || memberCap == null
                  ? "Reading…"
                  : `${memberCount.toString()} of ${memberCap.toString()}`)
              }
            />
            <Stat
              label="Installment"
              value={
                failure(rows?.[7]) ??
                (installmentAmount == null ? "Reading…" : amountText(installmentAmount, decimals, symbol))
              }
            />
            <Stat
              label="Collateral required"
              value={
                failure(rows?.[8]) ??
                (collateralAmount == null ? "Reading…" : amountText(collateralAmount, decimals, symbol))
              }
            />
            <Stat
              label="Max discount"
              value={failure(rows?.[12]) ?? (maxDiscountCap == null ? "Reading…" : `${maxDiscountCap.toString()} bps`)}
            />
            <Stat
              label="Your token balance"
              value={
                address == null
                  ? "Connect a wallet."
                  : balanceQuery.isError
                    ? errorText(balanceQuery.error)
                    : balanceQuery.data == null
                      ? "Reading…"
                      : amountText(balanceQuery.data, decimals, symbol)
              }
            />
            <Stat
              label="Your seat"
              value={
                address == null
                  ? "Connect a wallet."
                  : failure(userRows?.[0]) ??
                    (isMember == null
                      ? "Reading…"
                      : !isMember
                        ? "Not a member."
                        : slashed
                          ? "Slashed."
                          : `Member. Locked this cycle: ${String(hasLocked)}. Paid: ${String(hasPaid)}. Won a round: ${String(hasWon)}.`)
              }
            />
          </div>

          {showActions && token != null && collateral != null ? (
            <section className="flex flex-col gap-3">
              {isMember === false && phase === 0 && currentCycle === 1n ? (
                <PullAndCall
                  label="Join and lock collateral"
                  token={token}
                  spender={collateral}
                  amount={collateralAmount}
                  samity={samity}
                  chainId={chainId}
                  functionName="join"
                  onDone={reload}
                />
              ) : null}
              {isMember && slashed === false && hasLocked === false && phase === 0 ? (
                <PullAndCall
                  label="Lock collateral"
                  token={token}
                  spender={collateral}
                  amount={collateralAmount}
                  samity={samity}
                  chainId={chainId}
                  functionName="lockCollateral"
                  onDone={reload}
                />
              ) : null}
              {isMember && slashed === false && hasLocked === true && hasPaid === false && phase === 0 ? (
                <PullAndCall
                  label="Pay installment"
                  token={token}
                  spender={samity}
                  amount={installmentAmount}
                  samity={samity}
                  chainId={chainId}
                  functionName="payInstallment"
                  onDone={reload}
                />
              ) : null}
              {phase === 0 ? (
                <CloseCycle
                  samity={samity}
                  chainId={chainId}
                  blockReady={blockQuery.data != null}
                  windowClosed={windowClosed}
                  onDone={reload}
                />
              ) : null}
            </section>
          ) : null}

          {engineReady && bidEngine != null && chainId != null ? (
            <section className="flex flex-col gap-4">
              <p className="break-all text-sm text-emerald-50/70">
                BidEngine {bidEngine}. canBid:{" "}
                {address == null ? "connect a wallet" : failure(userRows?.[5]) ?? (canBid == null ? "reading" : String(canBid))}
              </p>
              <SealedBidSubmit bidEngine={bidEngine} chainId={chainId} onDone={reload} />
              <MyBid bidEngineAddress={bidEngine} />
            </section>
          ) : (
            <p className="text-sm text-emerald-50/70">{failure(rows?.[5]) ?? "Reading BidEngine."}</p>
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
      <p className="break-all font-mono text-xs">{value}</p>
    </div>
  );
}

function PullAndCall({
  label,
  token,
  spender,
  amount,
  samity,
  chainId,
  functionName,
  onDone,
}: {
  label: string;
  token: Address;
  spender: Address;
  amount: bigint;
  samity: Address;
  chainId: number;
  functionName: "join" | "lockCollateral" | "payInstallment";
  onDone: () => void;
}) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId });
  const { writeContractAsync } = useWriteContract();
  const allowanceQuery = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, spender] : undefined,
    chainId,
    query: { enabled: address != null },
  });
  const [status, setStatus] = useState<string | null>(null);
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);
  const allowance = allowanceQuery.data;
  const needsApproval = allowance != null && allowance < amount;

  async function run() {
    if (!address || !publicClient) {
      setError("Connect a wallet on this chain.");
      return;
    }
    setError(null);
    setHash(null);
    try {
      if (allowance == null) {
        setError(allowanceQuery.error ? errorText(allowanceQuery.error) : "Waiting for the allowance.");
        return;
      }
      if (allowance < amount) {
        setStatus("Confirm the token approval.");
        const approveHash = await writeContractAsync({
          address: token,
          abi: erc20Abi,
          functionName: "approve",
          args: [spender, amount],
          chainId,
        });
        setHash(approveHash);
        setStatus("Waiting for the approval.");
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
        await allowanceQuery.refetch();
      }
      setStatus("Confirm the samity transaction.");
      const txHash = await writeContractAsync({
        address: samity,
        abi: samityAbi,
        functionName,
        chainId,
      });
      setHash(txHash);
      setStatus("Waiting for the samity transaction.");
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      setStatus("Transaction confirmed.");
      onDone();
    } catch (caught) {
      setStatus(null);
      setError(errorText(caught));
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl samity-card border border-emerald-200/70 bg-emerald-950/40 p-5 text-sm">
      <p className="font-semibold">{label}</p>
      <p className="text-emerald-50/70">
        Allowance: {allowanceQuery.isError ? errorText(allowanceQuery.error) : allowance == null ? "Reading…" : allowance.toString()} base units.
        Required: {amount.toString()} base units.
      </p>
      <button
        type="button"
        className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-40"
        disabled={status != null || allowance == null}
        onClick={() => {
          void run();
        }}
      >
        {status ? "Waiting…" : needsApproval ? "Approve and continue" : label}
      </button>
      {status ? <p className="text-emerald-50/70">{status}</p> : null}
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
  const publicClient = usePublicClient({ chainId });
  const { writeContractAsync, isPending } = useWriteContract();
  const [status, setStatus] = useState<string | null>(null);
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function close() {
    if (!publicClient) {
      setError("No public client for this chain.");
      return;
    }
    setError(null);
    setHash(null);
    setStatus("Confirm closeCycle.");
    try {
      const txHash = await writeContractAsync({
        address: samity,
        abi: samityAbi,
        functionName: "closeCycle",
        chainId,
      });
      setHash(txHash);
      setStatus("Waiting for closeCycle.");
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      setStatus("Cycle closed.");
      onDone();
    } catch (caught) {
      setStatus(null);
      setError(errorText(caught));
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
        className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-40"
        disabled={!windowClosed || isPending || status != null}
        onClick={() => {
          void close();
        }}
      >
        {status ? "Waiting…" : "Close cycle"}
      </button>
      {status ? <p className="text-emerald-50/70">{status}</p> : null}
      {hash ? <p className="break-all font-mono text-xs">{hash}</p> : null}
      {error ? <p className="text-red-300">{error}</p> : null}
    </div>
  );
}

function SealedBidSubmit({
  bidEngine,
  chainId,
  onDone,
}: {
  bidEngine: Address;
  chainId: number;
  onDone: () => void;
}) {
  const publicClient = usePublicClient({ chainId });
  const { writeContractAsync } = useWriteContract();
  const [status, setStatus] = useState<string | null>(null);
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSealed(sealed: { handle: `0x${string}`; proof: `0x${string}` }, client: PublicClient) {
    setError(null);
    setHash(null);
    setStatus("Confirm submitBid.");
    try {
      const txHash = await writeContractAsync({
        address: bidEngine,
        abi: bidEngineAbi,
        functionName: "submitBid",
        args: [sealed.handle, sealed.proof],
        chainId,
      });
      setHash(txHash);
      setStatus("Waiting for submitBid.");
      await client.waitForTransactionReceipt({ hash: txHash });
      setStatus("Bid submitted.");
      onDone();
    } catch (caught) {
      setStatus(null);
      setError(errorText(caught));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <SealBid
        bidEngineAddress={bidEngine}
        onSealed={(sealed) => {
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
