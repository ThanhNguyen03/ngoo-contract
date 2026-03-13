# Security

## Threat model

| Threat | Mitigation |
|---|---|
| **Replay attack** — re-submit a valid past signature | Single-use `nonce`: `usedNonces[nonce] = true` on first use; any reuse reverts with "Nonce already used" |
| **Double payment** — pay for the same order twice | `payments[orderId].exists` check; second attempt reverts with "Order already paid" |
| **Proof forgery** — attacker creates a fake signature | ECDSA signature must be from `signer`; `ECDSA.recover` + address equality check |
| **Cross-chain replay** — use a BNB Testnet proof on mainnet | `block.chainid` is included in the signed message hash; signature is chain-specific |
| **Overpayment / underpayment** — send a different amount** | `msg.value == amount` exact equality check; any mismatch reverts |
| **Proof expiry bypass** — use a stale proof** | `block.timestamp <= deadline` check; expired proofs revert with "Proof expired" |
| **Payer substitution** — attacker uses someone else's proof | `msg.sender` is included in the hash; signature is bound to the intended payer's address |
| **Hash collision via encodePacked** — craft colliding inputs | `abi.encode` used (NOT `abi.encodePacked`); all fields are fixed-width, collision is impossible |
| **Reentrancy** — re-enter payOrder during execution | `nonReentrant` modifier from OpenZeppelin ReentrancyGuard |
| **Reentrancy in withdraw** — re-enter via ETH receive hook | `nonReentrant` modifier; checks-effects-interactions pattern (state not modified in withdraw, but guard is belt-and-suspenders) |
| **Direct BNB deposit** — accidental ETH send to contract | `receive()` always reverts; funds cannot be locked accidentally |
| **Compromised signer key** — server key leaked | Owner can call `setSigner` to rotate to a new key without redeployment |
| **Funds locked / contract bug** — need to recover funds | `withdraw` works even when contract is `paused`; owner can always retrieve funds |
| **Unauthorized admin** — attacker calls owner functions | All admin functions protected by `onlyOwner` from OpenZeppelin Ownable |

## OpenZeppelin justifications

| Import | Reason |
|---|---|
| `Ownable` | Battle-tested ownership + transfer pattern; avoids common custom access control mistakes |
| `ReentrancyGuard` | Prevents reentrancy in both `payOrder` and `withdraw` without manual mutex code |
| `Pausable` | Standard emergency stop mechanism; integrates with `whenNotPaused` modifier |
| `ECDSA` | Audited signature recovery with proper error handling (returns zero address on malformed sig instead of reverting unpredictably) |
| `MessageHashUtils` | `toEthSignedMessageHash` applies the standard EIP-191 prefix, ensuring client-side `eth_sign` / `personal_sign` and contract-side verification are interoperable |

## Key rotation procedure

If the server signer key is suspected to have been compromised:

1. **Pause the contract immediately** (prevents new payments while rotating):
   ```
   contract.pause()   // owner only
   ```

2. **Generate a new signer wallet** on the server (see [Deployment Guide](deployment-guide.md#3-generate-a-dedicated-signer-wallet)).

3. **Rotate the signer** on-chain:
   ```
   contract.setSigner(newSignerAddress)   // owner only
   ```

4. **Update ngoo-server-2025** — set `NGOO_SIGNER_PRIVATE_KEY` to the new key and restart.

5. **Unpause the contract**:
   ```
   contract.unpause()   // owner only
   ```

6. **Revoke / invalidate** any proofs signed with the old key (they are now invalid because `recovered != signer`).

## Emergency pause procedure

If an exploit or unexpected behaviour is detected:

1. Call `contract.pause()` from the owner wallet. This immediately blocks all `payOrder` calls.
2. Investigate the issue. `withdraw` remains functional for fund recovery even while paused.
3. If redeployment is necessary, call `contract.withdraw(owner, address(this).balance)` to drain funds before decommissioning.
4. After fixing the issue (or deploying a new contract), call `contract.unpause()` to resume.

## Ownership transfer

The contract owner is set to `msg.sender` in the constructor (the deployer). To transfer ownership to a multisig or DAO:

```solidity
contract.transferOwnership(newOwnerAddress)   // OpenZeppelin Ownable
```

For production deployments, the owner should be a Gnosis Safe or equivalent multisig to prevent single-key compromise of admin functions.
