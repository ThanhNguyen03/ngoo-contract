import { ethers, network } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const signerAddress = process.env.SIGNER_ADDRESS;
  if (!signerAddress) {
    throw new Error("SIGNER_ADDRESS env var is required for deployment");
  }
  if (!ethers.isAddress(signerAddress)) {
    throw new Error(`SIGNER_ADDRESS is not a valid Ethereum address: ${signerAddress}`);
  }

  console.log(`Deploying NgooPayment to network: ${network.name}`);
  console.log(`Signer address: ${signerAddress}`);

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer address: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer balance: ${ethers.formatEther(balance)} ETH`);

  const NgooPayment = await ethers.getContractFactory("NgooPayment");
  const contract = await NgooPayment.deploy(signerAddress);

  console.log("Waiting for deployment...");
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`NgooPayment deployed to: ${address}`);

  // Wait for 5 block confirmations for Etherscan verification
  if (network.name !== "hardhat" && network.name !== "localhost") {
    console.log("Waiting for 5 block confirmations...");
    const tx = contract.deploymentTransaction();
    if (tx) {
      await tx.wait(5);
    }
    console.log("Confirmed!");
    console.log(`\nVerify on Etherscan:`);
    console.log(`npx hardhat verify --network ${network.name} ${address} "${signerAddress}"`);
  }

  console.log("\n=== Deployment Summary ===");
  console.log(`Network:          ${network.name} (chain ID: ${network.config.chainId ?? "unknown"})`);
  console.log(`Contract address: ${address}`);
  console.log(`Signer address:   ${signerAddress}`);
  console.log(`Deployer:         ${deployer.address}`);
  console.log("\nUpdate ngoo-server-2025 env vars:");
  console.log(`NGOO_CONTRACT_ADDRESS=${address}`);
  console.log(`NGOO_CHAIN_ID=11155111`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
