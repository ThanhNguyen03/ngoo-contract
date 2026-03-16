# Getting Started

## Prerequisites

- Node.js 18 or later
- yarn (`npm install -g yarn`)
- Git

## 1. Install dependencies

```bash
yarn install
```

This installs Hardhat, the OpenZeppelin contracts library, and all tooling (ethers, chai, TypeChain, solidity-coverage, gas-reporter).

## 2. Compile the contract

```bash
npx hardhat compile
```

Solidity artifacts land in `artifacts/` and TypeScript types land in `typechain-types/`. Both directories are git-ignored.

## 3. Run tests

```bash
npx hardhat test
```

All 30+ test cases should pass with 0 failures. See [Testing Guide](testing-guide.md) for details.

## 4. Run coverage

```bash
npx hardhat coverage
```

Generates an HTML coverage report in `coverage/index.html`. The contract should achieve 100% line and branch coverage.

## 5. Set up environment variables

Copy the example env file and fill in the required values:

```bash
cp .env.example .env
```

Edit `.env`:

```env
DEPLOYER_PRIVATE_KEY=0x<your_deployer_private_key>
SIGNER_ADDRESS=0x<server_signer_public_address>
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
ETHERSCAN_API_KEY=<optional>
```

See [Deployment Guide](deployment-guide.md) for how to obtain each value.

## 6. Deploy to Ethereum Sepolia

```bash
npx hardhat run scripts/deploy.ts --network sepolia
```

The script prints the contract address and the env vars you need to add to ngoo-server-2025.

## 7. Verify on Etherscan (optional)

After deployment the script prints the exact verify command. It looks like:

```bash
npx hardhat verify --network sepolia <CONTRACT_ADDRESS> "<SIGNER_ADDRESS>"
```

Run it once Etherscan has indexed the deployment transaction (usually within 1-2 minutes).
