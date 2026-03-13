import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
import { NgooPayment as NgooPaymentType } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

// ─── Helpers ────────────────────────────────────────────────────────────────

const CHAIN_ID = 31337n; // Hardhat local chain ID
const PAYMENT_AMOUNT = ethers.parseEther("0.05");

/**
 * Build the raw message hash that the contract computes inside payOrder.
 * Encoding order must match the contract exactly:
 *   keccak256(abi.encode(orderId, payer, amount, nonce, deadline, chainid))
 */
async function buildMessageHash(
  orderId: string,
  payer: string,
  amount: bigint,
  nonce: string,
  deadline: number,
  chainId: bigint = CHAIN_ID,
): Promise<string> {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "address", "uint256", "bytes32", "uint256", "uint256"],
    [orderId, payer, amount, nonce, deadline, chainId],
  );
  return ethers.keccak256(encoded);
}

/**
 * Sign a payment proof with the given signer wallet.
 * Uses eth_sign (EIP-191) prefix to match toEthSignedMessageHash in the contract.
 */
async function signProof(
  signerWallet: ethers.Wallet,
  orderId: string,
  payer: string,
  amount: bigint,
  nonce: string,
  deadline: number,
  chainId: bigint = CHAIN_ID,
): Promise<string> {
  const hash = await buildMessageHash(orderId, payer, amount, nonce, deadline, chainId);
  // wallet.signMessage applies the EIP-191 prefix, matching toEthSignedMessageHash
  return signerWallet.signMessage(ethers.getBytes(hash));
}

// ─── Fixture ────────────────────────────────────────────────────────────────

async function deployFixture() {
  const [owner, user, attacker, withdrawTarget]: HardhatEthersSigner[] = await ethers.getSigners();

  // Dedicated server-side signer (not a Hardhat account — no on-chain funds needed)
  const signerWallet = ethers.Wallet.createRandom();

  const NgooPayment = await ethers.getContractFactory("NgooPayment");
  const contract = (await NgooPayment.deploy(signerWallet.address)) as unknown as NgooPaymentType;
  await contract.waitForDeployment();

  return { contract, owner, user, attacker, withdrawTarget, signerWallet };
}

// ─── Test helpers that produce a valid set of pay params ────────────────────

async function makePayParams(
  signerWallet: ethers.Wallet,
  payerAddress: string,
  overrides: {
    orderId?: string;
    amount?: bigint;
    nonce?: string;
    deadlineOffset?: number;
    chainId?: bigint;
    signerOverride?: ethers.Wallet;
    payerOverride?: string; // address used in the signed hash (differs from actual caller)
  } = {},
) {
  const orderId = overrides.orderId ?? ethers.keccak256(ethers.toUtf8Bytes("test-order-uuid"));
  const amount = overrides.amount ?? PAYMENT_AMOUNT;
  const nonce = overrides.nonce ?? ethers.hexlify(ethers.randomBytes(32));
  const deadline = (await time.latest()) + (overrides.deadlineOffset ?? 900);
  const chainId = overrides.chainId ?? CHAIN_ID;
  const effectiveSigner = overrides.signerOverride ?? signerWallet;
  const payerForHash = overrides.payerOverride ?? payerAddress;

  const signature = await signProof(effectiveSigner, orderId, payerForHash, amount, nonce, deadline, chainId);

  return { orderId, amount, nonce, deadline, signature };
}

// ────────────────────────────────────────────────────────────────────────────
// Test Suite
// ────────────────────────────────────────────────────────────────────────────

describe("NgooPayment", function () {
  // ── Deployment ─────────────────────────────────────────────────────────────
  describe("Deployment", function () {
    it("should set correct owner", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      expect(await contract.owner()).to.equal(owner.address);
    });

    it("should set correct signer", async function () {
      const { contract, signerWallet } = await loadFixture(deployFixture);
      expect(await contract.getFunction("signer")()).to.equal(signerWallet.address);
    });

    it("should revert when signer is zero address", async function () {
      const NgooPayment = await ethers.getContractFactory("NgooPayment");
      await expect(NgooPayment.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        await ethers.getContractFactory("NgooPayment"),
        "ZeroAddress",
      );
    });
  });

  // ── payOrder ───────────────────────────────────────────────────────────────
  describe("payOrder", function () {
    it("should accept valid payment with correct proof", async function () {
      const { contract, user, signerWallet } = await loadFixture(deployFixture);
      const params = await makePayParams(signerWallet, user.address);

      await expect(
        contract.connect(user).payOrder(params.orderId, params.amount, params.nonce, params.deadline, params.signature, {
          value: params.amount,
        }),
      ).to.not.be.reverted;
    });

    it("should revert when deadline is expired", async function () {
      const { contract, user, signerWallet } = await loadFixture(deployFixture);
      const params = await makePayParams(signerWallet, user.address, { deadlineOffset: -1 });

      await expect(
        contract.connect(user).payOrder(params.orderId, params.amount, params.nonce, params.deadline, params.signature, {
          value: params.amount,
        }),
      ).to.be.revertedWithCustomError(contract, "ProofExpired");
    });

    it("should revert on nonce reuse", async function () {
      const { contract, user, signerWallet } = await loadFixture(deployFixture);
      const nonce = ethers.hexlify(ethers.randomBytes(32));

      // First orderId — succeeds
      const params1 = await makePayParams(signerWallet, user.address, {
        orderId: ethers.keccak256(ethers.toUtf8Bytes("order-1")),
        nonce,
      });
      await contract.connect(user).payOrder(params1.orderId, params1.amount, params1.nonce, params1.deadline, params1.signature, {
        value: params1.amount,
      });

      // Second orderId — same nonce, should revert
      const params2 = await makePayParams(signerWallet, user.address, {
        orderId: ethers.keccak256(ethers.toUtf8Bytes("order-2")),
        nonce,
      });
      await expect(
        contract.connect(user).payOrder(params2.orderId, params2.amount, params2.nonce, params2.deadline, params2.signature, {
          value: params2.amount,
        }),
      ).to.be.revertedWithCustomError(contract, "NonceAlreadyUsed");
    });

    it("should revert when order is already paid", async function () {
      const { contract, user, signerWallet } = await loadFixture(deployFixture);
      const orderId = ethers.keccak256(ethers.toUtf8Bytes("order-dup"));

      const params1 = await makePayParams(signerWallet, user.address, { orderId });
      await contract.connect(user).payOrder(params1.orderId, params1.amount, params1.nonce, params1.deadline, params1.signature, {
        value: params1.amount,
      });

      // Different nonce but same orderId
      const params2 = await makePayParams(signerWallet, user.address, { orderId });
      await expect(
        contract.connect(user).payOrder(params2.orderId, params2.amount, params2.nonce, params2.deadline, params2.signature, {
          value: params2.amount,
        }),
      ).to.be.revertedWithCustomError(contract, "OrderAlreadyPaid");
    });

    it("should revert when amount is zero", async function () {
      const { contract, user, signerWallet } = await loadFixture(deployFixture);
      const params = await makePayParams(signerWallet, user.address, { amount: 0n });

      await expect(
        contract.connect(user).payOrder(params.orderId, params.amount, params.nonce, params.deadline, params.signature, {
          value: 0n,
        }),
      ).to.be.revertedWithCustomError(contract, "AmountMustBeNonZero");
    });

    it("should revert when msg.value does not match amount", async function () {
      const { contract, user, signerWallet } = await loadFixture(deployFixture);
      const params = await makePayParams(signerWallet, user.address);

      await expect(
        contract.connect(user).payOrder(params.orderId, params.amount, params.nonce, params.deadline, params.signature, {
          value: ethers.parseEther("0.01"), // wrong amount
        }),
      ).to.be.revertedWithCustomError(contract, "IncorrectPaymentAmount");
    });

    it("should revert when signature is from wrong signer", async function () {
      const { contract, user } = await loadFixture(deployFixture);
      // Use a random wallet that is NOT the registered signer
      const wrongSigner = ethers.Wallet.createRandom();
      const params = await makePayParams(wrongSigner, user.address, { signerOverride: wrongSigner });

      await expect(
        contract.connect(user).payOrder(params.orderId, params.amount, params.nonce, params.deadline, params.signature, {
          value: params.amount,
        }),
      ).to.be.revertedWithCustomError(contract, "InvalidSignature");
    });

    it("should revert when payer does not match signed address", async function () {
      const { contract, user, attacker, signerWallet } = await loadFixture(deployFixture);
      // Signature is valid for `user` but `attacker` is the actual caller
      const params = await makePayParams(signerWallet, user.address, {
        payerOverride: user.address,
      });

      await expect(
        contract.connect(attacker).payOrder(params.orderId, params.amount, params.nonce, params.deadline, params.signature, {
          value: params.amount,
        }),
      ).to.be.revertedWithCustomError(contract, "InvalidSignature");
    });

    it("should revert when contract is paused", async function () {
      const { contract, owner, user, signerWallet } = await loadFixture(deployFixture);
      await contract.connect(owner).pause();

      const params = await makePayParams(signerWallet, user.address);
      await expect(
        contract.connect(user).payOrder(params.orderId, params.amount, params.nonce, params.deadline, params.signature, {
          value: params.amount,
        }),
      ).to.be.revertedWithCustomError(contract, "EnforcedPause");
    });

    it("should emit PaymentReceived event with correct args", async function () {
      const { contract, user, signerWallet } = await loadFixture(deployFixture);
      const params = await makePayParams(signerWallet, user.address);

      await expect(
        contract.connect(user).payOrder(params.orderId, params.amount, params.nonce, params.deadline, params.signature, {
          value: params.amount,
        }),
      )
        .to.emit(contract, "PaymentReceived")
        .withArgs(params.orderId, user.address, params.amount, anyValue);
    });

    it("should record payment correctly in mapping", async function () {
      const { contract, user, signerWallet } = await loadFixture(deployFixture);
      const params = await makePayParams(signerWallet, user.address);

      await contract.connect(user).payOrder(params.orderId, params.amount, params.nonce, params.deadline, params.signature, {
        value: params.amount,
      });

      const record = await contract.getPayment(params.orderId);
      expect(record.orderId).to.equal(params.orderId);
      expect(record.payer).to.equal(user.address);
      expect(record.amount).to.equal(params.amount);
      expect(record.exists).to.be.true;
    });

    it("should mark nonce as used after payment", async function () {
      const { contract, user, signerWallet } = await loadFixture(deployFixture);
      const params = await makePayParams(signerWallet, user.address);

      expect(await contract.usedNonces(params.nonce)).to.be.false;

      await contract.connect(user).payOrder(params.orderId, params.amount, params.nonce, params.deadline, params.signature, {
        value: params.amount,
      });

      expect(await contract.usedNonces(params.nonce)).to.be.true;
    });
  });

  // ── withdraw ───────────────────────────────────────────────────────────────
  describe("withdraw", function () {
    /** Fund the contract with one payment before each withdraw test */
    async function fundedFixture() {
      const base = await deployFixture();
      const params = await makePayParams(base.signerWallet, base.user.address);
      await base.contract.connect(base.user).payOrder(
        params.orderId,
        params.amount,
        params.nonce,
        params.deadline,
        params.signature,
        { value: params.amount },
      );
      return { ...base, params };
    }

    it("should allow owner to withdraw full balance", async function () {
      const { contract, owner, withdrawTarget } = await loadFixture(fundedFixture);
      const balance = await ethers.provider.getBalance(await contract.getAddress());

      await expect(
        contract.connect(owner).withdraw(withdrawTarget.address, balance),
      ).to.changeEtherBalance(withdrawTarget, balance);
    });

    it("should allow owner to withdraw partial balance", async function () {
      const { contract, owner, withdrawTarget } = await loadFixture(fundedFixture);
      const partial = ethers.parseEther("0.01");

      await expect(
        contract.connect(owner).withdraw(withdrawTarget.address, partial),
      ).to.changeEtherBalance(withdrawTarget, partial);
    });

    it("should revert when called by non-owner", async function () {
      const { contract, attacker, withdrawTarget } = await loadFixture(fundedFixture);
      await expect(
        contract.connect(attacker).withdraw(withdrawTarget.address, ethers.parseEther("0.01")),
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });

    it("should revert when balance is insufficient", async function () {
      const { contract, owner, withdrawTarget } = await loadFixture(fundedFixture);
      const tooMuch = ethers.parseEther("100");
      await expect(
        contract.connect(owner).withdraw(withdrawTarget.address, tooMuch),
      ).to.be.revertedWithCustomError(contract, "InsufficientBalance");
    });

    it("should revert when withdrawing to zero address", async function () {
      const { contract, owner } = await loadFixture(fundedFixture);
      await expect(
        contract.connect(owner).withdraw(ethers.ZeroAddress, ethers.parseEther("0.01")),
      ).to.be.revertedWithCustomError(contract, "ZeroAddress");
    });

    it("should emit FundsWithdrawn event", async function () {
      const { contract, owner, withdrawTarget } = await loadFixture(fundedFixture);
      const balance = await ethers.provider.getBalance(await contract.getAddress());

      await expect(
        contract.connect(owner).withdraw(withdrawTarget.address, balance),
      )
        .to.emit(contract, "FundsWithdrawn")
        .withArgs(withdrawTarget.address, balance);
    });

    it("should succeed when paused (emergency recovery)", async function () {
      const { contract, owner, withdrawTarget } = await loadFixture(fundedFixture);
      await contract.connect(owner).pause();

      const balance = await ethers.provider.getBalance(await contract.getAddress());
      await expect(
        contract.connect(owner).withdraw(withdrawTarget.address, balance),
      ).to.not.be.reverted;
    });
  });

  // ── setSigner ──────────────────────────────────────────────────────────────
  describe("setSigner", function () {
    it("should allow owner to rotate signer", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      const newSigner = ethers.Wallet.createRandom();

      await contract.connect(owner).setSigner(newSigner.address);
      expect(await contract.getFunction("signer")()).to.equal(newSigner.address);
    });

    it("should revert when called by non-owner", async function () {
      const { contract, attacker } = await loadFixture(deployFixture);
      const newSigner = ethers.Wallet.createRandom();

      await expect(contract.connect(attacker).setSigner(newSigner.address)).to.be.revertedWithCustomError(
        contract,
        "OwnableUnauthorizedAccount",
      );
    });

    it("should revert when new signer is zero address", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      await expect(contract.connect(owner).setSigner(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        contract,
        "ZeroAddress",
      );
    });

    it("should emit SignerUpdated event", async function () {
      const { contract, owner, signerWallet } = await loadFixture(deployFixture);
      const newSigner = ethers.Wallet.createRandom();

      await expect(contract.connect(owner).setSigner(newSigner.address))
        .to.emit(contract, "SignerUpdated")
        .withArgs(signerWallet.address, newSigner.address);
    });
  });

  // ── Ownable2Step ───────────────────────────────────────────────────────────
  describe("Ownable2Step", function () {
    it("should require pending owner to accept ownership", async function () {
      const { contract, owner, attacker } = await loadFixture(deployFixture);
      const newOwner = attacker;

      await contract.connect(owner).transferOwnership(newOwner.address);

      // Owner is still the original until acceptance
      expect(await contract.owner()).to.equal(owner.address);
      expect(await contract.pendingOwner()).to.equal(newOwner.address);

      // New owner must accept
      await contract.connect(newOwner).acceptOwnership();
      expect(await contract.owner()).to.equal(newOwner.address);
    });

    it("should not transfer ownership without acceptance", async function () {
      const { contract, owner, attacker } = await loadFixture(deployFixture);

      await contract.connect(owner).transferOwnership(attacker.address);

      // Original owner is still in control
      expect(await contract.owner()).to.equal(owner.address);
    });

    it("should revert if non-pending-owner tries to accept", async function () {
      const { contract, owner, user, attacker } = await loadFixture(deployFixture);

      await contract.connect(owner).transferOwnership(user.address);

      await expect(
        contract.connect(attacker).acceptOwnership(),
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });
  });

  // ── Pausable ───────────────────────────────────────────────────────────────
  describe("Pausable", function () {
    it("should allow owner to pause", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      await contract.connect(owner).pause();
      expect(await contract.paused()).to.be.true;
    });

    it("should allow owner to unpause", async function () {
      const { contract, owner } = await loadFixture(deployFixture);
      await contract.connect(owner).pause();
      await contract.connect(owner).unpause();
      expect(await contract.paused()).to.be.false;
    });

    it("should revert payOrder when paused", async function () {
      const { contract, owner, user, signerWallet } = await loadFixture(deployFixture);
      await contract.connect(owner).pause();

      const params = await makePayParams(signerWallet, user.address);
      await expect(
        contract.connect(user).payOrder(params.orderId, params.amount, params.nonce, params.deadline, params.signature, {
          value: params.amount,
        }),
      ).to.be.revertedWithCustomError(contract, "EnforcedPause");
    });

    it("should allow payOrder after unpause", async function () {
      const { contract, owner, user, signerWallet } = await loadFixture(deployFixture);
      await contract.connect(owner).pause();
      await contract.connect(owner).unpause();

      const params = await makePayParams(signerWallet, user.address);
      await expect(
        contract.connect(user).payOrder(params.orderId, params.amount, params.nonce, params.deadline, params.signature, {
          value: params.amount,
        }),
      ).to.not.be.reverted;
    });
  });

  // ── receive / fallback ─────────────────────────────────────────────────────
  describe("receive / fallback", function () {
    it("should revert direct BNB transfers", async function () {
      const { contract, user } = await loadFixture(deployFixture);
      await expect(
        user.sendTransaction({
          to: await contract.getAddress(),
          value: ethers.parseEther("0.01"),
        }),
      ).to.be.revertedWithCustomError(contract, "DirectTransferNotAccepted");
    });

    it("should revert calls with unknown calldata", async function () {
      const { contract, user } = await loadFixture(deployFixture);
      await expect(
        user.sendTransaction({
          to: await contract.getAddress(),
          value: 0n,
          data: "0xdeadbeef",
        }),
      ).to.be.revertedWithCustomError(contract, "DirectTransferNotAccepted");
    });
  });
});
