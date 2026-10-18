import { encodeFunctionData, erc20Abi, getAddress, type Address, type Hex } from "viem";

/** `approve(address,uint256)`. Shared with ERC-721 `approve(address,uint256)`. */
export const ERC20_APPROVE_SELECTOR = "0x095ea7b3";

/** uint256 max. Used when a lifetime total does not fit, or when the exact total cannot cover every pull. */
export const MAX_UINT256 = (1n << 256n) - 1n;

function saturatingMul(amount: bigint, times: bigint): bigint {
  if (amount <= 0n || times <= 0n) return MAX_UINT256;
  if (amount > MAX_UINT256 / times) return MAX_UINT256;
  return amount * times;
}

/**
 * Token units one member must cover for the whole samity:
 * `collateralAmount + installmentAmount * totalCycles`.
 * Overflow uses uint256 max.
 *
 * Collateral is pulled by the collateral contract and the installment is pulled
 * by the samity, so this total is approved to each spender that still needs it.
 */
export function wholeSamityAllowance(collateralAmount: bigint, installmentAmount: bigint, totalCycles: bigint): bigint {
  if (collateralAmount <= 0n || installmentAmount <= 0n || totalCycles <= 0n) {
    throw new Error("The samity amounts must be greater than zero.");
  }
  const installments = saturatingMul(installmentAmount, totalCycles);
  if (installments === MAX_UINT256 || collateralAmount > MAX_UINT256 - installments) return MAX_UINT256;
  return collateralAmount + installments;
}

/**
 * Allowance written for one spender during the join approval.
 * Installments use the whole-samity total, which is enough for every cycle.
 * Collateral is pulled again every cycle, so that spender gets enough for every lock
 * (the whole-samity total when that is larger, otherwise uint256 max on overflow).
 */
export function spenderApprovalAmount(
  kind: "collateral" | "installment",
  collateralAmount: bigint,
  installmentAmount: bigint,
  totalCycles: bigint,
): bigint {
  const combined = wholeSamityAllowance(collateralAmount, installmentAmount, totalCycles);
  if (kind === "installment" || combined === MAX_UINT256) return combined;
  const locks = saturatingMul(collateralAmount, totalCycles);
  if (locks === MAX_UINT256) return MAX_UINT256;
  return locks > combined ? locks : combined;
}

/**
 * Canonical ERC-20 approval. `amount` is base units already read from the samity
 * (`installmentAmount` or `collateralAmount`). It is not parsed from a decimal string.
 */
export function encodeErc20Approve(token: Address, spender: Address, amount: bigint): { to: Address; data: Hex; value: 0n } {
  if (typeof amount !== "bigint") {
    throw new Error("The token amount must be an integer in base units.");
  }
  if (amount <= 0n) {
    throw new Error("The token amount must be greater than zero.");
  }
  const to = getAddress(token);
  const spenderAddress = getAddress(spender);
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "approve",
    args: [spenderAddress, amount],
  });
  if (!data.startsWith(ERC20_APPROVE_SELECTOR) || data.length !== 2 + 8 + 64 + 64) {
    throw new Error("The approval payload is not ERC-20 approve(address,uint256).");
  }
  return { to, data, value: 0n };
}
