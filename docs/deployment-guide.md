# Deployment Guide

## 1. Get Sepolia ETH from the faucet

You need a small amount of Sepolia ETH to cover gas fees.

1. Open https://sepoliafaucet.com
2. Paste your deployer wallet address and request Sepolia ETH.
3. Wait ~30 seconds for the funds to arrive.

## 2. Generate a dedicated deployment wallet

Never reuse a personal wallet or the production signer wallet for deployment.

```bash
# Using ethers in a Node.js REPL or a one-off script
node -e "const {ethers} = require('ethers'); const w = ethers.Wallet.createRandom(); console.log('address:', w.address); console.log('privateKey:', w.privateKey);"
```

Copy the private key into `.env` as `DEPLOYER_PRIVATE_KEY`. Send it enough Sepolia ETH for gas (0.05 Sepolia ETH is more than enough).

## 3. Generate a dedicated signer wallet

The signer wallet signs payment proofs on the server. Only the **public address** is needed here; the private key stays in ngoo-server-2025's `.env` as `NGOO_SIGNER_PRIVATE_KEY`.

```bash
node -e "const {ethers} = require('ethers'); const w = ethers.Wallet.createRandom(); console.log('signerAddress:', w.address); console.log('signerPrivateKey:', w.privateKey);"
```

- Set `SIGNER_ADDRESS=<signerAddress>` in this project's `.env`.
- Set `NGOO_SIGNER_PRIVATE_KEY=<signerPrivateKey>` in ngoo-server-2025's `.env`.

## 4. Fill in `.env`

```bash
cp .env.example .env
```

```env
DEPLOYER_PRIVATE_KEY=0x<deployer_private_key>
SIGNER_ADDRESS=0x<signer_public_address>
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
ETHERSCAN_API_KEY=<optional_for_verification>
```

## 5. Compile and run tests first

Always verify the contract compiles and all tests pass before deploying:

```bash
npx hardhat compile
npx hardhat test
```

## 6. Deploy

```bash
npx hardhat run scripts/deploy.ts --network sepolia
```

The script will print output like:

```
Deploying NgooPayment to network: sepolia
Signer address: 0xABCD...
Deployer address: 0x1234...
Deployer balance: 0.5 ETH
Waiting for deployment...
NgooPayment deployed to: 0x9999...
Waiting for 5 block confirmations...
Confirmed!

Verify on Etherscan:
npx hardhat verify --network sepolia 0x9999... "0xABCD..."

=== Deployment Summary ===
Network:          sepolia (chain ID: 11155111)
Contract address: 0x9999...
Signer address:   0xABCD...
Deployer:         0x1234...

Update ngoo-server-2025 env vars:
NGOO_CONTRACT_ADDRESS=0x9999...
NGOO_CHAIN_ID=11155111
```

## 7. Update ngoo-server-2025

Add these to ngoo-server-2025's `.env`:

```env
NGOO_CONTRACT_ADDRESS=0x9999...
NGOO_CHAIN_ID=11155111
NGOO_SIGNER_PRIVATE_KEY=0x<signer_private_key>
```

## 8. ABI location

The compiled ABI is at:

```
artifacts/contracts/NgooPayment.sol/NgooPayment.json
```

Copy the `abi` array from this file into ngoo-server-2025's contract integration module.

## 9. Verify on Etherscan (recommended)

Run the verify command printed by the deploy script. Source code verification allows anyone to audit the contract logic on sepolia.etherscan.io and enables ABI-based interaction directly from the explorer.

If Etherscan hasn't indexed the deployment yet, wait 1-2 minutes and retry.
