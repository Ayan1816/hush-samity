import { numberToHex, type Address, type Hash, type Hex, type PublicClient, type TransactionReceipt, type WalletClient } from "viem";
import { notice } from "@/src/i18n/messages";
import { classifyError } from "@/src/lib/errors";

type ReceiptClient = Pick<PublicClient, "waitForTransactionReceipt" | "getTransaction" | "call">;

type TxSender = Pick<WalletClient, "request">;

/**
 * Submit with `eth_sendTransaction` and return as soon as the wallet gives back the hash.
 * viem's `sendTransaction` / `writeContract` can fall through to `wallet_sendTransaction`,
 * which keeps the wallet popup open until the receipt. The caller waits for the receipt
 * on a public client after this resolves.
 */
export async function sendTransactionHash(
  wallet: TxSender,
  tx: { account: Address; to: Address; data: Hex; value?: bigint },
): Promise<Hash> {
  const hash = await wallet.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: tx.account,
        to: tx.to,
        data: tx.data,
        value: numberToHex(tx.value ?? 0n),
      },
    ],
  });
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    throw notice("errNoTxHash");
  }
  return hash;
}

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
    if (tx.to == null) throw notice("errTxReverted");
    await client.call({
      account: tx.from,
      to: tx.to,
      data: tx.input,
      value: tx.value,
      blockNumber: receipt.blockNumber,
    });
  } catch (error) {
    // A replay that only says the request failed has no contract reason.
    // Anything else is the original revert, so the active language can decode it.
    if (classifyError(error).key !== "errRequestFailed") throw error;
  }

  throw notice("errTxReverted");
}
