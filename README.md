# Hush Samity

Confidential rotating savings on Ethereum Sepolia, encrypted with Fhenix CoFHE.

Live app: [https://hush-samity-theta.vercel.app](https://hush-samity-theta.vercel.app)

A samity here is a fixed group of members who pool an ERC-20 installment every round. One member receives that round’s pot. The recipient is not chosen by a roster order. The member who bids the highest discount wins. The discount is how much of the pot the winner gives back to the other payers. Losing discount bids stay encrypted for the life of the samity. Only the winning basis points and the winning address are decrypted, and only after a CoFHE signature check.

**বাংলা।** Hush Samity হলো Ethereum Sepolia-তে একটি গোপন ঘূর্ণায়মান সঞ্চয় সমিতি। ছাড়ের বিড Fhenix CoFHE দিয়ে এনক্রিপ্ট থাকে। লাইভ অ্যাপ: [https://hush-samity-theta.vercel.app](https://hush-samity-theta.vercel.app)

প্রতি রাউন্ডে সদস্যরা একটি ERC-20 কিস্তি জমা দেন। কে পুল পাবেন, তা আসনের ক্রম থেকে ঠিক হয় না। যিনি সবচেয়ে বেশি ছাড়ের বিড দেন, তিনিই জেতেন। ছাড় মানে জেতা পুলের যে অংশ অন্য কিস্তিদাতাদের ফিরে যায়। হারা বিড সমিতির পুরো জীবনে এনক্রিপ্টেড থাকে। শুধু জেতা বেসিস পয়েন্ট ও জেতা ঠিকানা ডিক্রিপ্ট হয়, এবং সেটি CoFHE স্বাক্ষর যাচাইয়ের পরে।

## What is public, and what stays sealed

Public on the chain:

- The token, installment, collateral, member cap, cycle length, total cycles, and the creator’s discount cap.
- Who joined, who locked collateral, who paid, and who has already won a round.
- The collected pot.
- After a verified reveal: the winning discount, the winner, the dividend, and the winner’s payout.

Private:

- Every losing bid.
- A member’s own bid, except to that member on their own device.
- Who is ahead during the round. The leader is an encrypted address.

The web app reads these values from Ethereum Sepolia (chain id `11155111`). The same client can also talk to Arbitrum Sepolia (`421614`) and Base Sepolia (`84532`) when the wallet is on those CoFHE testnets. The deployed site and the Open Graph tags are aimed at Ethereum Sepolia.

**বাংলা।** চেইনে প্রকাশ্য: টোকেন, কিস্তি, জামানত, সদস্য সীমা, চক্রের দৈর্ঘ্য, মোট চক্র, নির্মাতার ছাড়ের সীমা, কে যোগ দিয়েছেন, কে লক করেছেন, কে কিস্তি দিয়েছেন, কে আগে জিতেছেন, এবং জমা পুল। যাচাই করা প্রকাশের পরে জেতা ছাড়, বিজয়ী, লভ্যাংশ, ও বিজয়ীর পরিশোধও প্রকাশ্য।

গোপন: প্রতিটি হারা বিড, এবং রাউন্ড চলাকালীন কে এগিয়ে আছেন। নিজের বিড শুধু সেই সদস্য নিজের ডিভাইসে খুলতে পারেন।

## How the money moves

There is no factory in this repository. The creator deploys `Samity` directly from the website. The constructor deploys three child contracts and binds them:

| Contract | Role |
| --- | --- |
| `Samity` | The non-custodial vault for installments. It keeps the pot, pays the winner, pays dividends, and records the round. It is not the creator’s wallet. The creator cannot pull the pot. |
| `Collateral` | The collateral vault. Members approve this contract, not the samity, for the lock. It pulls, refunds, and slashes the same ERC-20. Its internal lock total has to match the tokens it holds. |
| `BidEngine` | Stores one encrypted `uint32` discount per member for the current round. The ciphertext is bound to this contract and to the signer. |
| `RevealVerifier` | The only contract allowed to call `Samity.settle`. It checks the CoFHE decrypt signature before any plaintext bid is used. |

`Samity` does not accept ETH. Gas is paid in Sepolia ETH. Installments and collateral are the chosen ERC-20. The app’s test token button fills Test TUSD at `0xafe683fa48d0823772bb290b31720918e5613adc` (6 decimals). Any other ERC-20 address can be used if it has `decimals`, `symbol`, `balanceOf`, `allowance`, and `approve`.

### One round

1. **Join.** Only in round 1, while bidding is open and the roster is not full. `Samity.join` registers the member and locks collateral in the same transaction. The token pull is `Collateral.lock`, so the allowance spender is the collateral contract.
2. **Lock again.** Later rounds refund the lock at settlement, so the member locks again before paying. The spender is still `Collateral`.
3. **Pay.** `Samity.payInstallment` pulls `installmentAmount` into the samity. The spender is the samity contract. The received amount must equal the configured installment. The pot increases by that amount.
4. **Seal a bid.** The member encrypts a basis-point discount in the browser. `10_000` is the whole pot. `BidEngine.submitBid` stores the ciphertext only after the ZK proof checks out. A member who already won cannot bid again. They still owe later installments.
5. **Close.** Anyone can call `Samity.closeCycle` once the chain timestamp has reached the deadline.
   - If `submittedCount` is `0`, that same transaction settles the round. There is no winner. The pot is retained in the samity. Payers are refunded their collateral. Members who did not pay are slashed and leave the later rounds.
   - If at least one bid was sealed, `closeCycle` does not move the pot. `BidEngine` publishes only the winning discount handle and the winning encrypted address. The phase becomes “awaiting reveal”.
6. **Reveal and pay.** `Samity.settle` is the payout. Only the verifier deployed with that samity may call it, and only after `FHE.verifyDecryptResult` accepts the decrypt signature. The winner receives `pot - dividend`. Each other payer receives `dividend / otherPayers`. Rounding dust stays in the samity. Payers get collateral back. Non-payers are slashed. The winner cannot bid in a later round. The web app closes the cycle and then shows the on-chain receipt. It does not itself call `decryptForTx` or `RevealVerifier.finalize`.

The creator may later sweep retained dust and slashed collateral to an address they choose. That sweep cannot touch an open pot or tokens still locked in `Collateral`.

**বাংলা।** এই রিপোতে কোনো ফ্যাক্টরি নেই। ওয়েবসাইট থেকে সরাসরি `Samity` ডিপ্লয় হয়। কনস্ট্রাক্টর নিজে `BidEngine`, `Collateral`, ও `RevealVerifier` তৈরি করে বেঁধে দেয়।

`Samity` কিস্তির ভল্ট। এটি নির্মাতার ব্যক্তিগত ওয়ালেট নয়। নির্মাতা ইচ্ছেমতো পুল তুলতে পারেন না। `Collateral` জামানতের ভল্ট। জামানতের অনুমোদন এই কন্ট্রাক্টকে দিতে হয়। `BidEngine` এই রাউন্ডের এনক্রিপ্টেড ছাড় রাখে। `RevealVerifier` ছাড়া `Samity.settle` কল করা যায় না।

গ্যাস Sepolia ETH। কিস্তি ও জামানত ERC-20। অ্যাপের টেস্ট বাটন এই TUSD ঠিকানা বসায়: `0xafe683fa48d0823772bb290b31720918e5613adc` (৬ দশমিক)।

যোগদান শুধু প্রথম রাউন্ডে। জামানত কাটে `Collateral`। কিস্তি কাটে `Samity`। বিড ব্রাউজারে এনক্রিপ্ট হয়ে `BidEngine.submitBid`-এ যায়। সময়সীমার পরে যে কেউ `closeCycle` কল করতে পারেন। কোনো বিড না থাকলে সেই লেনদেনেই নিষ্পত্তি হয়: বিজয়ী নেই, পুল সমিতিতে থাকে, কিস্তিদাতা জামানত ফেরত পান, কিস্তি না দিলে জামানত কাটা হয়। অন্তত একটি বিড থাকলে `closeCycle` পুল সরায় না। শুধু জেতা হ্যান্ডেল প্রকাশ্য হয়। পরিশোধ হয় `Samity.settle`-এ, যাচাইয়ের পরে, শুধু সেই সমিতির `RevealVerifier` থেকে। এই ওয়েব অ্যাপ `decryptForTx` বা `finalize` নিজে কল করে না। এটি চক্র বন্ধ করে এবং নিষ্পত্তির রসিদ দেখায়।

## Approvals

The app does not approve both contracts for every action.

- Join and lock compare the collateral contract’s allowance with the current collateral pull. If it is short, one `approve` is sent to `Collateral`.
- Pay compares the samity’s allowance with the current installment. If it is short, one `approve` is sent to `Samity`.
- The approved amount is the whole obligation: `collateralAmount + installmentAmount * totalCycles`. A later round does not ask again while that allowance still covers the next pull.
- The Approve button is hidden once the on-chain allowance covers the current pull. An optimistic local allowance updates the button as soon as the approval receipt succeeds, then the real `allowance` is refetched.
- After `approve`, `join`, `lockCollateral`, `payInstallment`, `submitBid`, and `closeCycle`, the app refetches the watched block so membership, balances, and the timeline update without a manual reload.
- Switching wallet or network drops the previous account’s optimistic membership, bid flag, and allowance. Placeholder reads from the previous account are not shown as the new account’s seat.

**বাংলা।** জামানতের অনুমোদন শুধু `Collateral`-কে। কিস্তির অনুমোদন শুধু `Samity`-কে। একবার অনুমোদিত পরিমাণ পুরো দায়: জামানত যোগ কিস্তি গুণ মোট চক্র। বর্তমান টানে যথেষ্ট থাকলে আবার অনুমোদন চায় না। রসিদ আসার পর ব্লক আবার পড়া হয়, তাই পাতা রিলোড ছাড়া বোতাম বদলায়। ওয়ালেট বদলালে আগের অ্যাকাউন্টের আসন বা অনুমোদন নতুন অ্যাকাউন্টে লেগে থাকে না।

## Features

### Confidential discount bidding

`SealBid` runs the CoFHE browser pipeline and binds it to the active signer:

1. `initTfhe` — initialize TFHE
2. `fetchKeys` — fetch the FHE key and CRS
3. `pack` — pack the ciphertext
4. `prove` — generate the ZK proof
5. `verify` — verify with the ZK verifier

The proof is a 65-byte batch signature. `setAccount`, `setChainId`, and `setConsumingContract(BidEngine)` run before execute. Switching account or chain cancels an in-flight seal so the old proof is not submitted by the new signer. The wax seal is an SVG bound to those steps and to the submit receipt: it pulses only when `submitBid` is confirmed.

The five step names are translated. The CoFHE step id stays visible in monospace next to the translation. CoFHE’s own SDK error text stays in English.

**বাংলা।** সিল করার পাঁচ ধাপ: TFHE চালু, চাবি আনা, সিফারটেক্সট প্যাক, ZK প্রমাণ, ZK যাচাই। প্রমাণ সক্রিয় স্বাক্ষরকারী, চেইন, ও `BidEngine`-এর সাথে বাঁধা। ওয়ালেট বদলালে চলমান সিল বাতিল হয়। মোমের সিল তখনই স্পন্দিত হয়, যখন `submitBid` রসিদ নিশ্চিত।

### Round timeline and counters

The timeline is Pay, Bid, Reveal, Payout. The highlighted stage comes from the on-chain phase, the deadline, and the member roster. It is not a timer pretending the contract moved.

- While bidding is open, the stage is Pay until every non-slashed member has paid and the roster is full (or the round is after round 1). Then it moves to Bid.
- After the chain deadline, bids on record move the highlight to Reveal. No sealed bids moves it to Payout, matching `closeCycle` with an empty book.
- The countdown is the chain timestamp plus the seconds elapsed since that block was observed. Amounts and times use the chain’s integers. The clock does not invent a deadline.
- Collateral Locked, Installments Paid, and Bids Sealed are counts from `hasLocked`, `hasPaid`, and `BidEngine.hasSubmitted` at one block. A missing bid read is an error, not a zero.

**বাংলা।** সময়রেখা: কিস্তি, বিড, প্রকাশ, পরিশোধ। কাউন্টডাউন চেইনের সময় থেকে। জামানত লক, কিস্তি, ও সিল করা বিডের সংখ্যা সেই ব্লকের সদস্য স্টোরেজ থেকে।

### What the chain sees

Two columns. The left column is this wallet’s plaintext: a discount typed on the device, or a value unsealed with that wallet’s CoFHE key. The right column is the public field: the `bytes32` handle, the same value as a uint256, the TaskManager address, and whether `isAllowed` / `isPubliclyAllowed` is true. The basis points are not inside the handle. `isPubliclyAllowed` stays false for a stored bid, so an explorer cannot decrypt it.

### Bid simulator

The calculator uses integer arithmetic only:

- `pool = installment * memberCap`
- `discount = (pool * bps) / 10_000`
- `winner = pool - discount`
- `your dividend = discount / (memberCap - 1)` when the cap is greater than one

This is the full-roster quote. It matches the contract’s basis-point division for a round where every seat has paid. Settlement itself uses the actual `collectedPot` and the number of other payers in that round, which can be smaller if someone missed a payment. The panel says when the installment, cap, or decimals have not been read. It does not fill those in.

**বাংলা।** সিমুলেটর পূর্ণ রোস্টার ধরে: পুল = কিস্তি গুণ সদস্য সীমা। ভাগ পূর্ণসংখ্যায়। আসল নিষ্পত্তি সেই রাউন্ডে জমা পুল ও বাকি কিস্তিদাতার সংখ্যা ব্যবহার করে। না পড়া সংখ্যা বসানো হয় না।

### Round receipts

Settled rounds are read from `cycleResults`, then matched to `CycleClosed` and `CycleSettled` logs. Each card shows the winner, winning basis points, net payout, retained dust, and the token transfers to non-winners in the settlement transaction. Links go to Sepolia Etherscan, Arbiscan, or Basescan for that chain. The privacy badge counts losing bids as `submittedCount - 1` from `RevealPrepared` on the closing transaction, and only when that count is at least one. `hadBids == false` is zero losing bids, because close did not decrypt a bid.

### Invite, share, and calendar

The invite bar copies the samity URL plus the on-chain installment, collateral, and deadline. WhatsApp and Telegram open with that text. The `.ics` file is RFC 5545, UTF-8, with the event at the chain deadline. Open Graph for `/samity/[address]` is generated on the server from a live Sepolia read of that contract. The preview language follows the `hush-samity-locale` cookie.

### বাংলা | EN

The dictionary is `frontend/src/i18n/messages.ts`. English and Bangla have the same keys. The toggle sits in the top bar beside the wallet box. The choice is stored in `localStorage` (`hush-samity:locale`) and in the cookie `hush-samity-locale`, so the first paint and the page title match. Errors are stored as the original failure and translated when they are shown, so a language change does not leave a frozen sentence.

The decoder covers samity, bid-engine, collateral, verifier, CoFHE, and ERC-20 reverts, including `InvalidSigner`, a closed window, an unpaid installment, a low token balance, a low allowance, too little gas ETH, the wrong network, and a wallet rejection. An unknown RPC line is shown as returned. Connector names, addresses, hashes, token symbols, and function names such as `submitBid` stay as they are.

## Test a 3-member samity

Use three browser profiles or three wallets. Each needs a little Sepolia ETH for gas. The app network is Ethereum Sepolia.

1. Open [https://hush-samity-theta.vercel.app](https://hush-samity-theta.vercel.app) and connect wallet A.
2. On **Create a new samity**, press **Autofill Test TUSD** or paste `0xafe683fa48d0823772bb290b31720918e5613adc`. The form reads `name`, `symbol`, `decimals`, and wallet A’s balance from the chain.
3. If the balance is zero, mint test tokens from that contract. `decimals()` is 6, so 1000 TUSD is `1000000000` base units. The deploy script’s `mint(address,uint256)` is public. Do not use this mint on a token you do not intend as play money.
4. Enter an installment and a collateral amount, for example `100` and `200`. Set **Members & Cycles** to `3`. That number is both the member cap and the number of rounds. Set **Max discount** between 1 and 10000 basis points. For a short test, choose **Custom** and enter `300` seconds. Weekly is `604800`.
5. Press **Deploy samity**, confirm in the wallet, and open the new address. The page reads the deployed code before it shows a desk.
6. Copy the link, or use WhatsApp or Telegram. Wallets B and C choose **Join an existing samity** and paste the address. The app checks bytecode and the samity reads before it navigates.
7. Each wallet, while round 1 is open: **Join** (approve `Collateral` if asked, then join), then **Pay installment** (approve `Samity` if asked). Join already locks collateral for round 1.
8. Each wallet that has not won: enter a discount, press **Seal bid**, wait through the five CoFHE steps, then confirm `submitBid`. Use a different basis-point value on each wallet if you want a clear winner.
9. Leave the page open until **Chain time** passes **Deadline**, or wait out the custom duration. The countdown is labeled in the timeline.
10. Any wallet presses **Close cycle**. The button stays disabled until the latest block is at or past the deadline.
11. Read the result on the desk.
    - No sealed bids: that transaction settles the round. Payers receive collateral back. The pot remains in the samity.
    - One or more sealed bids: the phase becomes awaiting reveal. The timeline moves to Reveal. Payout and collateral return happen when `RevealVerifier` settles the round. After that, **Round receipts** shows the winner, the payout, the dividend transfers, the explorer links, and the privacy badge. Refresh is automatic when the phase or round changes. You do not need to reload the page by hand.

Round 2 starts when settlement finishes. Winners still pay. They do not bid. Everyone else locks collateral again, pays, and may seal a new bid. A member who skips a payment is slashed at settlement and cannot continue.

**বাংলায় পরীক্ষা।** তিনটি ওয়ালেট ব্যবহার করুন। প্রতিটিতে গ্যাসের জন্য একটু Sepolia ETH লাগবে।

1. [https://hush-samity-theta.vercel.app](https://hush-samity-theta.vercel.app) খুলে ওয়ালেট A সংযুক্ত করুন।
2. **নতুন সমিতি তৈরি করুন**-এ **টেস্ট TUSD বসান** চাপুন, অথবা `0xafe683fa48d0823772bb290b31720918e5613adc` বসান। ফর্ম চেইন থেকে নাম, প্রতীক, দশমিক, ও ব্যালেন্স পড়ে।
3. ব্যালেন্স শূন্য হলে সেই টেস্ট কন্ট্রাক্ট থেকে টোকেন মিন্ট করুন। দশমিক ৬, তাই ১০০০ TUSD হলো `1000000000` বেস ইউনিট। এটি শুধু পরীক্ষার টোকেন।
4. কিস্তি ও জামানত লিখুন, যেমন `100` ও `200`। **সদস্য ও চক্র** দিন `3`। ছোট পরীক্ষায় **কাস্টম** বেছে `300` সেকেন্ড দিন। সাপ্তাহিক হলো `604800` সেকেন্ড।
5. **সমিতি ডিপ্লয় করুন** চাপুন। নতুন ঠিকানা খুলুন।
6. লিঙ্ক কপি করুন, বা WhatsApp / Telegram-এ দিন। ওয়ালেট B ও C **আগের সমিতিতে যোগ দিন** থেকে ঠিকানা বসাবে।
7. প্রথম রাউন্ড খোলা থাকতে প্রতিটি ওয়ালেট **যোগ** দেবে, তারপর **কিস্তি** দেবে। যোগদানই প্রথম রাউন্ডের জামানত লক করে। জামানতের অনুমোদন `Collateral`-কে, কিস্তির অনুমোদন `Samity`-কে।
8. যারা আগে জেতেননি, তারা ছাড় লিখে **বিড সিল** করবেন এবং `submitBid` নিশ্চিত করবেন।
9. **চেইনের সময়** যখন **সময়সীমা** পার হয়, তখন যে কোনো ওয়ালেট **চক্র বন্ধ করুন** চাপবে। তার আগে বোতাম বন্ধ থাকে।
10. কোনো বিড না থাকলে সেই লেনদেনেই নিষ্পত্তি হয়। কিস্তিদাতা জামানত ফেরত পান। বিড থাকলে পর্যায় হয় প্রকাশের অপেক্ষা। পরিশোধ ও জামানত ফেরত `RevealVerifier` নিষ্পত্তি করলে হয়। তারপর **রাউন্ড রসিদ**-এ বিজয়ী, পরিশোধ, লভ্যাংশ, এক্সপ্লোরার লিঙ্ক, ও গোপনীয়তার ব্যাজ দেখা যায়।

দ্বিতীয় রাউন্ড নিষ্পত্তির পরে খোলে। বিজয়ী আবার কিস্তি দেন, কিন্তু বিড দেন না। কিস্তি ফাঁকি দিলে নিষ্পত্তিতে জামানত কাটা হয়।

## Project layout

```
Hush-Samity/
  contracts/                 Samity, BidEngine, Collateral, RevealVerifier
  test/                      Hardhat tests
  frontend/                  Next.js app (@hush-samity/web)
    app/                     App Router entry (re-exports the screens)
    src/app/                 Same routes, including /samity/[address]
    src/components/          Desk, seal, timeline, receipts, wallet, language
    src/i18n/                en / bn dictionary and provider
    src/lib/                 approvals, quotes, receipts, errors, calendar
    src/screens/             Home and samity page
  hardhat.config.ts          Solidity 0.8.28, cancun, CoFHE plugin
  instructions.md            Build contract for contributors
```

The active UI is `frontend/src`. `frontend/app` re-exports the same pages and repeats the root and samity layouts so either App Router root serves the same app.

## Local setup

Requirements: Node.js 20 or newer, and pnpm `11.18.0` (see the root `packageManager` field).

```bash
pnpm install
pnpm dev
```

`pnpm dev` starts the Next.js app. The production site is the Vercel URL above. A local app reads Ethereum Sepolia through `NEXT_PUBLIC_SEPOLIA_RPC_URL` when that variable is an `http` or `https` URL. Otherwise it uses viem’s public Sepolia endpoint. The variable is inlined at build time.

Contract commands, from the repository root:

```bash
cp .env.example .env
pnpm compile
pnpm test
```

`.env` is only for Hardhat. `PRIVATE_KEY` is a testnet signer. Never commit it. Optional RPC names are `SEPOLIA_RPC_URL`, `ARBITRUM_SEPOLIA_RPC_URL`, and `BASE_SEPOLIA_RPC_URL`.

To deploy a fresh TestUSD on Sepolia, from `frontend/`:

```bash
npm install --no-save --no-package-lock solc@0.8.37 dotenv@16.4.7
node deploy-test-token.js
```

The script reads `PRIVATE_KEY` and `SEPOLIA_RPC_URL` from `frontend/.env` or the root `.env`, compiles TestUSD, deploys it, and mints `1000000000` base units (1000 TUSD) to the deployer. It does not print the key or the RPC URL.

Frontend production build, when you intend to build:

```bash
pnpm --filter @hush-samity/web build
```

That runs `next build --webpack`.

**বাংলা।** Node.js 20 বা তার বেশি, এবং pnpm `11.18.0` লাগবে। রুটে `pnpm install`, তারপর `pnpm dev`। কন্ট্রাক্ট কম্পাইল `pnpm compile`, টেস্ট `pnpm test`। `.env` শুধু Hardhat-এর জন্য। চাবি কখনো কমিট করবেন না।

## Stack

| Piece | Pin |
| --- | --- |
| Solidity | 0.8.28, `evmVersion` `cancun` |
| Next.js | 16.3.6 |
| React | 19.3.0 |
| wagmi / viem | 2.19.5 / 2.38.6 |
| `@cofhe/sdk` | 0.7.1 |
| `@fhenixprotocol/cofhe-contracts` | 0.2.0 |
| OpenZeppelin | 5.4.0 |

CoFHE documentation: [https://cofhe-docs.fhenix.zone/](https://cofhe-docs.fhenix.zone/). Contributor rules that are stricter than this README live in `instructions.md`.
