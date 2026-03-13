# Testing Guide

## Run all tests

```bash
npx hardhat test
```

Hardhat compiles the contract if needed, spins up an in-process EVM node (chain ID 31337), and runs the full test suite. Expected output: 30 passing tests with 0 failures.

## Run a specific describe block

Use Mocha's `--grep` flag to filter by test name or describe label:

```bash
npx hardhat test --grep "payOrder"
npx hardhat test --grep "withdraw"
npx hardhat test --grep "setSigner"
npx hardhat test --grep "Pausable"
npx hardhat test --grep "receive fallback"
```

## Run a single test file

```bash
npx hardhat test test/NgooPayment.test.ts
```

## Coverage

```bash
npx hardhat coverage
```

Generates:
- Summary in the terminal
- HTML report at `coverage/index.html` (open in a browser)
- LCOV data at `coverage/lcov.info`

The contract should achieve 100% line and branch coverage. If any branch shows below 100%, check whether the corresponding test case exists in the test suite.

## Gas report

Set `REPORT_GAS=true` in `.env` (or prefix the command) to print per-function gas costs:

```bash
REPORT_GAS=true npx hardhat test
```

This uses `hardhat-gas-reporter`. Key costs to watch:
- `payOrder` — the critical path; should stay under 100k gas
- `withdraw` — owner-only admin path; expected ~40k gas
- `setSigner` — cheap SSTORE; expected ~30k gas

## Test structure overview

| Describe block | Cases | What it covers |
|---|---|---|
| Deployment | 3 | Constructor, ownership, zero-address guard |
| payOrder | 10 | Happy path, all 5 require checks, event, storage, nonce tracking |
| withdraw | 7 | Full/partial withdraw, non-owner, insufficient, zero address, event, paused |
| setSigner | 4 | Rotation, non-owner, zero address, event |
| Pausable | 4 | pause, unpause, blocked payOrder, restored payOrder |
| receive fallback | 1 | Direct BNB transfer rejection |

## Fixture pattern

Tests use `loadFixture` from `@nomicfoundation/hardhat-network-helpers` for fast, isolated setups. Each test group gets a fresh contract state by replaying the fixture, avoiding test-order dependencies.

## Time manipulation

Tests that check deadline expiry use `time.latest()` from `@nomicfoundation/hardhat-network-helpers` to read the current block timestamp, then pass `deadlineOffset: -1` to produce a proof that is already expired.
