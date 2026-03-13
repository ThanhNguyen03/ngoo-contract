# PLAN.md — ngoo-contract

Comprehensive implementation plan for the **NgooPayment** smart contract.
Generated: 2026-03-12 | Status: **In Progress**

---

## Context

This project implements on-chain crypto payment for the **Ngoo food ordering platform** (`ngoo-server-2025`). Users who have connected their wallet (Sprint 4.1) can pay for orders using tBNB on BNB Testnet.

**Target chain:** BNB Testnet (chain ID 97)
**Design principles:**
1. Security first — OpenZeppelin for all crypto primitives, no custom ECDSA
2. High-reputation libraries only (Hardhat, OpenZeppelin, ethers v6)
3. Free-tier RPC providers only (official BNB Testnet RPC)
4. Full test coverage with security-focused test suite
5. NatSpec documentation on all public/external functions

---

## Architecture

### Payment Flow

```
Client (dApp)
    │
    ▼
GraphQL API: createOrder(paymentMethod: CRYPTO)
    │
    ▼
Server: CryptoPaymentService.generatePaymentProof()
    │  - Converts USD → wei via CoinGecko price oracle
    │  - Generates nonce (bytes32)
    │  - Sets deadline (15 min)
    │  - Signs: keccak256(abi.encode(orderId, payer, amount, nonce, deadline, chainId))
    │  - Stores proof in Redis with TTL
    │
    ▼
Client receives: { orderId, amount, nonce, deadline, signature, contractAddress, chainId }
    │
    ▼
Client calls: NgooPayment.payOrder(orderId, amount, nonce, deadline, signature) { value: amount }
    │  - Contract verifies: deadline, nonce, orderId, msg.value, ECDSA signature
    │  - Records payment, emits PaymentReceived event
    │
    ▼
Server: CryptoEventMonitor (polling every 15s)
    │  - Picks up PaymentReceived event after 5 block confirmations
    │  - Verifies against stored proof in Redis
    │  - Updates Order → PAID, Payment → SUCCESS (with txHash)
    │  - Emits Socket.IO notification to client
    │  - Logs audit event
```

### Encoding Alignment (CRITICAL)

Contract and server MUST use identical encoding:

| Side | Encoding | Hash |
|------|----------|------|
| **Contract** | `keccak256(abi.encode(orderId, msg.sender, amount, nonce, deadline, block.chainid))` | Then `toEthSignedMessageHash()` via OpenZeppelin |
| **Server** | `keccak256(AbiCoder.defaultAbiCoder().encode(types, values))` | Then `wallet.signMessage(getBytes(messageHash))` (ethers auto-prefixes) |

Both use `abi.encode` (NOT `abi.encodePacked`) to prevent hash collision edge cases.

---

## Smart Contract Design: NgooPayment.sol

### Improvements Over Original PLAN.md Draft (Section 4.3.2)

| Original Draft Issue | Fix |
|---|---|
| Manual `_recoverSigner` with inline assembly `ecrecover` | OpenZeppelin `ECDSA.recover` + `MessageHashUtils.toEthSignedMessageHash` (rejects signature malleability via EIP-2 `s`-value check) |
| No re-entrancy guard on `withdraw` | `ReentrancyGuard.nonReentrant` |
| No emergency stop mechanism | `Pausable` with `whenNotPaused` on `payOrder` |
| Manual `owner` + `onlyOwner` modifier | OpenZeppelin `Ownable` (zero-address checks, ownership transfer) |
| No `receive()`/`fallback()` protection | `receive() external payable { revert(); }` rejects accidental BNB |
| `abi.encodePacked` for hash | `abi.encode` prevents hash collision edge cases |

### Contract Interface

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract NgooPayment is Ownable, ReentrancyGuard, Pausable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    address public signer;

    struct PaymentRecord {
        bytes32 orderId;
        address payer;
        uint256 amount;
        uint256 timestamp;
        bool exists;
    }

    mapping(bytes32 => PaymentRecord) public payments;
    mapping(bytes32 => bool) public usedNonces;

    event PaymentReceived(bytes32 indexed orderId, address indexed payer, uint256 amount, uint256 timestamp);
    event FundsWithdrawn(address indexed to, uint256 amount);
    event SignerUpdated(address indexed oldSigner, address indexed newSigner);

    constructor(address _signer) Ownable(msg.sender);

    // Core payment function
    function payOrder(
        bytes32 orderId,
        uint256 amount,
        bytes32 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external payable whenNotPaused;

    // Admin functions
    function withdraw(address payable to, uint256 amount) external onlyOwner nonReentrant;
    function setSigner(address _newSigner) external onlyOwner;
    function pause() external onlyOwner;
    function unpause() external onlyOwner;

    // View functions
    function getPayment(bytes32 orderId) external view returns (PaymentRecord memory);

    // Reject accidental transfers
    receive() external payable; // reverts
}
```

### `payOrder` Flow (8 Steps)

1. `require(block.timestamp <= deadline)` — proof expiry
2. `require(!usedNonces[nonce])` — replay prevention
3. `require(!payments[orderId].exists)` — double-payment prevention
4. `require(msg.value == amount)` — exact amount match
5. `messageHash = keccak256(abi.encode(orderId, msg.sender, amount, nonce, deadline, block.chainid))`
6. `ethSignedHash = messageHash.toEthSignedMessageHash()`
7. `require(ethSignedHash.recover(signature) == signer)` — OpenZeppelin ECDSA verification
8. Record payment → mark nonce used → emit `PaymentReceived`

---

## Test Suite (23+ Cases)

**File:** `test/NgooPayment.test.ts`

```
describe("NgooPayment")

  describe("Deployment")
    ✓ Sets correct owner and signer
    ✓ Rejects zero-address signer

  describe("payOrder")
    ✓ Accepts valid payment with correct proof
    ✓ Rejects expired deadline
    ✓ Rejects reused nonce
    ✓ Rejects already-paid orderId
    ✓ Rejects incorrect msg.value
    ✓ Rejects invalid signature (wrong signer)
    ✓ Rejects wrong payer (msg.sender mismatch in signed message)
    ✓ Rejects when paused
    ✓ Emits PaymentReceived with correct args
    ✓ Records payment in mapping correctly

  describe("withdraw")
    ✓ Owner can withdraw
    ✓ Non-owner cannot withdraw
    ✓ Rejects insufficient balance
    ✓ Protected against reentrancy
    ✓ Emits FundsWithdrawn event

  describe("setSigner")
    ✓ Owner can rotate signer
    ✓ Non-owner cannot rotate
    ✓ Rejects zero address
    ✓ Emits SignerUpdated event

  describe("Pausable")
    ✓ Owner can pause/unpause
    ✓ payOrder reverts when paused
    ✓ withdraw works when paused (emergency fund recovery)

  describe("Receive/Fallback")
    ✓ Rejects direct BNB transfers
```

---

## Security Analysis

### Threat Model

| Risk | Severity | Mitigation |
|------|----------|-----------|
| **Signature malleability** | Critical | OpenZeppelin `ECDSA.recover` enforces EIP-2 low-`s` check |
| **Replay attack (same chain)** | Critical | `usedNonces` mapping — each nonce can only be used once |
| **Replay attack (cross-chain)** | High | `block.chainid` included in signed message |
| **Re-entrancy on withdraw** | High | `ReentrancyGuard.nonReentrant` modifier |
| **Front-running** | Medium | Proof binds `msg.sender` — only authorized payer can execute |
| **Price manipulation** | Medium | Amount locked at proof generation; 15-min deadline limits exposure |
| **Emergency vulnerability** | High | `Pausable` allows instant freeze of all payments |
| **Owner key compromise** | High | Separate deployer + signer keys; signer rotatable via `setSigner()` |
| **Accidental BNB deposits** | Low | `receive()` reverts with clear error message |
| **Block reorg** | Medium | Server waits for 5 confirmations (~15s on BNB) |

### Operational Security

- **Deployer wallet ≠ Signer wallet** — separate keys for different responsibilities
- **Signer key**: generated specifically for this contract, never reused elsewhere
- **Key rotation**: `setSigner()` allows rotation without redeployment
- **Emergency**: `pause()` immediately stops all payments; `withdraw()` still works for fund recovery

---

## Server-Side Integration (ngoo-server-2025)

### New Files (5)

| File | Purpose |
|------|---------|
| `src/services/crypto/index.ts` | Barrel exports |
| `src/services/crypto/types.ts` | TypeScript interfaces (`ICryptoPaymentProof`, `ICryptoProofRedisData`, `ICryptoMonitorConfig`) |
| `src/services/crypto/service.ts` | Proof generation: USD→wei conversion, nonce generation, ECDSA signing, Redis storage |
| `src/services/crypto/monitor.ts` | On-chain event polling: `PaymentReceived` listener, block confirmation, order status update |
| `src/services/crypto/price-oracle.ts` | CoinGecko BNB/USD price with Redis cache (60s TTL), `FixedFloat` precision |

### Modified Files (9)

| File | Change |
|------|--------|
| `src/helper/config.ts` | Add `CRYPTO_PAYMENT_ENABLED` flag + crypto env vars (conditional required) |
| `src/helper/redis-helper.ts` | Add `RedisHelper.crypto` namespace (proof, price, block, status, hashToOrderId) |
| `src/apollo/app/order/order.graphql` | Add `TCryptoPaymentProof` type, extend `TCreateOrderResponse` |
| `src/apollo/app/order/index.ts` | Replace CRYPTO stub with full implementation |
| `src/services/index.ts` | Export crypto module |
| `src/services/socket.ts` | Add crypto status reconnect replay |
| `src/index.ts` | Conditional monitor start/stop in lifecycle |
| `.example.env` | Add crypto env var docs |
| `src/apollo/types.generated.ts` | Auto-regenerated via `yarn generate` |

### Config Environment Variables

```env
# --- Crypto Payment ---
CRYPTO_PAYMENT_ENABLED=false                    # Feature flag (all below required when true)
BNB_RPC_URL=https://data-seed-prebsc-1-s1.binance.org:8545
NGOO_CONTRACT_ADDRESS=0x...                     # Deployed NgooPayment address
NGOO_CHAIN_ID=97                                # BNB Testnet
NGOO_SIGNER=0x...                               # Server signer private key (NEVER log this)
# CRYPTO_PROOF_TTL_SEC=900                      # 15 min (default)
# CRYPTO_BLOCK_CONFIRMATIONS=5                  # ~15s on BNB (default)
# CRYPTO_PRICE_CACHE_TTL_SEC=60                 # CoinGecko cache (default)
# CRYPTO_MONITOR_POLL_INTERVAL_MS=15000         # Polling interval (default)
# CACHE_CRYPTO_PROOF_TTL_SEC=900                # Redis proof TTL (default)
# LOCK_CRYPTO_PAYMENT_TTL_MS=30000              # Distributed lock TTL (default)
```

### Redis Key Structure (crypto namespace)

| Helper | Key Pattern | TTL | Purpose |
|--------|-------------|-----|---------|
| `crypto.proofGet/Set/Del` | `crypto:proof:{orderId}` | 900s | Store payment proof for verification |
| `crypto.hashToOrderIdGet/Set` | `crypto:hash:{orderIdHash}` | 900s | Reverse mapping: bytes32 → UUID |
| `crypto.bnbPriceGet/Set` | `crypto:price:bnb` | 60s | CoinGecko BNB/USD price cache |
| `crypto.lastProcessedBlockGet/Set` | `crypto:block:last` | none | Monitor resume point |
| `crypto.cryptoStatusGet/Set` | `crypto:status:{orderId}` | 300s | Payment status for Socket.IO replay |

---

## Execution Phases & Dependencies

| Phase | Task | Depends On | Effort |
|-------|------|------------|--------|
| **A.1** | Project init (Hardhat + TypeScript) | — | 1h |
| **A.2** | NgooPayment.sol (OpenZeppelin-hardened) | A.1 | 3h |
| **A.3** | Full test suite (23+ security test cases) | A.2 | 4h |
| **A.4** | Deploy to BNB Testnet | A.3 | 1h |
| **A.5** | Contract documentation (README, NatSpec) | A.2 | 1h |
| **B.1** | Server config + types | — | 1h |
| **B.2** | Price oracle (CoinGecko + FixedFloat) | B.1, B.4 | 2h |
| **B.3** | Proof generation service | B.1, B.2, B.4 | 3h |
| **B.4** | Redis helpers (crypto namespace) | B.1 | 1h |
| **B.5** | GraphQL schema + `yarn generate` | B.1 | 30m |
| **B.6** | `createOrder` crypto branch | B.3, B.5 | 2h |
| **B.7** | On-chain event monitor | B.1, B.4, A.4 | 4h |
| **B.8** | Service exports + startup integration | B.7 | 30m |
| **B.9** | Socket.IO crypto replay | B.4 | 30m |
| **B.10** | Expiry & cleanup | B.7 | 1h |

**Parallel tracks:**
- **Track 1 (Contract):** A.1 → A.2 → A.3 → A.4 → A.5
- **Track 2 (Server core):** B.1 → B.4 → B.2 → B.3 → B.5 → B.6
- **Track 3 (Monitor):** B.7 → B.8 → B.9 → B.10 (needs A.4 for ABI)

**Critical path:** A.1 → A.2 → A.3 → A.4 → B.7 → B.8

**Total estimated effort:** 3-5 working days

---

## BNB Testnet Reference

| Property | Value |
|----------|-------|
| Chain ID | 97 |
| RPC (primary) | `https://data-seed-prebsc-1-s1.binance.org:8545` |
| RPC (fallback) | `https://bsc-testnet-rpc.publicnode.com` |
| Explorer | `https://testnet.bscscan.com` |
| Faucet | `https://testnet.bnbchain.org/faucet-smart` |
| Native token | tBNB |
| Block time | ~3 seconds |
| Confirmations needed | 5 (~15 seconds) |

---

## Verification Checklist

### Contract
- [ ] `npx hardhat compile` — zero warnings
- [ ] `npx hardhat test` — all 23+ tests pass
- [ ] `npx hardhat coverage` — 100% line + branch coverage
- [ ] Deploy to BNB Testnet — logs contract address
- [ ] Verify on BscScan (optional but recommended)

### Server
- [ ] `yarn generate` — after `.graphql` changes
- [ ] `yarn build` — zero TS errors
- [ ] Feature flag OFF: `createOrder(CRYPTO)` returns `ValidationError`
- [ ] Feature flag ON: full flow works end-to-end

### End-to-End
- [ ] `createOrder(paymentMethod: CRYPTO)` → returns `cryptoPaymentProof`
- [ ] Call `payOrder()` on contract with proof → transaction succeeds
- [ ] Wait ~15s → monitor picks up `PaymentReceived` event
- [ ] Order status → PAID, Payment status → SUCCESS, `txHash` stored
- [ ] Socket.IO emits `paymentStatus` to client
- [ ] Audit log entry created
- [ ] Expired proof → contract rejects
- [ ] Wrong amount → contract rejects
- [ ] Replay nonce → contract rejects
- [ ] No wallet connected → server rejects
- [ ] Server restart → monitor replays from `lastProcessedBlock`
- [ ] Contract paused → `payOrder` reverts, `withdraw` still works

---

## Documentation Updates (After Implementation)

| File | Project | Update |
|------|---------|--------|
| `README.md` | ngoo-contract | Full project documentation |
| `CLAUDE.md` | ngoo-server-2025 | Add crypto payment section |
| `PLAN.md` | ngoo-server-2025 | Add Sprint 4.2 change log |
| `README.md` | ngoo-server-2025 | Add crypto payment flow docs |
| `MEMORY.md` | ngoo-server-2025 | Add Sprint 4.2 summary |
