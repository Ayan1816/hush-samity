import { encodeFunctionData, erc20Abi, getAddress, type Address, type Hex } from "viem";

/** `approve(address,uint256)`. Shared with ERC-721 `approve(address,uint256)`. */
export const ERC20_APPROVE_SELECTOR = "0x095ea7b3";

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
