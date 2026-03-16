# Integration with ngoo-server-2025

## Environment variables

Add these to ngoo-server-2025's `.env` after deploying the contract:

```env
# Contract address returned by the deploy script
NGOO_CONTRACT_ADDRESS=0x<contract_address>

# Chain ID — 11155111 for Ethereum Sepolia
NGOO_CHAIN_ID=11155111

# Private key of the server-side signer wallet
# The corresponding public address must be set as the contract's `signer`
NGOO_SIGNER_PRIVATE_KEY=0x<signer_private_key>

# RPC endpoint for reading contract state and subscribing to events
NGOO_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
```

## ABI consumption

The compiled ABI is at `artifacts/contracts/NgooPayment.sol/NgooPayment.json` after running `npx hardhat compile`. Copy the `abi` array into a file in ngoo-server-2025, for example `src/lib/ngoo-payment-abi.json`.

```typescript
import abi from './ngoo-payment-abi.json';
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider(config.NGOO_RPC_URL);
const contract = new ethers.Contract(config.NGOO_CONTRACT_ADDRESS, abi, provider);
```

## Proof generation

When a user initiates a crypto payment for an order, the server generates a signed proof and returns it to the frontend:

```typescript
import { ethers } from 'ethers';

async function generatePaymentProof(orderId: string, payerAddress: string, amountEth: string) {
  const signerWallet = new ethers.Wallet(config.NGOO_SIGNER_PRIVATE_KEY);

  const orderIdBytes32 = ethers.keccak256(ethers.toUtf8Bytes(orderId));
  const amount = ethers.parseEther(amountEth);
  const nonce = ethers.hexlify(ethers.randomBytes(32));
  const deadline = Math.floor(Date.now() / 1000) + 900; // 15 minutes
  const chainId = BigInt(config.NGOO_CHAIN_ID);

  // Encoding order MUST match the contract's abi.encode call exactly
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ['bytes32', 'address', 'uint256', 'bytes32', 'uint256', 'uint256'],
    [orderIdBytes32, payerAddress, amount, nonce, deadline, chainId],
  );
  const messageHash = ethers.keccak256(encoded);
  // signMessage applies the EIP-191 prefix, matching toEthSignedMessageHash in the contract
  const signature = await signerWallet.signMessage(ethers.getBytes(messageHash));

  // Store nonce in Redis with TTL matching the deadline
  await RedisHelper.account.walletNonceSet(nonce, deadline);

  return { orderIdBytes32, amount: amount.toString(), nonce, deadline, signature };
}
```

## Event monitoring

Subscribe to `PaymentReceived` events to detect on-chain payments and update order status in MongoDB:

```typescript
async function startPaymentMonitor() {
  const provider = new ethers.WebSocketProvider(config.NGOO_WS_RPC_URL);
  const contract = new ethers.Contract(config.NGOO_CONTRACT_ADDRESS, abi, provider);

  contract.on('PaymentReceived', async (orderId: string, payer: string, amount: bigint, timestamp: bigint) => {
    const logger = createLogger('PaymentMonitor');
    logger.info({ orderId, payer, amount: amount.toString() }, 'PaymentReceived event detected');

    try {
      // orderId is bytes32 — look up the order in MongoDB by its hashed ID
      const order = await OrderModel.findOne({ orderIdHash: orderId });
      if (!order) {
        logger.warn({ orderId }, 'No matching order found for on-chain payment');
        return;
      }

      await order.updateOne({ status: 'PAID', paidAt: new Date(Number(timestamp) * 1000) });
      // Notify the frontend via Socket.IO
      io.to(order.userId).emit('payment:confirmed', { orderId: order.uuid });
    } catch (err) {
      logger.error({ err, orderId }, 'Failed to process PaymentReceived event');
    }
  });
}
```

## Redis key structure used by the monitor

Nonces generated during proof creation can be tracked in Redis to enable early validation before on-chain confirmation:

| Key | Type | TTL | Description |
|---|---|---|---|
| `wallet:nonce:{nonce}` | string | Proof deadline (seconds) | Stores the deadline; presence means nonce is active |
| `wallet:pending:{orderId}` | string | 15 min | Stores pending payment proof for polling/status |

These keys are managed by `RedisHelper.account.walletNonceSet/Get/Del` (see `src/helper/redis-helper.ts` in ngoo-server-2025).

## Flow summary

```
Frontend                  ngoo-server-2025            NgooPayment.sol
   |                            |                            |
   |-- POST /crypto/pay ------->|                            |
   |                            |-- generateProof()          |
   |                            |   (sign + store nonce)     |
   |<-- { proof } -------------|                            |
   |                            |                            |
   |-- payOrder(proof) -------->|                            |
   |       (tx on Sepolia)       |                            |
   |                            |<-- PaymentReceived event --|
   |                            |    (orderId, payer, amt)   |
   |                            |-- updateOrder(PAID)        |
   |                            |-- io.emit(payment:confirmed)
   |<-- Socket: payment:confirmed
```
