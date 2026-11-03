import hardhatNodeTestRunnerPlugin from "@nomicfoundation/hardhat-node-test-runner";
import hardhatKeystorePlugin from "@nomicfoundation/hardhat-keystore";
import hardhatViemPlugin from "@nomicfoundation/hardhat-viem";
import { configVariable, defineConfig } from "hardhat/config";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const localSolc = require.resolve("solc/soljson.js");

export default defineConfig({
  plugins: [
    hardhatViemPlugin,
    hardhatNodeTestRunnerPlugin,
    hardhatKeystorePlugin,
  ],
  solidity: {
    profiles: {
      default: {
        version: "0.8.34",
        path: localSolc,
      },
    },
  },
  networks: {
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    baseSepolia: {
      type: "http",
      chainType: "op",
      chainId: 84532,
      url: configVariable("BASE_SEPOLIA_RPC_URL"),
      accounts: [configVariable("BASE_SEPOLIA_PRIVATE_KEY")],
    },
  },
});

