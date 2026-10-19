import { getAddress, parseAbiItem, zeroAddress, type Address, type PublicClient } from "viem";
import { bidEngineAbi, samityAbi } from "@/src/lib/abis";
import { readDeployedBlock, readKnownFromBlock } from "@/src/lib/mySamities";

const lockedEvent = parseAbiItem("event CollateralLocked(address indexed account, uint256 indexed cycle)");
const paidEvent = parseAbiItem("event InstallmentPaid(address indexed account, uint256 indexed cycle, uint256 amount)");
const sealedEvent = parseAbiItem("event BidSubmitted(address indexed account)");
const openedEvent = parseAbiItem("event CycleOpened(uint256 indexed cycle, uint256 openedAt)");

/** One public-RPC log span. A wider query is rejected by the Sepolia endpoints this app uses. */
const LOG_SPAN = 9_999n;

export type MemberActivity = {
  account: Address;
  locked: boolean;
  paid: boolean;
  slashed: boolean;
  /** `null` when BidEngine was not readable. Never a stand-in for "no bid". */
  sealed: boolean | null;
};

export type RoundLogs = {
  fromBlock: bigint;
  toBlock: bigint;
  /** True when `CycleOpened` for this round is inside the scanned blocks, so the log sets are complete. */
  cycleOpenedInWindow: boolean;
  lockedAccounts: Address[];
  paidAccounts: Address[];
  sealedAccounts: Address[];
};

export type RoundActivity = {
  blockNumber: bigint;
  members: MemberActivity[];
  submittedCount: bigint | null;
  logs: RoundLogs | null;
  logError: unknown;
};

type CallRow = { status: "success" | "failure"; result?: unknown };

type ActivityClient = Pick<PublicClient, "multicall" | "getLogs">;

function asAddress(row: CallRow | undefined): Address {
  if (!row || row.status !== "success" || typeof row.result !== "string" || !row.result.startsWith("0x")) {
    throw new Error("A member address read failed.");
  }
  return getAddress(row.result as Address);
}

function asBool(row: CallRow | undefined, label: string): boolean {
  if (!row || row.status !== "success" || typeof row.result !== "boolean") {
    throw new Error(`${label} could not be read.`);
  }
  return row.result;
}

function asUint(row: CallRow | undefined, label: string): bigint {
  if (!row || row.status !== "success" || typeof row.result !== "bigint") {
    throw new Error(`${label} could not be read.`);
  }
  return row.result;
}

function uniqueAddresses(values: readonly (Address | null | undefined)[]): Address[] {
  const seen = new Set<string>();
  const out: Address[] = [];
  for (const value of values) {
    if (value == null || value === zeroAddress) continue;
    const account = getAddress(value);
    const key = account.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(account);
  }
  return out;
}

function logWindow(blockNumber: bigint, hint: bigint | null): { fromBlock: bigint; toBlock: bigint } {
  const latestStart = blockNumber > LOG_SPAN ? blockNumber - LOG_SPAN : 0n;
  if (hint != null && hint <= blockNumber && hint > latestStart) {
    return { fromBlock: hint, toBlock: blockNumber };
  }
  return { fromBlock: latestStart, toBlock: blockNumber };
}

async function readRoundLogs(
  client: ActivityClient,
  samity: Address,
  bidEngine: Address | null,
  cycle: bigint,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<RoundLogs> {
  const opened = await client.getLogs({
    address: samity,
    event: openedEvent,
    args: { cycle },
    fromBlock,
    toBlock,
  });
  const openedBlock = opened.reduce<bigint | null>((min, log) => {
    if (log.blockNumber == null) return min;
    if (min == null || log.blockNumber < min) return log.blockNumber;
    return min;
  }, null);

  const [lockedLogs, paidLogs] = await Promise.all([
    client.getLogs({
      address: samity,
      event: lockedEvent,
      args: { cycle },
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: samity,
      event: paidEvent,
      args: { cycle },
      fromBlock,
      toBlock,
    }),
  ]);

  let sealedAccounts: Address[] = [];
  if (bidEngine != null && openedBlock != null) {
    const sealedLogs = await client.getLogs({
      address: bidEngine,
      event: sealedEvent,
      fromBlock: openedBlock,
      toBlock,
    });
    sealedAccounts = uniqueAddresses(sealedLogs.map((log) => log.args.account));
  }

  return {
    fromBlock,
    toBlock,
    cycleOpenedInWindow: openedBlock != null,
    lockedAccounts: uniqueAddresses(lockedLogs.map((log) => log.args.account)),
    paidAccounts: uniqueAddresses(paidLogs.map((log) => log.args.account)),
    sealedAccounts,
  };
}

export async function loadRoundActivity(
  client: ActivityClient,
  input: {
    samity: Address;
    bidEngine: Address | null;
    chainId: number;
    account: Address | undefined;
    blockNumber: bigint;
    cycle: bigint;
    memberCount: bigint;
  },
): Promise<RoundActivity> {
  if (input.memberCount < 0n) throw new Error("memberCount is negative.");
  if (input.memberCount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("memberCount does not fit a roster read.");
  }
  const n = Number(input.memberCount);
  let members: MemberActivity[] = [];
  let submittedCount: bigint | null = null;

  if (n > 0) {
    const roster = (await client.multicall({
      allowFailure: true,
      blockNumber: input.blockNumber,
      contracts: Array.from({ length: n }, (_, index) => ({
        address: input.samity,
        abi: samityAbi,
        functionName: "memberAt" as const,
        args: [BigInt(index)] as const,
      })),
    })) as CallRow[];
    const addresses = roster.map((row) => asAddress(row));
    const stride = input.bidEngine == null ? 3 : 4;
    const flags = (await client.multicall({
      allowFailure: true,
      blockNumber: input.blockNumber,
      contracts: addresses.flatMap((account) => {
        const reads = [
          {
            address: input.samity,
            abi: samityAbi,
            functionName: "hasLocked" as const,
            args: [account] as const,
          },
          {
            address: input.samity,
            abi: samityAbi,
            functionName: "hasPaid" as const,
            args: [account] as const,
          },
          {
            address: input.samity,
            abi: samityAbi,
            functionName: "slashed" as const,
            args: [account] as const,
          },
        ];
        if (input.bidEngine == null) return reads;
        return [
          ...reads,
          {
            address: input.bidEngine,
            abi: bidEngineAbi,
            functionName: "hasSubmitted" as const,
            args: [account] as const,
          },
        ];
      }),
    })) as CallRow[];

    members = addresses.map((account, index) => {
      const base = index * stride;
      return {
        account,
        locked: asBool(flags[base], "hasLocked"),
        paid: asBool(flags[base + 1], "hasPaid"),
        slashed: asBool(flags[base + 2], "slashed"),
        sealed: input.bidEngine == null ? null : asBool(flags[base + 3], "hasSubmitted"),
      };
    });
  }

  if (input.bidEngine != null) {
    const rows = (await client.multicall({
      allowFailure: true,
      blockNumber: input.blockNumber,
      contracts: [
        {
          address: input.bidEngine,
          abi: bidEngineAbi,
          functionName: "submittedCount" as const,
        },
      ],
    })) as CallRow[];
    submittedCount = asUint(rows[0], "submittedCount");
  }

  const hint =
    input.account != null
      ? (readDeployedBlock(input.chainId, input.account, input.samity) ?? readKnownFromBlock(input.chainId))
      : readKnownFromBlock(input.chainId);
  const window = logWindow(input.blockNumber, hint);

  let logs: RoundLogs | null = null;
  let logError: unknown = null;
  try {
    logs = await readRoundLogs(client, input.samity, input.bidEngine, input.cycle, window.fromBlock, window.toBlock);
  } catch (caught) {
    logError = caught;
  }

  return {
    blockNumber: input.blockNumber,
    members,
    submittedCount,
    logs,
    logError,
  };
}
