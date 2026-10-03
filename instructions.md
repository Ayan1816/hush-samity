# Hush Samity

Confidential rotating savings group (ROSCA) on Fhenix CoFHE. Members pay a public ERC-20 installment, submit a private discount bid, and the contract selects the highest discount under encryption. Only the winning bid is revealed. Losing bids stay encrypted. Payouts, dividends, collateral locks, slashes, and refunds are real ERC-20 transfers.

This file is the build contract for the repository. Implementation follows it and the CoFHE docs at <https://cofhe-docs.fhenix.zone/>. If a function is not named here or in those docs, stop and check the docs. Do not invent Solidity or SDK APIs.

## Project overview

A samity is a fixed set of members who pool an installment each cycle. One member receives the pool that cycle. In Hush Samity the recipient is the member who bids the highest discount, not a predetermined rotation order. The discount is how much of that cycle's collected pot the winner is willing to give up. The forgone amount is the dividend, paid in the public token to the members who did not win. The winner receives the pot minus that dividend.

The bid itself is an encrypted `euint32`. The creator publishes the maximum allowed discount when the samity is created. That cap is a plaintext rule. The comparison against the cap and the comparison between bids both happen under FHE. The chain never branches on an `ebool`.

Collateral is a real ERC-20 balance locked in the protocol. It is slashed when a member misses a public installment, and it is refunded at the end of the cycle when the member has met that cycle's obligations.

### Modules

| Contract | Responsibility |
| --- | --- |
| `SamityFactory` | Deploys a samity. The creator passes the ERC-20, installment, collateral, member cap, cycle length, total cycles, and the max discount cap. The cap is stored at creation and cannot be raised later. |
| `Samity` | Membership, cycle clock, public installment collection, and the calls that move value after a verified reveal. |
| `BidEngine` | Accepts `externalEuint32` discount bids, enforces the creator cap under FHE, and tracks the encrypted highest discount and encrypted winner. |
| `Collateral` | `transferFrom` locks, slashes, and refunds the configured ERC-20. No internal balance that is not backed by tokens held by the contract. |
| `RevealVerifier` | Checks a Teecryptor signature with `FHE.verifyDecryptResult` before any plaintext bid is used for a payout. Publishes with `FHE.publishDecryptResult` only for the winning discount and the winning `eaddress`. |

`SamityFactory` is the only place the max discount cap is chosen. The creator supplies it in the create call. The factory rejects a cap above 10_000 at creation time with a normal `require` on a plaintext `uint32`. The deployed samity stores that value and `BidEngine` reads it. There is no setter that increases it after deployment.

### Economic rule for `euint32`

Discount bids are basis points of that cycle's collected pot, not raw token wei. `10_000` means 100 percent. A `uint32` cannot represent an 18-decimal ERC-20 amount, and the spec fixes the bid type at `euint32`, so the encrypted domain is basis points.

After the winning basis-point value is verified on-chain:

- `dividend = collectedPot * winningDiscountBps / 10_000`
- `winnerPayout = collectedPot - dividend`

`collectedPot`, `dividend`, and `winnerPayout` are `uint256` ERC-20 base units. The division happens only on plaintext, after `FHE.verifyDecryptResult` succeeds. Non-winners split `dividend` in the public token. Rounding dust stays in the samity until the creator's documented sweep rule is implemented with the contracts. Do not pay from an off-chain estimate.

### What is public, and what is not

Public, and therefore normal Solidity:

- The ERC-20 address, installment amount, collateral amount, member cap, cycle duration, and total cycles.
- The creator's max discount cap.
- Who has joined, who has paid the current installment, and who has already won a cycle.
- The collected pot.
- After a valid reveal: the winning discount in basis points, the winner address, the dividend, and the winner payout.

Private for the life of the samity:

- Every losing bid.
- A member's own bid, except to that member through `decryptForView`.
- Which member is currently ahead, until reveal. The leader is an `eaddress`, not a public `address` updated inside a branch.

### Cycle

1. Members lock collateral once, by ERC-20 `transferFrom`, before they can pay or bid.
2. Each cycle, a member pays `installmentAmount` of the contribution token into the samity. This transfer is public.
3. A member who paid, and who has not already won a cycle, submits one encrypted discount bid for that cycle.
4. `BidEngine` updates the encrypted best bid. Ties keep the incumbent, because replacement uses `FHE.gt`, not `FHE.gte`.
5. When the cycle closes, the contract calls `FHE.allowPublic` on the winning discount and the winning `eaddress` only.
6. Anyone may `decryptForTx(...).withoutACP().execute()` and submit the plaintext plus signature. `RevealVerifier` verifies it. The samity then transfers the winner payout and the non-winner dividends.
7. Collateral is refunded to members who paid this cycle, and slashed for members who did not. A slashed member is out of later cycles.
8. The revealed winner cannot bid again. They still owe later installments if the samity has cycles left. Missing one is still a slash.

Rotation is "each member wins at most once", not a fixed seat order. The highest valid discount wins the cycle.

## Tech stack

Pinned from the CoFHE compatibility page and from the published `0.7.1` / `0.2.0` manifests. Do not float these. `@cofhe/*` packages are one release line and must stay on the same version. `@cofhe/hardhat-plugin` is the Hardhat 2 plugin. Do not install `@cofhe/hardhat-3-plugin`.

`fhenix-confidential-contracts` is not a dependency. Installments and collateral are a public ERC-20 via OpenZeppelin. FHERC20 is a different token model and is out of scope.

### Compiler and networks

| Item | Pin |
| --- | --- |
| Solidity | `0.8.28` |
| `evmVersion` | `cancun` (required; transient storage in `FHE.sol`) |
| Node.js | `>=20` (docs). This machine is Node 26. |
| Package manager | pnpm `11.18.0` |
| Ethereum Sepolia | chain id `11155111`, Hardhat name `eth-sepolia`, SDK `chains.sepolia` |
| Arbitrum Sepolia | chain id `421614`, Hardhat name `arb-sepolia`, SDK `chains.arbSepolia` |
| Base Sepolia | chain id `84532`, Hardhat name `base-sepolia` (not injected by the plugin; set in `hardhat.config.ts`), SDK `chains.baseSepolia` |
| Local CoFHE | chain id `420105`, Hardhat name `localcofhe`, SDK `chains.localcofhe` |
| Hardhat mocks | chain id `31337`, SDK `chains.hardhat` |

The plugin injects `localcofhe`, `eth-sepolia`, and `arb-sepolia`. Base Sepolia is configured in this repo because the plugin does not ship a preset for it. Testnet accounts come from `PRIVATE_KEY`. RPC overrides: `SEPOLIA_RPC_URL`, `ARBITRUM_SEPOLIA_RPC_URL`, `BASE_SEPOLIA_RPC_URL`.

### Contracts package (repository root)

| Package | Version | Role |
| --- | --- | --- |
| `hardhat` | `2.29.1` | Hardhat 2. Required by `@cofhe/hardhat-plugin@0.7.1` (`hardhat` peer `^2`). |
| `@nomicfoundation/hardhat-toolbox` | `6.1.2` | Compile, test, typechain. Peers `hardhat` `^2.28`. |
| `@nomicfoundation/hardhat-ethers` | `3.1.3` | Plugin peer is `^3`, not v4. |
| `ethers` | `6.17.0` | Toolbox peer `^6.14`. SDK accepts ethers 6. |
| `typescript` | `5.9.3` | Shared with the frontend. |
| `ts-node` | `10.9.2` | Hardhat TypeScript config. |
| `@cofhe/hardhat-plugin` | `0.7.1` | Mock coprocessor on `hardhat test` / `hardhat node`, `hre.cofhe`. |
| `@cofhe/sdk` | `0.7.1` | Encrypt, ACP, decrypt. Tests and tasks. |
| `@cofhe/mock-contracts` | `0.7.1` | Used by the plugin. Tests only. |
| `@cofhe/abi` | `0.7.1` | CoFHE contract ABIs. Same release line. |
| `@fhenixprotocol/cofhe-contracts` | `0.2.0` | `FHE.sol`. Exact pin, not a `0.2.0-beta`. |
| `@fhenixprotocol/cofhe-errors` | `1.0.2` | Revert selector decoding. |
| `@openzeppelin/contracts` | `5.4.0` | ERC-20, `SafeERC20`, `IERC20`. Exact version called out for the Foundry plugin peer; satisfies the Hardhat plugin peer `^5`. |
| `dotenv` | `16.4.7` | Testnet env. Never commit `.env`. |
| `@types/node` | `22.20.4` | Node types for Hardhat scripts. |
| `viem` | `2.38.6` | Same pin as the frontend. Workspace override forces this version. |

`@nomicfoundation/hardhat-toolbox` is installed, but `hardhat.config.ts` imports it only when `process.platform !== "android"`. Toolbox loads Hardhat Ignition, and Ignition loads `@nomicfoundation/solidity-analyzer`, which publishes no `android-arm64` binary. On Android the config imports `@nomicfoundation/hardhat-ethers` and `@cofhe/hardhat-plugin` only. That is enough to compile and test.

Hardhat itself also parses imports with `@nomicfoundation/solidity-analyzer@0.1.2`, and that package has no Android binary. `patches/@nomicfoundation__solidity-analyzer@0.1.2.patch` is a fallback used only when the native binding fails to load. It extracts `pragma solidity` ranges and import paths. `solc` still compiles. Desktop and CI keep the native parser.

Import the library as `import "@fhenixprotocol/cofhe-contracts/FHE.sol";`.

### Frontend package (`frontend/`)

| Package | Version | Role |
| --- | --- | --- |
| `next` | `16.3.6` | App Router. |
| `react` / `react-dom` | `19.3.0` | Matches `@cofhe/react` peer `^19`. |
| `typescript` | `5.9.3` | |
| `@types/react` / `@types/react-dom` | `19.3.0` | |
| `wagmi` | `2.19.5` | Wallet connection. v2, because the SDK peer is `@wagmi/core` `^2`. Do not install wagmi 3. |
| `@wagmi/core` | `2.22.1` | Version `wagmi@2.19.5` depends on. Satisfies `@cofhe/sdk` optional peer `^2`. |
| `viem` | `2.38.6` | Exact version `@cofhe/sdk@0.7.1` depends on. Peer floor in the docs is `^2.38.6`. |
| `@tanstack/react-query` | `5.90.7` | Exact version `@cofhe/react@0.7.1` depends on. Required by wagmi. |
| `@cofhe/sdk` | `0.7.1` | Import the browser client from `@cofhe/sdk/web`. |
| `@cofhe/react` | `0.7.1` | Official React package on the same release. |
| `@cofhe/abi` | `0.7.1` | |
| `tailwindcss` | `4.3.3` | |
| `@tailwindcss/postcss` | `4.3.3` | Next.js PostCSS plugin. |
| `eslint-config-next` | `16.3.6` | |

SDK optional peers (`ethers`, `hardhat`, `@wagmi/core`, `@nomicfoundation/hardhat-ethers`) are optional. `viem` is not optional.

## Project structure

```
Hush-Samity/
  instructions.md          this file
  package.json             Hardhat project, pinned contract dependencies
  pnpm-workspace.yaml      root + frontend
  hardhat.config.ts        plugin, Solidity 0.8.28, cancun, Base Sepolia
  tsconfig.json            Hardhat TypeScript
  .env.example             variable names only
  contracts/               Solidity sources. Empty until the contracts are written.
  test/                    Hardhat tests. Plugin mocks allowed only here.
  tasks/                   Hardhat tasks for testnet deploy and interaction.
  scripts/                 One-off deploy scripts.
  frontend/
    package.json           Next.js app
    app/                   App Router UI
    lib/cofhe.ts           createCofheConfig + createCofheClient
    lib/wagmi.ts           wagmi config on the CoFHE chain objects
```

No `.sol` file is part of the scaffold. Do not commit sample contracts from `hardhat init`.

Production code lives in `contracts/` and `frontend/`. The Hardhat network deploys CoFHE mocks automatically during `pnpm test`. Those mocks are not imported by contracts or by the frontend. A test may deploy a real OpenZeppelin ERC-20 as the contribution token. That is a token, not a mock of transfer logic.

## FHE patterns

All names below are from the CoFHE docs for `@fhenixprotocol/cofhe-contracts@0.2.0` and `@cofhe/sdk@0.7.1`.

### Types

- Compute: `ebool`, `euint8`, `euint16`, `euint32`, `euint64`, `euint128`, `eaddress`.
- User input: `externalEbool`, `externalEuint8`, `externalEuint16`, `externalEuint32`, `externalEuint64`, `externalEuint128`, `externalEaddress`, plus one `bytes` proof.
- Contract-to-contract: `sharedE*` via `FHE.shareEuintXX` / `FHE.receiveEuintXXParam` / `FHE.receiveEuintXXFromCall`. Do not pass a bare `euint32` into another contract.

Bids enter as `externalEuint32` plus `bytes`. The consuming contract is the one that calls `FHE.asEuint32`. The client binds that address with `setConsumingContract`.

### Bids and the cap

```solidity
euint32 bid = FHE.asEuint32(inBid, inputProof);
ebool withinCap = FHE.lte(bid, FHE.asEuint32(maxDiscountCap));
ebool improves = FHE.gt(bid, bestDiscount);
ebool replace = FHE.and(withinCap, improves);
bestDiscount = FHE.select(replace, bid, bestDiscount);
bestBidder = FHE.select(replace, FHE.asEaddress(msg.sender), bestBidder);
FHE.allowThis(bestDiscount);
FHE.allowThis(bestBidder);
```

`maxDiscountCap` is the plaintext `uint32` the creator set in `SamityFactory`. `FHE.asEuint32(maxDiscountCap)` is trivial encryption of a public value. An over-cap bid does not replace the leader. It is not reverted on, because `require` on an `ebool` is impossible and decrypting the comparison would leak the bid. The rejected bid is not stored in a member-readable slot that later gets `allowPublic`.

`FHE.gt` is strict, so an equal discount leaves the earlier bidder in place. Always assign the `FHE.select` result. Do not write `bestBidderAddress = msg.sender` behind a plaintext `if`.

`FHE.max` is legal for two `euint32` values. Use it only when both values are already known to be valid bids. It does not know about the cap or about ties.

### Access control

Call `FHE.allowThis` on every ciphertext the same contract will read in a later transaction. A new handle from `add`, `select`, `asEuint32`, or `asEaddress` does not keep the old handle's permission.

| Grant | Use |
| --- | --- |
| `FHE.allowThis` | This contract, persistent. Required after every stored update. |
| `FHE.allow(ct, member)` or `FHE.allowSender` | That member may `decryptForView` their own bid. |
| `FHE.allowTransient` | Another contract, this transaction only. Prefer `sharedEuintXX` for values that cross a call. |
| `FHE.allowPublic` | Reveal only. Winning discount and winning `eaddress`. Nobody else. |

`FHE.isAllowed` and `FHE.isPubliclyAllowed` exist. Do not call `allowPublic` on the per-member bid mapping.

There is no `FHE.decrypt`. `DecryptFunctionNotSupported` is what a task with the old decrypt id gets.

### Reveal

1. On close, `FHE.allowPublic` the winning handles.
2. Client: `client.decryptForTx(ctHash).withoutACP().execute()`.
3. Result shape: `{ ctHash, decryptedValue, signature }`. `decryptedValue` is a `bigint`.
4. Contract: `FHE.verifyDecryptResult(handle, plaintext, signature)` before using the number. Use `FHE.publishDecryptResult` when the plaintext must be readable later via `FHE.getDecryptResult` / `FHE.getDecryptResultSafe`.
5. `verifyDecryptResult` reverts on a bad signature. `verifyDecryptResultSafe` returns `false`. Batch forms exist (`publishDecryptResultBatch`, `verifyDecryptResultBatch`, `verifyDecryptResultBatchSafe`) and are appropriate for revealing the discount and the winner together.
6. Publishing is signature-gated, not ACL-gated. Still verify before moving tokens.

`decryptForView` is UI-only. It always uses an ACP. It does not return a signature and must not be sent to the contract. Create the ACP with `client.acp.getOrCreateSelfACP()` after `client.connect`. Pass `FheTypes.Uint32` for a discount and `FheTypes.Uint160` for an `eaddress`.

`decryptForTx` requires exactly one of `.withACP(...)` or `.withoutACP()` before `.execute()`.

### Encrypt

```typescript
const [bidHash, signature] = await client
  .encryptInputs([Encryptable.uint32(discountBps)])
  .setConsumingContract(bidEngineAddress)
  .execute();
```

`execute()` returns handles followed by one batch signature (`inputs.length + 1`). One proof covers the whole batch. Same-type batches are verified with the plural form (`FHE.asEuint32s`). A single bid uses `FHE.asEuint32(handle, proof)`. Do not build `InEuint32`, `EncryptedItemInput`, or `asHashPlusProof()`. Those were removed in 0.7 / contracts 0.2.0.

`Encryptable` factories: `bool`, `uint8`, `uint16`, `uint32`, `uint64`, `uint128`, `address`, `create`.

### Arithmetic and branching rules

- No `if (ebool)` and no `require` on an encrypted condition. Use `FHE.select`.
- No plaintext branch whose condition was decrypted only to choose a path. That leaks.
- `euint` math wraps. It does not revert on overflow.
- `div` by an encrypted zero returns the type max. `rem` by an encrypted zero returns the dividend. Do not assume a Solidity panic.
- Operands must share a type and a security zone. Default zone is `0`. Do not mix zones.
- `FHE.isInitialized` checks a non-zero handle. It does not check ACL.
- `FHE.wrapEuint32` is a cast. It grants nothing. User inputs use `asEuint32`, not `wrap`.
- Randomness, if ever needed, is `FHE.randomEuint8` / `16` / `32` / `64` / `128`. There is no `randomEbool`.

### Client lifecycle

```typescript
import { createCofheConfig, createCofheClient } from "@cofhe/sdk/web";
import { chains } from "@cofhe/sdk/chains";

const config = createCofheConfig({
  supportedChains: [chains.sepolia, chains.arbSepolia, chains.baseSepolia],
});
const client = createCofheClient(config);
await client.connect(publicClient, walletClient);
await client.acp.getOrCreateSelfACP();
```

Browser entry is `@cofhe/sdk/web`. Node entry is `@cofhe/sdk/node`. ACP helpers live on `client.acp` and in `@cofhe/sdk/acps` (`ACPUtils`, `ValidationUtils`). The old `@cofhe/sdk/permits` entry and `.withPermit()` / `.withoutPermit()` are gone. Use `.withACP()` / `.withoutACP()`.

Tests create the client with `hre.cofhe.createClientWithBatteries(signer)`.

### Errors worth handling

`ACLNotAllowed`, `SenderNotAllowed`, `NotShared`, `UnexpectedSharer`, `InvalidEncryptedInput`, `InvalidSigner`, `InvalidSignature`, `DecryptionResultNotReady`, `PermissionInvalid_Expired`, `PermissionInvalid_IssuerSignature`. Decode selectors with `@fhenixprotocol/cofhe-errors` rather than matching hex by hand.

## Coding standards

- Production contracts and the frontend contain no mock coprocessor, no hardcoded ciphertext, no hardcoded bid, and no balance that is not the result of an ERC-20 transfer.
- Token movement uses OpenZeppelin `SafeERC20` against the creator-configured `IERC20`. Pull tokens with `transferFrom`. Push with `safeTransfer`.
- Checks-effects-interactions on public value. Encrypted updates still need `FHE.allowThis` before the handle is stored for later.
- Revert strings or custom errors for plaintext checks: not a member, already paid, already won, cap above 10_000, cycle not open, reveal before close, signature rejected.
- Do not add a function that returns every member's bid handle to an arbitrary caller unless that caller is the member the handle was `allow`ed to. Handles are not secret, but handing them out invites grief and confuses the UI about who may decrypt.
- One encrypted input in a user transaction: `externalEuint32` then `bytes`. If a later function takes two encrypted values, pack them and call `FHE.asEuint32s` once. Do not verify each handle against a batch signature.
- `setConsumingContract` is the contract that runs `FHE.asE*`, which may be `BidEngine` rather than the address the wallet calls. Getting this wrong reverts at runtime.
- Frontend decrypt-for-display uses `decryptForView` and `FheTypes.Uint32`. Payout submission uses `decryptForTx`. Never pass a view plaintext into `verifyDecryptResult`.
- ACP storage holds a sealing private key (`localStorage` key `cofhesdk-acps` on web). Do not log it, do not send it to a server, do not put it in a sharing ACP export by accident. Sharing uses `ACPUtils.export`.
- Wallet code uses wagmi v2 and viem `2.38.6`. CoFHE chain objects come from `@cofhe/sdk/chains`, not hand-written RPC maps.
- Solidity layout: SPDX license, `pragma solidity 0.8.28;`, explicit visibility, custom errors, no `tx.origin`.
- Tests assert both the public ERC-20 balances and the encrypted outcome. Encrypted asserts go through the SDK decrypt or the plugin's test-only plaintext helpers. Those helpers are not available on Sepolia and must not be wrapped into the frontend.
- Gas on the mock network is not the testnet gas. Quote gas from a Sepolia deploy before calling a flow cheap.

## User stories

1. As a creator, I can deploy a samity from `SamityFactory` with an ERC-20, an installment amount, a collateral amount, a member cap, a cycle duration, a cycle count, and a max discount cap in basis points from 0 to 10_000, so the rules are fixed before anyone joins.
2. As a creator, I cannot raise the max discount cap after the samity exists, so bidders know the rule they are encrypting against.
3. As a member, I can join by approving and transferring the collateral amount into the protocol, so my seat is backed by tokens the contract holds.
4. As a member, I can pay the public installment each cycle with a real ERC-20 transfer, so the pot is the sum of tokens received, not an internal counter.
5. As a member who has paid and has not won yet, I can submit one encrypted discount bid for the open cycle, so other members cannot read my bid.
6. As a member, I can see only my own bid in the UI via `decryptForView` after `getOrCreateSelfACP`, so I can confirm what I submitted without publishing it.
7. As a member whose bid is above the creator's cap, my bid does not become the leader, and the transaction does not reveal the amount, so an out-of-range bid cannot win and cannot leak.
8. As a member who bids higher than the current encrypted leader, I become the encrypted leader, so the winner is the highest valid discount.
9. As a member who ties the current leader, I do not replace them, so the winner is deterministic without decrypting the tie.
10. As any account, after the cycle closes, I can submit a `decryptForTx` result for the winning discount and the winning address, so settlement does not depend on the winner being online.
11. As the samity, I reject a reveal whose Teecryptor signature fails `FHE.verifyDecryptResult`, so a made-up plaintext cannot move tokens.
12. As the winner, I receive the pot minus the verified discount in the contribution token, so the payout matches the bid I encrypted.
13. As a non-winner who paid this cycle, I receive an equal share of the public dividend, so the discount is distributed in the clear only after the winner is revealed.
14. As a member who paid, I receive my collateral back at the end of the cycle, so a completed cycle does not keep my lock.
15. As the protocol, I slash the collateral of a member who missed the installment, by transferring those tokens under the slash rule, so default has a real cost.
16. As a member who already won a cycle, I cannot bid again, so the group keeps rotating.
17. As a losing bidder, my plaintext bid is never passed to `allowPublic` or `publishDecryptResult`, so losing bids stay confidential after the cycle ends.

## Commands

```bash
pnpm install
pnpm compile
pnpm test
pnpm --filter @hush-samity/web dev
```

`pnpm compile` and `pnpm test` run Hardhat at the repository root. The plugin deploys mocks only for those local runs. Set `COFHE_SKIP_MOCKS_DEPLOY=1` only when the tests are pointed at an external RPC on purpose.

## Out of scope until the contracts exist

No Solidity sources yet. No demo UI data. No claim that a flow works before a testnet transaction has moved ERC-20 and a verified decrypt has settled a cycle.
