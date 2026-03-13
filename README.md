# NgooPayment

On-chain crypto payment contract for the [Ngoo food ordering platform](https://github.com/thanhfng/ngoo-server-2025), deployed on BNB Testnet (chain ID 97).

Each order payment is authorized by a server-issued ECDSA proof that binds the order ID, payer address, exact amount, a single-use nonce, expiry deadline, and chain ID. The contract verifies the signature on-chain and records the payment atomically.

## Getting started

```bash
yarn install
npx hardhat compile
npx hardhat test
```

## Payment flow

1. **Server generates proof** — signs `keccak256(abi.encode(orderId, payer, amount, nonce, deadline, chainId))` with the server signer key and returns the proof to the frontend.
2. **User calls `payOrder`** — submits the proof along with the exact BNB amount; the contract verifies the signature and records the payment.
3. **Monitor detects event** — ngoo-server-2025 listens for `PaymentReceived(orderId, payer, amount, timestamp)` and marks the order as paid in MongoDB.

## Documentation

See [`docs/`](docs/README.md) for full guides:

- [Getting Started](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- [Contract Reference](docs/contract-reference.md)
- [Deployment Guide](docs/deployment-guide.md)
- [Testing Guide](docs/testing-guide.md)
- [Security](docs/security.md)
- [Integration with ngoo-server-2025](docs/integration.md)
