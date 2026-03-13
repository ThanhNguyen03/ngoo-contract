# Contract Reference

## NgooPayment

Inherits: `Ownable`, `ReentrancyGuard`, `Pausable` (all OpenZeppelin v5)

### State variables

| Name | Type | Visibility | Description |
|---|---|---|---|
| `signer` | `address` | `public` | Server-side ECDSA signer whose signature authorizes payments |
| `payments` | `mapping(bytes32 => PaymentRecord)` | `public` | Payment records keyed by `orderId` |
| `usedNonces` | `mapping(bytes32 => bool)` | `public` | Consumed nonces — prevents replay attacks |

### Struct: PaymentRecord

```solidity
struct PaymentRecord {
    bytes32 orderId;    // keccak256 of the order UUID string
    address payer;      // wallet that called payOrder
    uint256 amount;     // amount paid in wei
    uint256 timestamp;  // block.timestamp at time of payment
    bool exists;        // false for unpaid orders (default mapping value)
}
```

### Constructor

```solidity
constructor(address _signer) Ownable(msg.sender)
```

- Sets `owner` to `msg.sender`.
- Sets `signer` to `_signer`.
- Reverts if `_signer` is the zero address.

### Functions

#### `payOrder`

```solidity
function payOrder(
    bytes32 orderId,
    uint256 amount,
    bytes32 nonce,
    uint256 deadline,
    bytes calldata signature
) external payable whenNotPaused nonReentrant
```

Pay for an order using a server-issued proof.

**Checks (in order):**

1. `block.timestamp <= deadline` — proof has not expired
2. `!usedNonces[nonce]` — nonce is fresh
3. `!payments[orderId].exists` — order has not been paid before
4. `msg.value == amount` — exact BNB amount was sent
5. Recovers the signer from the EIP-191 hash; must equal `signer`

**Effects:**

- Marks `usedNonces[nonce] = true`
- Writes `payments[orderId]` with payer, amount, timestamp, exists=true
- Emits `PaymentReceived`

#### `withdraw`

```solidity
function withdraw(address payable to, uint256 amount) external onlyOwner nonReentrant
```

Transfer `amount` wei from the contract to `to`. Works even when the contract is paused (emergency fund recovery).

Reverts if `to` is the zero address, `amount` is zero, or the contract balance is insufficient.

Emits `FundsWithdrawn`.

#### `setSigner`

```solidity
function setSigner(address _newSigner) external onlyOwner
```

Rotate the authorized signer address. Used for key rotation or incident response. Reverts if `_newSigner` is the zero address.

Emits `SignerUpdated`.

#### `pause` / `unpause`

```solidity
function pause() external onlyOwner
function unpause() external onlyOwner
```

Emergency stop: `pause()` disables `payOrder`. `withdraw` remains available. `unpause()` restores normal operation.

#### `getPayment`

```solidity
function getPayment(bytes32 orderId) external view returns (PaymentRecord memory)
```

Returns the `PaymentRecord` for the given `orderId`. If the order has not been paid, `exists` is `false` and all other fields are zero values.

#### `receive`

```solidity
receive() external payable
```

Always reverts with `"Direct transfers not accepted"`. Prevents accidental BNB deposits outside of `payOrder`.

### Events

#### `PaymentReceived`

```solidity
event PaymentReceived(bytes32 indexed orderId, address indexed payer, uint256 amount, uint256 timestamp);
```

Emitted on every successful `payOrder` call. The event monitor in ngoo-server-2025 subscribes to this event to mark orders as paid.

#### `FundsWithdrawn`

```solidity
event FundsWithdrawn(address indexed to, uint256 amount);
```

Emitted on every successful `withdraw` call.

#### `SignerUpdated`

```solidity
event SignerUpdated(address indexed oldSigner, address indexed newSigner);
```

Emitted when the owner rotates the signer address via `setSigner`.
