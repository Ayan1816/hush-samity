import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  parseAbiItem,
  zeroAddress,
  type Address,
  type PublicClient,
} from "viem";
import { arbitrumSepolia, baseSepolia, sepolia } from "viem/chains";
import { erc20Abi, samityAbi } from "@/src/lib/abis";
import { publicSepoliaRpcUrl, sepoliaRpcUrl } from "@/src/lib/rpc";

const joinedEvent = parseAbiItem("event Joined(address indexed account, uint256 index)");
const openedEvent = parseAbiItem("event CycleOpened(uint256 indexed cycle, uint256 openedAt)");

/** Public RPCs reject wide eth_getLogs ranges. Never send more than this. */
const CHUNK = 10_000n;
const NARROW_CHUNK = 2_000n;
/** Pause between sequential RPC calls so a public endpoint is not burst. */
const GAP_MS = 400;
const MAX_ATTEMPTS = 3;

const SCAN_MEMORY = new Map<string, MySamitiesScan>();
const DEPLOYED_MEMORY = new Map<string, StoredDeploy[]>();
const listeners = new Set<() => void>();

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

type StoredDeploy = {
  address: Address;
  role: SamityRole;
  creator: Address;
  token: Address;
  installmentAmount: string;
  memberCap: string;
  decimals: number | null;
  symbol: string | null;
  blockNumber: string;
};

type StoredScan = {
  rows: Array<Omit<StoredDeploy, "blockNumber">>;
  limited: boolean;
  fromBlock: string;
  toBlock: string;
};

function accountKey(chainId: number, account: Address): string {
  return `${chainId}:${account.toLowerCase()}`;
}

function scanStorageKey(chainId: number, account: Address): string {
  return `hush-samity:v1:scan:${accountKey(chainId, account)}`;
}

function deployedStorageKey(chainId: number, account: Address): string {
  return `hush-samity:v1:deployed:${accountKey(chainId, account)}`;
}

function fromBlockStorageKey(chainId: number): string {
  return `hush-samity:v1:from-block:${chainId}`;
}

export function mySamitiesQueryKey(chainId: number, account: Address) {
  return ["my-samities", chainId, account] as const;
}

export function subscribeSamityCache(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitCache(): void {
  for (const listener of listeners) listener();
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messages(error: unknown, depth = 0): string[] {
  if (!error || typeof error !== "object" || depth > 6) return [];
  const found: string[] = [];
  if ("shortMessage" in error && typeof error.shortMessage === "string") found.push(error.shortMessage);
  if ("message" in error && typeof error.message === "string") found.push(error.message);
  if ("details" in error && typeof error.details === "string") found.push(error.details);
  if ("status" in error && (typeof error.status === "number" || typeof error.status === "string")) {
    found.push(String(error.status));
  }
  if ("cause" in error) found.push(...messages(error.cause, depth + 1));
  return found;
}

const RATE_LIMIT_MESSAGE = "The RPC rate limit was reached. No samities could be loaded.";

function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error && error.message === RATE_LIMIT_MESSAGE) return true;
  const text = messages(error).join("\n").toLowerCase();
  return (
    text.includes("exceeds defined limit") ||
    text.includes("rate limit") ||
    text.includes("too many requests") ||
    text.includes("limit exceeded") ||
    text.includes("429")
  );
}

function rateLimitError(error: unknown): Error | null {
  if (!isRateLimitError(error)) return null;
  if (error instanceof Error && error.message === RATE_LIMIT_MESSAGE) return error;
  return new Error(RATE_LIMIT_MESSAGE);
}

function isRetryable(error: unknown): boolean {
  if (isRateLimitError(error)) return true;
  const text = messages(error).join("\n").toLowerCase();
  return (
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("failed to fetch") ||
    text.includes("network") ||
    text.includes("502") ||
    text.includes("503") ||
    text.includes("504")
  );
}

function isHardRangeError(error: unknown): boolean {
  if (isRateLimitError(error)) return false;
  const text = messages(error).join("\n").toLowerCase();
  return ["block range", "query returned more", "response size", "log limit", "more than 10000", "10,000", "pruned"].some(
    (part) => text.includes(part),
  );
}

function readJson(key: string): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Memory cache still serves this tab when storage is full or blocked.
  }
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

function parseAddress(value: unknown): Address | null {
  if (typeof value !== "string" || !isAddress(value) || value === zeroAddress) return null;
  return getAddress(value);
}

function parseStoredDeploy(value: unknown): StoredDeploy | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const address = parseAddress(row.address);
  const creator = parseAddress(row.creator);
  const token = parseAddress(row.token);
  if (!address || !creator || !token) return null;
  if (row.role !== "Creator" && row.role !== "Member") return null;
  if (typeof row.installmentAmount !== "string" || !/^\d+$/.test(row.installmentAmount)) return null;
  if (typeof row.memberCap !== "string" || !/^\d+$/.test(row.memberCap)) return null;
  if (typeof row.blockNumber !== "string" || !/^\d+$/.test(row.blockNumber)) return null;
  if (row.installmentAmount === "0" || row.memberCap === "0") return null;
  const decimals =
    typeof row.decimals === "number" && Number.isInteger(row.decimals) && row.decimals >= 0 && row.decimals <= 255
      ? row.decimals
      : null;
  const symbol = typeof row.symbol === "string" && row.symbol !== "" ? row.symbol : null;
  return {
    address,
    role: row.role,
    creator,
    token,
    installmentAmount: row.installmentAmount,
    memberCap: row.memberCap,
    decimals,
    symbol,
    blockNumber: row.blockNumber,
  };
}

function storedToRow(row: StoredDeploy): MySamityRow {
  return {
    address: row.address,
    role: row.role,
    creator: row.creator,
    token: row.token,
    installmentAmount: BigInt(row.installmentAmount),
    memberCap: BigInt(row.memberCap),
    decimals: row.decimals,
    symbol: row.symbol,
  };
}

function rowToStored(row: MySamityRow): Omit<StoredDeploy, "blockNumber"> {
  return {
    address: row.address,
    role: row.role,
    creator: row.creator,
    token: row.token,
    installmentAmount: row.installmentAmount.toString(),
    memberCap: row.memberCap.toString(),
    decimals: row.decimals,
    symbol: row.symbol,
  };
}

export function mergeSamityRows(primary: MySamityRow[], extra: MySamityRow[]): MySamityRow[] {
  const map = new Map<string, MySamityRow>();
  for (const row of extra) map.set(row.address.toLowerCase(), row);
  for (const row of primary) map.set(row.address.toLowerCase(), row);
  return [...map.values()].sort((left, right) => left.address.localeCompare(right.address));
}

function readDeployedStored(chainId: number, account: Address): StoredDeploy[] {
  const key = accountKey(chainId, account);
  const memory = DEPLOYED_MEMORY.get(key);
  if (memory) return memory;
  const parsed = readJson(deployedStorageKey(chainId, account));
  if (!Array.isArray(parsed)) return [];
  const rows = parsed.map(parseStoredDeploy).filter((row): row is StoredDeploy => row != null);
  DEPLOYED_MEMORY.set(key, rows);
  return rows;
}

export function readDeployedSamities(chainId: number, account: Address): MySamityRow[] {
  return readDeployedStored(chainId, account).map(storedToRow);
}

function readFromBlock(chainId: number): bigint | null {
  const parsed = readJson(fromBlockStorageKey(chainId));
  if (typeof parsed !== "string" || !/^\d+$/.test(parsed) || parsed === "0") return null;
  return BigInt(parsed);
}

function writeFromBlock(chainId: number, blockNumber: bigint): void {
  if (blockNumber <= 0n) return;
  const current = readFromBlock(chainId);
  if (current != null && current <= blockNumber) return;
  writeJson(fromBlockStorageKey(chainId), blockNumber.toString());
}

export function readCachedScan(chainId: number, account: Address): MySamitiesScan | null {
  const key = accountKey(chainId, account);
  const memory = SCAN_MEMORY.get(key);
  if (memory) return memory;
  const parsed = readJson(scanStorageKey(chainId, account));
  if (!parsed || typeof parsed !== "object") return null;
  const stored = parsed as Partial<StoredScan>;
  if (!Array.isArray(stored.rows)) return null;
  if (typeof stored.fromBlock !== "string" || !/^\d+$/.test(stored.fromBlock)) return null;
  if (typeof stored.toBlock !== "string" || !/^\d+$/.test(stored.toBlock)) return null;
  const rows: MySamityRow[] = [];
  for (const item of stored.rows) {
    const deployed = parseStoredDeploy({ ...(item as object), blockNumber: stored.fromBlock });
    if (deployed) rows.push(storedToRow(deployed));
  }
  const scan: MySamitiesScan = {
    rows,
    limited: stored.limited === true,
    fromBlock: BigInt(stored.fromBlock),
    toBlock: BigInt(stored.toBlock),
  };
  SCAN_MEMORY.set(key, scan);
  return scan;
}

function writeScan(chainId: number, account: Address, scan: MySamitiesScan): void {
  SCAN_MEMORY.set(accountKey(chainId, account), scan);
  const stored: StoredScan = {
    rows: scan.rows.map(rowToStored),
    limited: scan.limited,
    fromBlock: scan.fromBlock.toString(),
    toBlock: scan.toBlock.toString(),
  };
  writeJson(scanStorageKey(chainId, account), stored);
  emitCache();
}

export function rememberDeployedSamity(input: {
  chainId: number;
  account: Address;
  blockNumber: bigint;
  row: MySamityRow;
}): MySamitiesScan {
  const { chainId, account, blockNumber, row } = input;
  const checksummed: MySamityRow = {
    ...row,
    address: getAddress(row.address),
    creator: getAddress(row.creator),
    token: getAddress(row.token),
  };
  const stored: StoredDeploy = {
    ...rowToStored(checksummed),
    blockNumber: blockNumber.toString(),
  };

  const key = accountKey(chainId, account);
  const existing = readDeployedStored(chainId, account).filter(
    (item) => item.address.toLowerCase() !== stored.address.toLowerCase(),
  );
  const deployed = [...existing, stored];
  DEPLOYED_MEMORY.set(key, deployed);
  writeJson(deployedStorageKey(chainId, account), deployed);
  writeFromBlock(chainId, blockNumber);

  const previous = readCachedScan(chainId, account);
  const scan: MySamitiesScan = {
    rows: mergeSamityRows(previous?.rows ?? [], [checksummed]),
    limited: previous?.limited ?? false,
    fromBlock: previous?.fromBlock ?? blockNumber,
    toBlock: previous && previous.toBlock > blockNumber ? previous.toBlock : blockNumber,
  };
  writeScan(chainId, account, scan);
  return scan;
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

function logClient(chainId: number): LogClient {
  const chain =
    chainId === sepolia.id ? sepolia : chainId === arbitrumSepolia.id ? arbitrumSepolia : chainId === baseSepolia.id ? baseSepolia : null;
  if (!chain) throw new Error("Switch to Sepolia");
  const dedicated = chainId === sepolia.id ? sepoliaRpcUrl() : undefined;
  // Temporary: which endpoint the log scan uses. The URL itself can contain a key, so it is not printed.
  console.info(
    `[my-samities] rpc ${dedicated ? "NEXT_PUBLIC_SEPOLIA_RPC_URL" : chainId === sepolia.id ? publicSepoliaRpcUrl : chain.name}`,
  );
  return createPublicClient({
    chain,
    transport: http(dedicated, { retryCount: 0, timeout: 20_000 }),
  });
}

async function readRows(client: LogClient, addresses: Address[], account: Address, joined: Set<Address>, track: RequestCounter) {
  const rows: MySamityRow[] = [];
  const accountLower = account.toLowerCase();

  for (let offset = 0; offset < addresses.length; offset += 25) {
    const slice = addresses.slice(offset, offset + 25);
    const results = (await track(
      `eth_call multicall identity ${offset}-${offset + slice.length - 1}`,
      () =>
        client.multicall({
          allowFailure: true,
          contracts: slice.flatMap((address) => [
            { address, abi: samityAbi, functionName: "creator" as const },
            { address, abi: samityAbi, functionName: "token" as const },
            { address, abi: samityAbi, functionName: "installmentAmount" as const },
            { address, abi: samityAbi, functionName: "memberCap" as const },
          ]),
        }),
    )) as CallRow[];

    const accepted: Array<SamityIdentity & { address: Address; role: SamityRole }> = [];
    for (let index = 0; index < slice.length; index += 1) {
      const base = index * 4;
      const creator = asAddress(results[base]);
      const token = asAddress(results[base + 1]);
      const installmentAmount = asUint(results[base + 2]);
      const memberCap = asUint(results[base + 3]);
      if (!creator || !token || installmentAmount == null || memberCap == null) continue;
      if (installmentAmount === 0n || memberCap === 0n) continue;
      const isCreator = creator.toLowerCase() === accountLower;
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

    const meta = (await track(`eth_call multicall token ${offset}`, () =>
      client.multicall({
        allowFailure: true,
        contracts: accepted.flatMap((row) => [
          { address: row.token, abi: erc20Abi, functionName: "decimals" as const },
          { address: row.token, abi: erc20Abi, functionName: "symbol" as const },
        ]),
      }),
    )) as CallRow[];

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

type RequestCounter = <T>(label: string, run: () => Promise<T>) => Promise<T>;

function createRequestCounter(): { track: RequestCounter; count: () => number } {
  let count = 0;
  let spaced = false;
  const track: RequestCounter = async (label, run) => {
    let last: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      if (spaced) await pause(GAP_MS);
      spaced = true;
      count += 1;
      const request = count;
      // Temporary: remove once the Sepolia log scan is no longer rate limited.
      console.info(`[my-samities] RPC request ${request}: ${label}${attempt > 1 ? ` attempt ${attempt}` : ""}`);
      try {
        return await run();
      } catch (error) {
        last = error;
        const limited = rateLimitError(error);
        if (attempt === MAX_ATTEMPTS || !isRetryable(error)) {
          if (limited) throw limited;
          throw error;
        }
        const waitMs = GAP_MS * 2 ** (attempt - 1);
        console.info(`[my-samities] retrying request ${request} in ${waitMs}ms`);
        await pause(waitMs);
      }
    }
    throw last;
  };
  return { track, count: () => count };
}

async function collectSpan(
  client: LogClient,
  account: Address,
  fromBlock: bigint,
  toBlock: bigint,
  joined: Set<Address>,
  opened: Set<Address>,
  track: RequestCounter,
) {
  const joinedLogs = await track(`eth_getLogs Joined ${fromBlock}-${toBlock}`, () =>
    client.getLogs({ event: joinedEvent, args: { account }, fromBlock, toBlock }),
  );
  for (const log of joinedLogs) joined.add(getAddress(log.address));
  const openedLogs = await track(`eth_getLogs CycleOpened ${fromBlock}-${toBlock}`, () =>
    client.getLogs({ event: openedEvent, args: { cycle: 1n }, fromBlock, toBlock }),
  );
  for (const log of openedLogs) opened.add(getAddress(log.address));
}

async function collectChunk(
  client: LogClient,
  account: Address,
  fromBlock: bigint,
  toBlock: bigint,
  joined: Set<Address>,
  opened: Set<Address>,
  track: RequestCounter,
) {
  try {
    await collectSpan(client, account, fromBlock, toBlock, joined, opened, track);
  } catch (error) {
    const limited = rateLimitError(error);
    if (limited) throw limited;
    if (!isHardRangeError(error) || toBlock - fromBlock < NARROW_CHUNK) throw error;
    for (let start = fromBlock; start <= toBlock; start += NARROW_CHUNK) {
      const end = start + NARROW_CHUNK - 1n > toBlock ? toBlock : start + NARROW_CHUNK - 1n;
      await collectSpan(client, account, start, end, joined, opened, track);
    }
  }
}

export async function loadMySamities(account: Address, chainId: number): Promise<MySamitiesScan> {
  const client = logClient(chainId);
  const counter = createRequestCounter();
  try {
    const latest = await counter.track("eth_blockNumber", () => client.getBlockNumber());
    const deploymentBlock = readFromBlock(chainId);
    let fromBlock = deploymentBlock;
    let limited = false;
    if (fromBlock == null || fromBlock <= 0n || fromBlock > latest) {
      limited = true;
      fromBlock = latest >= CHUNK ? latest - CHUNK + 1n : 0n;
    }
    const chunks = Number((latest - fromBlock) / CHUNK) + 1;
    console.info(
      `[my-samities] scan blocks ${fromBlock.toString()}-${latest.toString()} in ${chunks} chunk(s) of ${CHUNK.toString()}. deployment block ${deploymentBlock == null ? "not saved" : deploymentBlock.toString()}`,
    );

    const joined = new Set<Address>();
    const opened = new Set<Address>();
    for (let start = fromBlock; start <= latest; start += CHUNK) {
      const end = start + CHUNK - 1n > latest ? latest : start + CHUNK - 1n;
      await collectChunk(client, account, start, end, joined, opened, counter.track);
    }

    const candidates = [...new Set<Address>([...joined, ...opened])];
    const rows = await readRows(client, candidates, account, joined, counter.track);
    const scan: MySamitiesScan = {
      rows: mergeSamityRows(rows, readDeployedSamities(chainId, account)),
      limited,
      fromBlock,
      toBlock: latest,
    };
    writeScan(chainId, account, scan);
    return scan;
  } finally {
    console.info(`[my-samities] RPC request count ${counter.count()}`);
  }
}
