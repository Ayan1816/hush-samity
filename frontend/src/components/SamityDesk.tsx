"use client";

import { useState } from "react";
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
  useWriteContract,
} from "wagmi";
import { MyBid } from "@/src/components/MyBid";
import { SealBid } from "@/src/components/SealBid";
import { Skeleton } from "@/src/components/Skeleton";
import { pushToast } from "@/src/components/Toast";
import { bidEngineAbi, collateralAbi, erc20Abi, phaseName, samityAbi } from "@/src/lib/abis";
import { encodeErc20Approve } from "@/src/lib/approve";
import { isSupportedChainId } from "@/src/config/cofhe";
import { errorText } from "@/src/lib/errors";
import { waitForSuccess } from "@/src/lib/receipt";

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
    query: { enabled: ready && engineReady && address != null && blockNumber != null },
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

  function reload() {
    void publicQuery.refetch();
    void userQuery.refetch();
    void lockedQuery.refetch();
    void balanceQuery.refetch();
    void submittedQuery.refetch();
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

      {!ready ? null : codeQuery.isLoading ? (
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
              {!windowKnown ? <p className="text-sm text-emerald-50/70">Waiting for the latest block timestamp.</p> : null}
              {windowClosed ? (
                <p className="text-sm text-emerald-50/70">
                  This cycle&apos;s window is closed. Join, collateral, payment, and bids are no longer accepted.
                </p>
              ) : null}
              {windowKnown && !windowClosed && isMember === false && phase === 0 && currentCycle === 1n ? (
                <PullAndCall
                  label="Join and lock collateral"
                  token={token}
                  spender={collateral}
                  amount={collateralAmount}
                  amountLabel={amountText(collateralAmount, decimals, symbol)}
                  samity={samity}
                  chainId={chainId}
                  functionName="join"
                  onDone={reload}
                />
              ) : null}
              {windowKnown && !windowClosed && isMember && slashed === false && hasLocked === false && phase === 0 ? (
                <PullAndCall
                  label="Lock collateral"
                  token={token}
                  spender={collateral}
                  amount={collateralAmount}
                  amountLabel={amountText(collateralAmount, decimals, symbol)}
                  samity={samity}
                  chainId={chainId}
                  functionName="lockCollateral"
                  onDone={reload}
                />
              ) : null}
              {windowKnown && !windowClosed && isMember && slashed === false && hasLocked === true && hasPaid === false && phase === 0 ? (
                <PullAndCall
                  label="Pay installment"
                  token={token}
                  spender={samity}
                  amount={installmentAmount}
                  amountLabel={amountText(installmentAmount, decimals, symbol)}
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
                blockedReason={blockedReason}
                onDone={reload}
              />
              <MyBid bidEngineAddress={bidEngine} />
            </section>
          ) : blockNumber == null || publicQuery.isLoading ? (
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

function PullAndCall({
  label,
  token,
  spender,
  amount,
  amountLabel,
  samity,
  chainId,
  functionName,
  onDone,
}: {
  label: string;
  token: Address;
  spender: Address;
  amount: bigint;
  amountLabel: string;
  samity: Address;
  chainId: number;
  functionName: "join" | "lockCollateral" | "payInstallment";
  onDone: () => void;
}) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId });
  const { data: walletClient } = useWalletClient({ chainId });
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
  const doneText =
    functionName === "join" ? "Joined the samity." : functionName === "lockCollateral" ? "Collateral locked." : "Installment paid.";

  async function run() {
    if (!address || !publicClient || !walletClient) {
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
      if (block.timestamp >= deadline) {
        throw new Error("This cycle's window is closed.");
      }
      if (allowance == null) {
        setError(allowanceQuery.error ? errorText(allowanceQuery.error) : "Waiting for the allowance.");
        return;
      }
      if (allowance < amount) {
        const approval = encodeErc20Approve(token, spender, amount);
        setStatus("Confirm the ERC-20 approval in your wallet.");
        await publicClient.call({
          account: owner,
          to: approval.to,
          data: approval.data,
          value: approval.value,
        });
        const approveHash = await walletClient.sendTransaction({
          account: owner,
          to: approval.to,
          data: approval.data,
          value: approval.value,
        });
        setHash(approveHash);
        setStatus("Waiting for the approval.");
        await waitForSuccess(publicClient, approveHash);
        pushToast("Token approval confirmed.", "ok");
        await allowanceQuery.refetch();
      }
      setStatus("Confirm the samity transaction.");
      const txHash = await writeContractAsync({
        address: samity,
        abi: samityAbi,
        functionName,
        account: owner,
        chainId,
      });
      setHash(txHash);
      setStatus("Waiting for the samity transaction.");
      await waitForSuccess(publicClient, txHash);
      setStatus("Transaction confirmed.");
      pushToast(doneText, "ok");
      onDone();
    } catch (caught) {
      setStatus(null);
      const message = errorText(caught);
      setError(message);
      pushToast(message, "err");
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl samity-card border border-emerald-200/70 bg-emerald-950/40 p-5 text-sm">
      <p className="font-semibold">{label}</p>
      <p className="text-emerald-50/70">
        {needsApproval ? `Approve ${amountLabel} for ${spender}. ` : null}
        Allowance:{" "}
        {allowanceQuery.isError ? (
          errorText(allowanceQuery.error)
        ) : allowanceQuery.isLoading ? (
          <Skeleton className="inline-block h-3 w-24 align-middle" />
        ) : allowance == null ? (
          "Waiting for the allowance."
        ) : (
          `${allowance.toString()} base units`
        )}
        . Required: {amount.toString()} base units ({amountLabel}). The approval is ERC-20 approve(address,uint256).
      </p>
      <button
        type="button"
        className="w-full rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:opacity-40"
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
      await waitForSuccess(publicClient, txHash);
      setStatus("Cycle closed.");
      pushToast("Cycle closed.", "ok");
      onDone();
    } catch (caught) {
      setStatus(null);
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
      setStatus("Confirm submitBid.");
      const txHash = await walletClient.sendTransaction({
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
