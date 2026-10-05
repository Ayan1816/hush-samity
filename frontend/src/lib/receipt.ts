import type { Hash, PublicClient, TransactionReceipt } from "viem";
import { errorText } from "@/src/lib/errors";

type ReceiptClient = Pick<PublicClient, "waitForTransactionReceipt" | "getTransaction" | "call">;

/**
 * Wait for a mined receipt. A reverted receipt is replayed with `eth_call`
 * so viem can decode the contract error. `waitForTransactionReceipt` itself
 * resolves on both success and revert.
 */
export async function waitForSuccess(client: ReceiptClient, hash: Hash): Promise<TransactionReceipt> {
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status === "success") return receipt;

  try {
    const tx = await client.getTransaction({ hash });
    if (tx.to == null) throw new Error("The transaction reverted.");
    await client.call({
      account: tx.from,
      to: tx.to,
      data: tx.input,
      value: tx.value,
      blockNumber: receipt.blockNumber,
    });
  } catch (error) {
    const text = errorText(error);
    if (text !== "The request failed.") throw new Error(text);
  }

  throw new Error("The transaction reverted.");
}
