import { http } from "viem";
import { sepolia } from "viem/chains";

/**
 * `NEXT_PUBLIC_SEPOLIA_RPC_URL` is inlined at build time.
 * A missing or non-HTTP value falls back to viem's Sepolia public RPC
 * (`sepolia.rpcUrls.default.http[0]`, currently `https://11155111.rpc.thirdweb.com`).
 */
export function sepoliaRpcUrl(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL?.trim();
  if (!raw) return undefined;
  if (!raw.startsWith("https://") && !raw.startsWith("http://")) return undefined;
  return raw;
}

export function sepoliaHttp(retryCount = 2) {
  return http(sepoliaRpcUrl(), {
    retryCount,
    retryDelay: 500,
    timeout: 20_000,
  });
}

export const publicSepoliaRpcUrl = sepolia.rpcUrls.default.http[0];
