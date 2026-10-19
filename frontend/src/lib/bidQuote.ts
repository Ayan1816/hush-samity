/** Basis points in a whole pot. Matches `Samity.BASIS_POINTS`. */
export const BASIS_POINTS = 10_000n;

const UINT256_MAX = (1n << 256n) - 1n;

export type BidQuote = {
  pool: bigint;
  discountAmount: bigint;
  winPayout: bigint;
  dividend: bigint;
};

/**
 * Full-roster quote. `pool = installment * memberCap`.
 * Discount, winner payout, and the other members' dividend use integer division.
 */
export function quoteBid(installment: bigint, memberCap: bigint, discountBps: bigint): BidQuote {
  if (installment < 0n || memberCap < 0n || discountBps < 0n) {
    throw new Error("The bid quote inputs must be non-negative.");
  }
  if (discountBps > BASIS_POINTS) {
    throw new Error("The discount is above 10,000 basis points.");
  }
  if (memberCap > 0n && installment > UINT256_MAX / memberCap) {
    throw new Error("The pool does not fit in uint256.");
  }
  const pool = installment * memberCap;
  if (discountBps > 0n && pool > UINT256_MAX / discountBps) {
    throw new Error("The discount amount does not fit in uint256.");
  }
  const discountAmount = (pool * discountBps) / BASIS_POINTS;
  const winPayout = pool - discountAmount;
  const dividend = memberCap > 1n ? discountAmount / (memberCap - 1n) : 0n;
  return { pool, discountAmount, winPayout, dividend };
}
