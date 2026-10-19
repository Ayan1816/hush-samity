import { formatUnits } from "viem";

/** Trim trailing zeros from `formatUnits`. `symbol` is omitted until the token read returns it. */
export function formatTokenAmount(amount: bigint, decimals: number, symbol: string | undefined): string {
  const raw = formatUnits(amount, decimals);
  const trimmed = raw.includes(".") ? raw.replace(/0+$/, "").replace(/\.$/, "") : raw;
  const text = trimmed === "" ? "0" : trimmed;
  return symbol ? `${text} ${symbol}` : text;
}
