import { createCofheClient, createCofheConfig } from "@cofhe/sdk/web";
import { chains } from "@cofhe/sdk/chains";
import type { PublicClient, WalletClient } from "viem";

/**
 * Browser chains that have a CoFHE coprocessor.
 * Chain objects come from `@cofhe/sdk/chains`. Their ids match wagmi:
 * Ethereum Sepolia 11155111, Arbitrum Sepolia 421614, Base Sepolia 84532.
 */
export const supportedChains = [chains.sepolia, chains.arbSepolia, chains.baseSepolia] as const;

export const cofheConfig = createCofheConfig({
  supportedChains: [...supportedChains],
});

export const cofheClient = createCofheClient(cofheConfig);

export function isSupportedChainId(chainId: number | undefined): boolean {
  return supportedChains.some((chain) => chain.id === chainId);
}

/**
 * Bind the singleton to the wallet's viem clients.
 * Encrypt and decrypt throw `NotConnected` until this resolves.
 */
export async function connectCofheClient(
  publicClient: PublicClient,
  walletClient: WalletClient,
): Promise<void> {
  await cofheClient.connect(publicClient, walletClient);
}
