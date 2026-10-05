import {
  getAddress,
  isAddress,
  parseAbiItem,
  zeroAddress,
  type Address,
  type PublicClient,
} from "viem";
import { erc20Abi, samityAbi } from "@/src/lib/abis";

const joinedEvent = parseAbiItem("event Joined(address indexed account, uint256 index)");
const openedEvent = parseAbiItem("event CycleOpened(uint256 indexed cycle, uint256 openedAt)");

/** Public RPCs often reject an unbounded eth_getLogs. This is the fallback window. */
const WINDOW = 200_000n;
const CHUNK = 50_000n;
const SMALL_CHUNK = 10_000n;

export type SamityRole = "Creator" | "Member";

export type SamityIdentity = {
  creator: Address;
  token: Address;
  installmentAmount: bigint;
  memberCap: bigint;
};

export type MySamityRow = SamityIdentity & {
  address: Address;
  role: SamityRole;
  decimals: number | null;
  symbol: string | null;
};

export type MySamitiesScan = {
  rows: MySamityRow[];
  limited: boolean;
  fromBlock: bigint;
  toBlock: bigint;
};

type LogClient = Pick<PublicClient, "getBlockNumber" | "getLogs" | "multicall">;
type CallClient = Pick<PublicClient, "multicall">;

type CallRow = { status: string; result?: unknown };

function messages(error: unknown, depth = 0): string[] {
  if (!error || typeof error !== "object" || depth > 6) return [];
  const found: string[] = [];
  if ("shortMessage" in error && typeof error.shortMessage === "string") found.push(error.shortMessage);
  if ("message" in error && typeof error.message === "string") found.push(error.message);
  if ("details" in error && typeof error.details === "string") found.push(error.details);
  if ("cause" in error) found.push(...messages(error.cause, depth + 1));
  return found;
}

function isRangeError(error: unknown): boolean {
  const text = messages(error).join("\n").toLowerCase();
  return [
    "block range",
    "too many",
    "query returned more",
    "response size",
    "log limit",
    "exceeded",
    "more than 10000",
    "10,000",
    "10000",
    "pruned",
    "historical",
    "timeout",
    "timed out",
    "eth_getlogs",
  ].some((part) => text.includes(part));
}

function asAddress(row: CallRow | undefined): Address | null {
  if (!row || row.status !== "success" || typeof row.result !== "string" || !isAddress(row.result)) return null;
  if (row.result === zeroAddress) return null;
  return getAddress(row.result);
}

function asUint(row: CallRow | undefined): bigint | null {
  if (!row || row.status !== "success" || typeof row.result !== "bigint") return null;
  return row.result;
}

function asDecimals(row: CallRow | undefined): number | null {
  if (!row || row.status !== "success" || typeof row.result !== "number") return null;
  if (!Number.isInteger(row.result) || row.result < 0 || row.result > 255) return null;
  return row.result;
}

function asString(row: CallRow | undefined): string | null {
  if (!row || row.status !== "success" || typeof row.result !== "string" || row.result === "") return null;
  return row.result;
}

export async function readSamityIdentity(client: CallClient, samity: Address): Promise<SamityIdentity | null> {
  const rows = (await client.multicall({
    allowFailure: true,
    contracts: [
      { address: samity, abi: samityAbi, functionName: "creator" },
      { address: samity, abi: samityAbi, functionName: "token" },
      { address: samity, abi: samityAbi, functionName: "installmentAmount" },
      { address: samity, abi: samityAbi, functionName: "memberCap" },
    ],
  })) as CallRow[];

  const creator = asAddress(rows[0]);
  const token = asAddress(rows[1]);
  const installmentAmount = asUint(rows[2]);
  const memberCap = asUint(rows[3]);
  if (!creator || !token || installmentAmount == null || memberCap == null) return null;
  if (installmentAmount === 0n || memberCap === 0n) return null;
  return { creator, token, installmentAmount, memberCap };
}

async function collect(
  client: LogClient,
  account: Address,
  fromBlock: bigint,
  toBlock: bigint,
  joined: Set<Address>,
  opened: Set<Address>,
) {
  const [joinedLogs, openedLogs] = await Promise.all([
    client.getLogs({ event: joinedEvent, args: { account }, fromBlock, toBlock }),
    client.getLogs({ event: openedEvent, args: { cycle: 1n }, fromBlock, toBlock }),
  ]);
  for (const log of joinedLogs) joined.add(getAddress(log.address));
  for (const log of openedLogs) opened.add(getAddress(log.address));
}

async function collectChunk(
  client: LogClient,
  account: Address,
  fromBlock: bigint,
  toBlock: bigint,
  joined: Set<Address>,
  opened: Set<Address>,
) {
  try {
    await collect(client, account, fromBlock, toBlock, joined, opened);
  } catch (error) {
    if (!isRangeError(error) || toBlock - fromBlock < SMALL_CHUNK) throw error;
    for (let start = fromBlock; start <= toBlock; start += SMALL_CHUNK) {
      const end = start + SMALL_CHUNK - 1n > toBlock ? toBlock : start + SMALL_CHUNK - 1n;
      await collect(client, account, start, end, joined, opened);
    }
  }
}

async function readRows(client: LogClient, addresses: Address[], account: Address, joined: Set<Address>) {
  const rows: MySamityRow[] = [];
  const accountKey = account.toLowerCase();

  for (let offset = 0; offset < addresses.length; offset += 25) {
    const slice = addresses.slice(offset, offset + 25);
    const results = (await client.multicall({
      allowFailure: true,
      contracts: slice.flatMap((address) => [
        { address, abi: samityAbi, functionName: "creator" as const },
        { address, abi: samityAbi, functionName: "token" as const },
        { address, abi: samityAbi, functionName: "installmentAmount" as const },
        { address, abi: samityAbi, functionName: "memberCap" as const },
      ]),
    })) as CallRow[];

    const accepted: Array<SamityIdentity & { address: Address; role: SamityRole }> = [];
    for (let index = 0; index < slice.length; index += 1) {
      const base = index * 4;
      const creator = asAddress(results[base]);
      const token = asAddress(results[base + 1]);
      const installmentAmount = asUint(results[base + 2]);
      const memberCap = asUint(results[base + 3]);
      if (!creator || !token || installmentAmount == null || memberCap == null) continue;
      if (installmentAmount === 0n || memberCap === 0n) continue;
      const isCreator = creator.toLowerCase() === accountKey;
      const isMember = joined.has(slice[index]);
      if (!isCreator && !isMember) continue;
      accepted.push({
        address: slice[index],
        role: isCreator ? "Creator" : "Member",
        creator,
        token,
        installmentAmount,
        memberCap,
      });
    }

    if (accepted.length === 0) continue;

    const meta = (await client.multicall({
      allowFailure: true,
      contracts: accepted.flatMap((row) => [
        { address: row.token, abi: erc20Abi, functionName: "decimals" as const },
        { address: row.token, abi: erc20Abi, functionName: "symbol" as const },
      ]),
    })) as CallRow[];

    accepted.forEach((row, index) => {
      rows.push({
        ...row,
        decimals: asDecimals(meta[index * 2]),
        symbol: asString(meta[index * 2 + 1]),
      });
    });
  }

  rows.sort((left, right) => left.address.localeCompare(right.address));
  return rows;
}

export async function loadMySamities(client: LogClient, account: Address): Promise<MySamitiesScan> {
  const latest = await client.getBlockNumber();
  const joined = new Set<Address>();
  const opened = new Set<Address>();
  let limited = false;
  let fromBlock = 0n;

  try {
    await collect(client, account, 0n, latest, joined, opened);
  } catch (error) {
    if (!isRangeError(error)) throw error;
    limited = true;
    joined.clear();
    opened.clear();
    fromBlock = latest > WINDOW ? latest - WINDOW : 0n;
    for (let start = fromBlock; start <= latest; start += CHUNK) {
      const end = start + CHUNK - 1n > latest ? latest : start + CHUNK - 1n;
      await collectChunk(client, account, start, end, joined, opened);
    }
  }

  const candidates = [...new Set<Address>([...joined, ...opened])];
  const rows = await readRows(client, candidates, account, joined);
  return { rows, limited, fromBlock, toBlock: latest };
}
