import { createConfig, http, injected } from "wagmi";
import { arbitrumSepolia, baseSepolia, sepolia } from "wagmi/chains";
import { safe } from "@/lib/safeConnector";
import { sepoliaHttp } from "@/src/lib/rpc";

// SDK chain objects carry CoFHE URLs but are not viem `Chain` values.
// These viem chains use the same ids: 11155111, 421614, 84532.
// `injected` comes from the wagmi entry, which re-exports `@wagmi/core`.
// Do not import `wagmi/connectors`: that barrel loads Base Account and Coinbase.
// Sepolia uses NEXT_PUBLIC_SEPOLIA_RPC_URL when it is set, otherwise viem's public RPC.
export const wagmiConfig = createConfig({
  chains: [sepolia, arbitrumSepolia, baseSepolia],
  connectors: [injected(), safe()],
  transports: {
    [sepolia.id]: sepoliaHttp(2),
    [arbitrumSepolia.id]: http(),
    [baseSepolia.id]: http(),
  },
});
