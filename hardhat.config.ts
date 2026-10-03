import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@cofhe/hardhat-plugin";
import * as dotenv from "dotenv";

// The toolbox barrel imports Hardhat Ignition, which loads
// @nomicfoundation/solidity-analyzer. That addon is not published for
// android-arm64. Import it everywhere else so verify, typechain, and
// gas reporting stay available.
if (process.platform !== "android") {
  require("@nomicfoundation/hardhat-toolbox");
}

dotenv.config();

const accounts = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "cancun",
    },
  },
  cofhe: {
    gasWarning: true,
    mocksDeployVerbosity: "v",
  },
  networks: {
    // localcofhe, eth-sepolia, and arb-sepolia are injected by @cofhe/hardhat-plugin.
    // Base Sepolia has no plugin preset.
    "base-sepolia": {
      url: process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org",
      accounts,
      chainId: 84532,
    },
  },
};

export default config;
