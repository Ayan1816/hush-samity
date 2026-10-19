import {
  decodeEventLog,
  getAddress,
  isAddress,
  parseAbiItem,
  zeroAddress,
  type Address,
  type Hash,
  type PublicClient,
  type TransactionReceipt,
} from "viem";
import type { MessageKey } from "@/src/i18n/messages";
import { samityAbi } from "@/src/lib/abis";
import { readDeployedBlock, readKnownFromBlock } from "@/src/lib/mySamities";

const settledEvent = parseAbiItem(
  "event CycleSettled(uint256 indexed cycle, address indexed winner, uint32 discountBps, uint256 dividend, uint256 winnerPayout, uint256 retained)",
);
const closedEvent = parseAbiItem("event CycleClosed(uint256 indexed cycle, bool hadBids)");
const preparedEvent = parseAbiItem("event RevealPrepared(uint256 submittedCount)");
const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

/** Inclusive public-RPC log span. A wider query is rejected by the endpoints this app uses. */
const CHUNK = 10_000n;
/** Walk back at most this many spans from the latest block. */
const MAX_CHUNKS = 24;
const GAP_MS = 400;

type ActivityClient = Pick<PublicClient, "multicall" | "getLogs" | "getTransactionReceipt">;
type CallRow = { status: "success" | "failure"; result?: unknown };

export type MemberCredit = {
  account: Address;
  amount: bigint;
};

export type RoundReceipt = {
  cycle: bigint;
  settled: boolean;
  hadBids: boolean;
  winner: Address;
  discountBps: number;
  dividend: bigint;
  winnerPayout: bigint;
  retained: bigint;
  /** Transaction that emitted `CycleClosed` for this round. */
  closeHash: Hash | null;
  /** Transaction that emitted `CycleSettled` for this round. */
  settlementHash: Hash | null;
  /** Outbound samity-token transfers to accounts other than the winner. `null` when the receipt was not read. */
  credits: MemberCredit[] | null;
  /** Sum of token transfers to the winner in the settlement transaction. */
  winnerTransfer: bigint | null;
  /** `RevealPrepared.submittedCount` from the closing transaction. `0` when `hadBids` is false. */
  submittedCount: bigint | null;
  duplicateLogs: boolean;
  notes: ReceiptNote[];
};

export type ReceiptNote = { key: MessageKey } | { error: unknown };

export type ReceiptLoad = {
  blockNumber: bigint;
  receipts: RoundReceipt[];
  fromBlock: bigint | null;
  toBlock: bigint | null;
  /** True when the scan did not start at a saved deployment block inside the walked span. */
  limited: boolean;
  logError: unknown;
};

type LogPick = { hash: Hash; blockNumber: bigint; logIndex: number };

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function lastSettledCycle(currentCycle: bigint, phase: number): bigint {
  if (currentCycle < 1n) throw new Error("currentCycle is below 1.");
  if (phase === 2) return currentCycle;
  if (phase === 0 || phase === 1) return currentCycle - 1n;
  throw new Error("The phase is not bidding, reveal, or complete.");
}

function pick(value: object, key: string, index: number): unknown {
  if (Array.isArray(value)) return value[index];
  const record = value as Record<string | number, unknown>;
  if (key in record) return record[key];
  return record[index];
}

function asCycle(row: CallRow | undefined, cycle: bigint): Omit<
  RoundReceipt,
  "closeHash" | "settlementHash" | "credits" | "winnerTransfer" | "submittedCount" | "duplicateLogs" | "notes"
> & { cycle: bigint } {
  if (!row || row.status !== "success" || row.result == null || typeof row.result !== "object") {
    throw new Error(`cycleResults(${cycle.toString()}) could not be read.`);
  }
  const value = row.result;
  const settled = pick(value, "settled", 0);
  const hadBids = pick(value, "hadBids", 1);
  const winner = pick(value, "winner", 2);
  const rawBps = pick(value, "discountBps", 3);
  const dividend = pick(value, "dividend", 4);
  const winnerPayout = pick(value, "winnerPayout", 5);
  const retained = pick(value, "retained", 6);
  if (typeof settled !== "boolean" || typeof hadBids !== "boolean") {
    throw new Error(`cycleResults(${cycle.toString()}) returned an unexpected value.`);
  }
  if (typeof winner !== "string" || !isAddress(winner)) {
    throw new Error(`cycleResults(${cycle.toString()}) returned no winner address.`);
  }
  const discountBps =
    typeof rawBps === "number" && Number.isInteger(rawBps)
      ? rawBps
      : typeof rawBps === "bigint" && rawBps >= 0n && rawBps <= 10_000n
        ? Number(rawBps)
        : null;
  if (discountBps == null || discountBps < 0 || discountBps > 10_000) {
    throw new Error(`cycleResults(${cycle.toString()}) returned a discount outside basis points.`);
  }
  if (typeof dividend !== "bigint" || typeof winnerPayout !== "bigint" || typeof retained !== "bigint") {
    throw new Error(`cycleResults(${cycle.toString()}) returned no payout figures.`);
  }
  if (dividend < 0n || winnerPayout < 0n || retained < 0n) {
    throw new Error(`cycleResults(${cycle.toString()}) returned a negative amount.`);
  }
  return {
    cycle,
    settled,
    hadBids,
    winner: getAddress(winner),
    discountBps,
    dividend,
    winnerPayout,
    retained,
  };
}

function consider(map: Map<string, LogPick>, duplicates: Set<string>, cycle: bigint, hash: Hash | null, blockNumber: bigint | null, logIndex: number | null) {
  if (hash == null || blockNumber == null) return;
  const key = cycle.toString();
  const next: LogPick = { hash, blockNumber, logIndex: logIndex ?? 0 };
  const prev = map.get(key);
  if (!prev) {
    map.set(key, next);
    return;
  }
  if (prev.hash.toLowerCase() !== next.hash.toLowerCase()) duplicates.add(key);
  const earlier =
    next.blockNumber < prev.blockNumber || (next.blockNumber === prev.blockNumber && next.logIndex < prev.logIndex);
  if (earlier) map.set(key, next);
}

function scanFloor(blockNumber: bigint, hint: bigint | null): { floor: bigint; hintInside: boolean } {
  const span = CHUNK * BigInt(MAX_CHUNKS);
  const earliest = blockNumber > span ? blockNumber - span : 0n;
  if (hint != null && hint <= blockNumber && hint >= earliest) return { floor: hint, hintInside: true };
  return { floor: earliest, hintInside: false };
}

async function readLogs(
  client: ActivityClient,
  samity: Address,
  fromBlock: bigint,
  toBlock: bigint,
  settled: Map<string, LogPick>,
  closed: Map<string, LogPick>,
  duplicates: Set<string>,
) {
  const [settledLogs, closedLogs] = await Promise.all([
    client.getLogs({ address: samity, event: settledEvent, fromBlock, toBlock }),
    client.getLogs({ address: samity, event: closedEvent, fromBlock, toBlock }),
  ]);
  for (const log of settledLogs) {
    if (typeof log.args.cycle !== "bigint") continue;
    consider(settled, duplicates, log.args.cycle, log.transactionHash, log.blockNumber, log.logIndex);
  }
  for (const log of closedLogs) {
    if (typeof log.args.cycle !== "bigint") continue;
    consider(closed, duplicates, log.args.cycle, log.transactionHash, log.blockNumber, log.logIndex);
  }
}

function readPrepared(receipt: TransactionReceipt, bidEngine: Address | null): bigint | null {
  if (bidEngine == null) return null;
  const engine = bidEngine.toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== engine) continue;
    try {
      const decoded = decodeEventLog({
        abi: [preparedEvent],
        data: log.data,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });
      if (decoded.eventName === "RevealPrepared" && typeof decoded.args.submittedCount === "bigint") {
        return decoded.args.submittedCount;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function readTransfers(
  receipt: TransactionReceipt,
  token: Address,
  samity: Address,
  winner: Address,
): { credits: MemberCredit[]; winnerTransfer: bigint } {
  const tokenAddress = token.toLowerCase();
  const fromSamity = samity.toLowerCase();
  const winnerKey = winner.toLowerCase();
  const credits = new Map<string, MemberCredit>();
  let winnerTransfer = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== tokenAddress) continue;
    if (log.topics.length < 3) continue;
    let decoded: { eventName: string; args: { from?: Address; to?: Address; value?: bigint } };
    try {
      decoded = decodeEventLog({
        abi: [transferEvent],
        data: log.data,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      });
    } catch {
      continue;
    }
    if (decoded.eventName !== "Transfer") continue;
    const { from, to, value } = decoded.args;
    if (from == null || to == null || typeof value !== "bigint") continue;
    if (from.toLowerCase() !== fromSamity) continue;
    if (to.toLowerCase() === winnerKey) {
      winnerTransfer += value;
      continue;
    }
    const account = getAddress(to);
    const key = account.toLowerCase();
    const existing = credits.get(key);
    credits.set(key, { account, amount: existing ? existing.amount + value : value });
  }
  return { credits: [...credits.values()], winnerTransfer };
}

export async function loadRoundReceipts(
  client: ActivityClient,
  input: {
    samity: Address;
    bidEngine: Address | null;
    token: Address | null;
    chainId: number;
    account: Address | undefined;
    blockNumber: bigint;
    currentCycle: bigint;
    phase: number;
  },
): Promise<ReceiptLoad> {
  const last = lastSettledCycle(input.currentCycle, input.phase);
  if (last > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("The settled round count does not fit a receipt read.");
  }
  const cycles: bigint[] = [];
  for (let cycle = 1n; cycle <= last; cycle += 1n) cycles.push(cycle);

  const stored: Array<ReturnType<typeof asCycle>> = [];
  for (let offset = 0; offset < cycles.length; offset += 40) {
    const slice = cycles.slice(offset, offset + 40);
    const rows = (await client.multicall({
      allowFailure: true,
      blockNumber: input.blockNumber,
      contracts: slice.map((cycle) => ({
        address: input.samity,
        abi: samityAbi,
        functionName: "cycleResults" as const,
        args: [cycle] as const,
      })),
    })) as CallRow[];
    slice.forEach((cycle, index) => {
      stored.push(asCycle(rows[index], cycle));
    });
  }

  if (stored.length === 0) {
    return {
      blockNumber: input.blockNumber,
      receipts: [],
      fromBlock: null,
      toBlock: null,
      limited: false,
      logError: null,
    };
  }

  const hint =
    input.account != null
      ? (readDeployedBlock(input.chainId, input.account, input.samity) ?? readKnownFromBlock(input.chainId))
      : readKnownFromBlock(input.chainId);
  const { floor, hintInside } = scanFloor(input.blockNumber, hint);
  const settled = new Map<string, LogPick>();
  const closed = new Map<string, LogPick>();
  const duplicates = new Set<string>();
  let fromBlock = input.blockNumber;
  let logError: unknown = null;
  let cursor = input.blockNumber;
  let chunks = 0;

  const missing = () =>
    stored.some((row) => {
      const key = row.cycle.toString();
      return !settled.has(key) || !closed.has(key);
    });

  try {
    while (chunks < MAX_CHUNKS && cursor >= floor && missing()) {
      if (chunks > 0) await pause(GAP_MS);
      const startRaw = cursor + 1n > CHUNK ? cursor - CHUNK + 1n : 0n;
      const start = startRaw < floor ? floor : startRaw;
      await readLogs(client, input.samity, start, cursor, settled, closed, duplicates);
      fromBlock = start;
      chunks += 1;
      if (start === floor || start === 0n) break;
      cursor = start - 1n;
    }
  } catch (caught) {
    logError = caught;
  }

  const cache = new Map<string, TransactionReceipt>();
  async function receiptFor(hash: Hash): Promise<TransactionReceipt> {
    const key = hash.toLowerCase();
    const cached = cache.get(key);
    if (cached) return cached;
    const receipt = await client.getTransactionReceipt({ hash });
    cache.set(key, receipt);
    return receipt;
  }

  const receipts: RoundReceipt[] = [];
  for (const row of stored) {
    const key = row.cycle.toString();
    const closeHash = closed.get(key)?.hash ?? null;
    const settlementHash = settled.get(key)?.hash ?? null;
    const notes: ReceiptNote[] = [];
    let credits: MemberCredit[] | null = null;
    let winnerTransfer: bigint | null = null;
    let submittedCount: bigint | null = row.hadBids ? null : 0n;

    if (!row.hadBids) {
      submittedCount = 0n;
    } else if (closeHash != null && input.bidEngine != null) {
      try {
        const closeReceipt = await receiptFor(closeHash);
        submittedCount = readPrepared(closeReceipt, input.bidEngine);
        if (submittedCount == null) notes.push({ key: "noteNoPrepared" });
      } catch (caught) {
        notes.push({ error: caught });
      }
    } else if (row.hadBids && closeHash == null) {
      notes.push({ key: "noteNoClosed" });
    } else if (input.bidEngine == null) {
      notes.push({ key: "noteNoEngine" });
    }

    if (settlementHash == null) {
      notes.push({ key: "noteNoSettled" });
    } else if (input.token == null) {
      notes.push({ key: "noteNoToken" });
    } else {
      try {
        const settlement = await receiptFor(settlementHash);
        const transfers = readTransfers(settlement, input.token, input.samity, row.winner);
        credits = transfers.credits;
        winnerTransfer = transfers.winnerTransfer;
        if (row.winner !== zeroAddress && winnerTransfer !== row.winnerPayout) {
          notes.push({ key: "noteWinnerMismatch" });
        }
        if (row.dividend >= row.retained) {
          const distributed = transfers.credits.reduce((sum, credit) => sum + credit.amount, 0n);
          if (distributed !== row.dividend - row.retained) {
            notes.push({ key: "noteDividendMismatch" });
          }
        }
      } catch (caught) {
        notes.push({ error: caught });
      }
    }

    receipts.push({
      ...row,
      closeHash,
      settlementHash,
      credits,
      winnerTransfer,
      submittedCount,
      duplicateLogs: duplicates.has(key),
      notes,
    });
  }

  return {
    blockNumber: input.blockNumber,
    receipts,
    fromBlock: stored.length === 0 ? null : fromBlock,
    toBlock: input.blockNumber,
    limited: !hintInside,
    logError,
  };
}
