import { createConfig, http, injected } from "wagmi";
import { arbitrumSepolia, baseSepolia, sepolia } from "wagmi/chains";
import { safe } from "@/lib/safeConnector";

// SDK chain objects carry CoFHE URLs but are not viem `Chain` values.
// These viem chains use the same ids: 11155111, 421614, 84532.
// `injected` comes from the wagmi entry, which re-exports `@wagmi/core`.
// Do not import `wagmi/connectors`: that barrel loads Base Account and Coinbase.
export const wagmiConfig = createConfig({
  chains: [sepolia, arbitrumSepolia, baseSepolia],
  connectors: [injected(), safe()],
  transports: {
    [sepolia.id]: http(),
    [arbitrumSepolia.id]: http(),
    [baseSepolia.id]: http(),
  },
});
