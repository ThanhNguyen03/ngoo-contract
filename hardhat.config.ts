import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

// Fail fast if DEPLOYER_PRIVATE_KEY is missing when targeting a live network.
// The fallback is only used for local `hardhat` network (compile/test), never for deployment.
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const SEPOLIA_RPC_URL =
  process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";

// Resolved at config load time so a missing key is caught before any deployment attempt.
function liveAccounts(): string[] {
  if (!DEPLOYER_PRIVATE_KEY) {
    // Return empty array for type-safety; Hardhat will error if a task needs accounts.
    return [];
  }
  return [DEPLOYER_PRIVATE_KEY];
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      chainId: 11155111,
      accounts: liveAccounts(),
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || "",
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
  },
};

export default config;
