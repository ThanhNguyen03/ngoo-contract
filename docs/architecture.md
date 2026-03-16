# Architecture

## Payment flow

```
┌──────────────┐        ① create order + request proof        ┌──────────────────┐
│   Frontend   │ ─────────────────────────────────────────────> │  ngoo-server-2025│
│  (DApp/Web)  │                                                │  (Express/GQL)   │
│              │ <───────────────────────────────────────────── │                  │
│              │        ② return signed proof                   │  signs with      │
│              │          { orderId, amount, nonce,             │  NGOO_SIGNER key │
│              │            deadline, signature }               └──────────────────┘
│              │
│              │  ③ call payOrder(orderId, amount, nonce,
│              │                  deadline, sig) + msg.value
│              │ ─────────────────────────────────────────────> ┌──────────────────┐
│              │                                                │  NgooPayment.sol │
│              │ <───────────────────────────────────────────── │  (Sepolia)       │
│              │        ④ tx receipt / PaymentReceived event    └────────┬─────────┘
└──────────────┘                                                         │
                                                                         │ ⑤ event
                                                                         ▼
                                                               ┌──────────────────┐
                                                               │  Event Monitor   │
                                                               │  (ngoo-server)   │
                                                               │  marks order paid│
                                                               │  in MongoDB      │
                                                               └──────────────────┘
```

## Encoding alignment

Both the server (proof generator) and the contract (proof verifier) must use identical ABI encoding. Any mismatch causes signature recovery to fail.

| Field | Solidity type | TypeScript / ethers type | Notes |
|---|---|---|---|
| `orderId` | `bytes32` | `string` (hex, 0x-prefixed) | `keccak256(toUtf8Bytes(uuid))` |
| `msg.sender` / `payer` | `address` | `string` (checksummed) | Must be the actual caller address |
| `amount` | `uint256` | `bigint` | `parseEther("0.05")` |
| `nonce` | `bytes32` | `string` (hex, 0x-prefixed) | `hexlify(randomBytes(32))` |
| `deadline` | `uint256` | `number` | Unix seconds |
| `block.chainid` | `uint256` | `bigint` (11155111 on Sepolia) | Prevents cross-chain replay |

### Contract side

```solidity
bytes32 messageHash = keccak256(
    abi.encode(orderId, msg.sender, amount, nonce, deadline, block.chainid)
);
bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
address recovered = ethSignedHash.recover(signature);
```

### Server side (TypeScript / ethers v6)

```typescript
const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
  ['bytes32', 'address', 'uint256', 'bytes32', 'uint256', 'uint256'],
  [orderId, payerAddress, amount, nonce, deadline, chainId],
);
const messageHash = ethers.keccak256(encoded);
// wallet.signMessage applies the EIP-191 prefix, matching toEthSignedMessageHash
const signature = await signerWallet.signMessage(ethers.getBytes(messageHash));
```

## Server-contract coordination

- The server holds the **private key** of the signer wallet. It never leaves the server.
- The **public address** of the signer is stored in the contract's `signer` state variable.
- The server generates a fresh random `nonce` (32 bytes) per proof and stores it in Redis with a short TTL (matching the `deadline`). The contract enforces single-use by marking `usedNonces[nonce] = true` on success.
- `orderId` is `keccak256(toUtf8Bytes(uuid))` — a deterministic mapping from the MongoDB order UUID to a `bytes32` that fits in contract storage.
- `deadline` is a Unix timestamp (`Date.now() / 1000 + 900`) giving the user 15 minutes to submit the transaction.
