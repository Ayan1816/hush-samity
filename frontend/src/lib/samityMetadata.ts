import { createPublicClient, getAddress, isAddress, type Address } from "viem";
import { sepolia } from "viem/chains";
import type { Metadata } from "next";
import { translate, type Locale } from "@/src/i18n/messages";
import { erc20Abi, samityAbi } from "@/src/lib/abis";
import { sepoliaHttp } from "@/src/lib/rpc";
import { formatTokenAmount } from "@/src/lib/tokenFormat";

const UINT256_MAX = (1n << 256n) - 1n;

type CallRow = { status: "success" | "failure"; result?: unknown };

function meta(title: string, description: string): Metadata {
  return {
    title,
    description,
    openGraph: { title, description },
    twitter: { card: "summary", title, description },
  };
}

function asUint(row: CallRow | undefined): bigint | null {
  if (!row || row.status !== "success" || typeof row.result !== "bigint" || row.result < 0n) return null;
  return row.result;
}

function asAddress(row: CallRow | undefined): Address | null {
  if (!row || row.status !== "success" || typeof row.result !== "string" || !isAddress(row.result)) return null;
  return getAddress(row.result);
}

/**
 * Open Graph fields from the Samity contract on Ethereum Sepolia.
 * A failed read stays a failure. It does not fill in amounts.
 */
export async function samityOpenGraph(raw: string, locale: Locale = "en"): Promise<Metadata> {
  const title = translate(locale, "samityHeading");
  if (!isAddress(raw)) return meta(title, translate(locale, "invalidUrlAddress"));
  const samity = getAddress(raw);
  try {
    const client = createPublicClient({ chain: sepolia, transport: sepoliaHttp(1) });
    const code = await client.getBytecode({ address: samity });
    if (code == null || code === "0x") return meta(title, translate(locale, "ogNoCodeSepolia"));

    const rows = (await client.multicall({
      allowFailure: true,
      contracts: [
        { address: samity, abi: samityAbi, functionName: "installmentAmount" },
        { address: samity, abi: samityAbi, functionName: "memberCap" },
        { address: samity, abi: samityAbi, functionName: "currentCycle" },
        { address: samity, abi: samityAbi, functionName: "token" },
      ],
    })) as CallRow[];

    const installment = asUint(rows[0]);
    const memberCap = asUint(rows[1]);
    const currentCycle = asUint(rows[2]);
    const token = asAddress(rows[3]);
    if (installment == null || memberCap == null || currentCycle == null || token == null) {
      return meta(title, translate(locale, "ogTermsFailed"));
    }
    if (memberCap > 0n && installment > UINT256_MAX / memberCap) {
      return meta(title, translate(locale, "ogPoolFit"));
    }

    const tokenRows = (await client.multicall({
      allowFailure: true,
      contracts: [
        { address: token, abi: erc20Abi, functionName: "decimals" },
        { address: token, abi: erc20Abi, functionName: "symbol" },
      ],
    })) as CallRow[];
    const decimals =
      tokenRows[0]?.status === "success" &&
      typeof tokenRows[0].result === "number" &&
      Number.isInteger(tokenRows[0].result) &&
      tokenRows[0].result >= 0 &&
      tokenRows[0].result <= 255
        ? tokenRows[0].result
        : null;
    const symbol =
      tokenRows[1]?.status === "success" && typeof tokenRows[1].result === "string" && tokenRows[1].result !== ""
        ? tokenRows[1].result
        : undefined;
    if (decimals == null) return meta(title, translate(locale, "ogDecimalsFailed"));

    const pool = installment * memberCap;
    const roundTitle = translate(locale, "ogRoundTitle", { cycle: currentCycle.toString() });
    const description = translate(locale, "ogDescription", {
      installment: formatTokenAmount(installment, decimals, symbol),
      pool: formatTokenAmount(pool, decimals, symbol),
      cap: memberCap.toString(),
      round: currentCycle.toString(),
      address: samity,
    });
    return meta(roundTitle, description);
  } catch {
    return meta(title, translate(locale, "ogReadFailed"));
  }
}
