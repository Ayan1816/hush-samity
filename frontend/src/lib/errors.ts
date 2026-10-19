import { decodeErrorResult, type Hex } from "viem";
import { en, isNotice, translate, type MessageKey } from "@/src/i18n/messages";
import { revertAbi } from "@/src/lib/abis";

export type ClassifiedError = {
  key: MessageKey;
  vars?: Record<string, string | number>;
};

const PHRASES: Record<string, MessageKey> = {
  "The bid quote inputs must be non-negative.": "errQuoteNegative",
  "The discount is above 10,000 basis points.": "errQuoteCap",
  "The pool does not fit in uint256.": "errPoolFit",
  "The discount amount does not fit in uint256.": "errDiscountFit",
  "The Samity bytecode response was empty.": "bytecodeEmpty",
  "The deployment transaction did not return a contract address.": "noContractAddress",
  "Connect wallet first": "connectWalletFirst",
  "Switch to Sepolia": "switchToSepolia",
  "Enter a valid samity address (0x…).": "joinInvalidAddress",
  "The chain client is not ready.": "chainClientNotReady",
  "No contract code at this address on this chain.": "noCodeHere",
  "This address is not a Samity contract.": "notSamityContract",
  "The wallet provider is not ready yet.": "walletNotReady",
  "Enter the discount as a whole number of basis points.": "enterWholeBps",
  "The discount does not fit in a uint32.": "errUint32",
  "Encryption failed.": "errEncryptionFailed",
  "This account has not submitted a bid.": "err_NoBid",
  "This cycle's window is closed.": "err_WindowClosed",
  "Connect the wallet that will bid.": "connectBidder",
  "Waiting for the latest block timestamp.": "gateWaitingTimestamp",
  "Reading membership and the bidding window.": "gateReadingMembership",
  "Bidding is not open in this phase.": "gatePhase",
  "Join the samity before bidding.": "gateJoinFirst",
  "This member is slashed and cannot bid.": "gateSlashed",
  "This member already won a cycle and cannot bid again.": "gateWon",
  "Lock collateral before bidding.": "gateLockFirst",
  "Pay the installment before bidding.": "gatePayFirst",
  "Reading whether this wallet already bid.": "gateReadingSubmission",
  "This wallet already submitted a bid for this cycle.": "alreadySubmitted",
  "This account cannot bid right now.": "gateCannotBid",
  "Connect a wallet on this chain.": "connectWalletOnChain",
  "Waiting for the allowance.": "waitingAllowance",
  "The allowance is below the amount this step pulls.": "allowanceBelow",
  "No public client for this chain.": "noPublicClient",
  "Checking membership and the bidding window.": "checkingMembership",
  "This wallet is not registered in the samity. Join before bidding.": "notRegistered",
  "Checking the encrypted bid.": "checkingEncrypted",
  "Connect the wallet that sealed this bid.": "connectSealed",
  "Connect the wallet that will submit this bid.": "connectSubmitter",
  "The connected chain has no CoFHE coprocessor in this client.": "noCoprocessor",
  "BidEngine address is not a valid address.": "badEngine",
  "Connect the bidding account. The bid handle comes from BidEngine.myBid.": "connectBiddingAccount",
  "The deadline does not fit a calendar timestamp.": "errCalendarTimestamp",
  "The round number is below 1.": "errRoundBelowOne",
  "The installment amount is negative.": "errInstallmentNegative",
  "The deadline does not fit a calendar end time.": "errCalendarEnd",
  "The ciphertext handle is not a 32-byte hex value.": "errHandleHex",
  "The input proof is not the 65-byte CoFHE batch signature.": "errProofLength",
  "The input proof signature type is not an ECDSA recovery id.": "errProofType",
  "A member address read failed.": "errMemberAddress",
  "currentCycle is below 1.": "errCycleBelow",
  "The settled round count does not fit a receipt read.": "errSettledFit",
  "The transaction used the zero address.": "err_ZeroAddress",
  "An amount was zero.": "err_ZeroAmount",
  "The member count or the number of cycles was zero.": "err_CountIsZero",
  "The discount cap is above 10,000 basis points.": "err_CapAboveMax",
  "That cycle duration is not allowed.": "err_BadDuration",
  "Joining is closed. New members can only join in cycle 1 while bidding is open.": "err_JoinClosed",
  "This account already joined.": "err_AlreadyJoined",
  "This samity is already full.": "err_MemberCapReached",
  "This cycle's window is still open.": "err_WindowOpen",
  "That action is not available in the current phase.": "err_WrongPhase",
  "This account cannot do that.": "err_NotEligible",
  "Collateral is already locked for this cycle.": "err_AlreadyLocked",
  "Lock collateral before paying the installment.": "err_CollateralRequired",
  "The installment is already paid for this cycle.": "err_AlreadyPaid",
  "The token transfer did not match the required amount.": "err_Shortfall",
  "Only the reveal verifier can do that.": "err_NotVerifier",
  "The discount is above the creator cap.": "err_DiscountAboveCap",
  "The winner is not a valid member.": "err_InvalidWinner",
  "Only the creator can do that.": "err_NotCreator",
  "There is nothing to sweep.": "err_NothingToSweep",
  "The token balance does not match the contract accounting.": "err_AccountingMismatch",
  "The lock flag does not match the collateral contract.": "err_LockFlagMismatch",
  "This contract does not accept ETH.": "err_EtherNotAccepted",
  "This wallet already submitted a bid for this cycle.": "err_AlreadyBid",
  "This wallet cannot bid yet. Join, lock collateral, and pay the installment while the window is open.": "err_BidNotAllowed",
  "Join through the samity. The bid engine does not take direct joins.": "err_DirectJoinDisabled",
  "The ciphertext proof was rejected. Seal the bid again for this BidEngine.": "err_InvalidSignature",
  "The ciphertext was encrypted for a different account, chain, or contract. Seal the bid again from this wallet.": "err_InvalidSigner",
  "The wallet does not hold enough tokens.": "err_ERC20InsufficientBalance",
  "The token allowance is below the required amount.": "err_ERC20InsufficientAllowance",
  "The token transfer failed.": "err_SafeERC20FailedOperation",
  "You rejected the transaction in your wallet.": "errUserRejected",
  "The request failed.": "errRequestFailed",
};

function hasKey(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}

function walk(error: unknown, depth = 0): unknown[] {
  if (!error || typeof error !== "object" || depth > 6) return [];
  const next = "cause" in error ? walk(error.cause, depth + 1) : [];
  return [error, ...next];
}

function hexData(value: unknown): Hex | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value) || value.length < 10) return null;
  return value as Hex;
}

function errorName(error: unknown): string | null {
  for (const item of walk(error)) {
    if (!item || typeof item !== "object" || !("data" in item)) continue;
    const data = item.data;
    if (data && typeof data === "object" && "errorName" in data && typeof data.errorName === "string" && data.errorName) {
      return data.errorName;
    }
  }
  return null;
}

function revertHex(error: unknown): Hex | null {
  for (const item of walk(error)) {
    if (!item || typeof item !== "object") continue;
    const record = item as { data?: unknown; raw?: unknown };
    const direct = hexData(record.raw) ?? hexData(record.data);
    if (direct) return direct;
    if (record.data && typeof record.data === "object" && "data" in record.data) {
      const nested = hexData(record.data.data);
      if (nested) return nested;
    }
  }
  return null;
}

function revertKey(name: string): ClassifiedError {
  const key = `err_${name}`;
  if (hasKey(key)) return { key };
  return { key: "errReverted", vars: { name } };
}

function decodedRevert(error: unknown): ClassifiedError | null {
  const named = errorName(error);
  if (named) return revertKey(named);
  const data = revertHex(error);
  if (!data) return null;
  try {
    const decoded = decodeErrorResult({ abi: revertAbi, data });
    if (decoded.errorName === "WindowClosed" && decoded.args && typeof decoded.args[0] === "bigint") {
      return { key: "errWindowClosedAt", vars: { at: decoded.args[0].toString() } };
    }
    return revertKey(decoded.errorName);
  } catch {
    return null;
  }
}

function lines(error: unknown): string[] {
  const found: string[] = [];
  for (const item of walk(error)) {
    if (!item || typeof item !== "object") continue;
    const record = item as { name?: unknown; code?: unknown; shortMessage?: unknown; message?: unknown };
    if (record.name === "UserRejectedRequestError" || record.code === 4001 || record.code === "ACTION_REJECTED") {
      found.push("user rejected");
    }
    if ("shortMessage" in record && typeof record.shortMessage === "string" && record.shortMessage) found.push(record.shortMessage);
    if ("message" in record && typeof record.message === "string" && record.message) found.push(record.message);
  }
  if (typeof error === "string" && error) found.push(error);
  return found;
}

function rejected(text: string[]): boolean {
  return text.some((line) => /user rejected|user denied|rejected the request|denied transaction|user cancelled|user canceled/i.test(line));
}

function insufficientGas(text: string[]): boolean {
  return text.some((line) =>
    /insufficient funds for gas|insufficient funds|gas required exceeds allowance|intrinsic transaction cost/i.test(line),
  );
}

function wrongNetwork(text: string[]): boolean {
  return text.some((line) =>
    /wrong network|chain mismatch|unsupported chain|not configured for chain|does not match the target chain|must be connected to chain/i.test(line),
  );
}

function insufficientBalance(text: string[]): boolean {
  return text.some((line) => /transfer amount exceeds balance|insufficient balance|exceeds balance/i.test(line));
}

function insufficientAllowance(text: string[]): boolean {
  return text.some((line) => /insufficient allowance/i.test(line));
}

function fromPhrase(line: string): ClassifiedError | null {
  const exact = PHRASES[line];
  if (exact) return { key: exact };
  const closed = /^This cycle's window closed at (.+)\.$/.exec(line);
  if (closed?.[1]) return { key: "errWindowClosedAt", vars: { at: closed[1] } };
  const reverted = /^The transaction reverted \(([^)]+)\)\.$/.exec(line);
  if (reverted?.[1]) return revertKey(reverted[1]);
  const whole = /^(.+) must be a whole number\.$/.exec(line);
  if (whole?.[1]) return { key: "errWholeNumber", vars: { label: whole[1] } };
  const positive = /^(.+) must be greater than zero\.$/.exec(line);
  if (positive?.[1]) return { key: "errGreaterThanZero", vars: { label: positive[1] } };
  const decimals = /^(.+) does not fit this token's (\d+) decimals\.$/.exec(line);
  if (decimals?.[1] && decimals[2]) return { key: "errDecimals", vars: { label: decimals[1], decimals: decimals[2] } };
  const unread = /^(.+) could not be read\.$/.exec(line);
  if (unread?.[1]) return { key: "errCouldNotRead", vars: { label: unread[1] } };
  const cap = /^The on-chain cap is (\d+) bps\.$/.exec(line);
  if (cap?.[1]) return { key: "capIs", vars: { max: cap[1] } };
  const enter = /^Enter (.+)\.$/.exec(line);
  if (enter?.[1]) return { key: "errEnterField", vars: { label: enter[1] } };
  return null;
}

function specificLine(text: string[]): string | null {
  return (
    text.find((line) => line.length > 0 && line !== "user rejected" && !/^The contract function /.test(line) && !/unknown reason/i.test(line)) ??
    null
  );
}

/**
 * Turns a thrown wallet, RPC, or contract error into a dictionary key.
 * The sentence is chosen later, so a language change can rephrase the same failure.
 */
export function classifyError(error: unknown): ClassifiedError {
  if (isNotice(error)) return { key: error.k, vars: error.vars };
  const text = lines(error);
  if (rejected(text)) return { key: "errUserRejected" };
  const decoded = decodedRevert(error);
  if (decoded) return decoded;
  if (insufficientGas(text)) return { key: "errInsufficientGas" };
  if (wrongNetwork(text)) return { key: "errWrongNetwork" };
  if (insufficientBalance(text)) return { key: "err_ERC20InsufficientBalance" };
  if (insufficientAllowance(text)) return { key: "err_ERC20InsufficientAllowance" };
  for (const line of text) {
    const phrase = fromPhrase(line);
    if (phrase) return phrase;
  }
  const raw = specificLine(text);
  if (raw) return { key: "errRaw", vars: { text: raw } };
  return { key: "errRequestFailed" };
}

/** English sentence. Screens should use `useI18n().format` so the active language applies. */
export function errorText(error: unknown): string {
  const classified = classifyError(error);
  return translate("en", classified.key, classified.vars);
}
