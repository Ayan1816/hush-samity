import { decodeErrorResult, type Hex } from "viem";
import { revertAbi } from "@/src/lib/abis";

const REVERT_TEXT: Record<string, string> = {
  ZeroAddress: "The transaction used the zero address.",
  ZeroAmount: "An amount was zero.",
  CountIsZero: "The member count or the number of cycles was zero.",
  CapAboveMax: "The discount cap is above 10,000 basis points.",
  BadDuration: "That cycle duration is not allowed.",
  JoinClosed: "Joining is closed. New members can only join in cycle 1 while bidding is open.",
  AlreadyJoined: "This account already joined.",
  MemberCapReached: "This samity is already full.",
  WindowClosed: "This cycle's window is closed.",
  WindowOpen: "This cycle's window is still open.",
  WrongPhase: "That action is not available in the current phase.",
  NotEligible: "This account cannot do that.",
  AlreadyLocked: "Collateral is already locked for this cycle.",
  CollateralRequired: "Lock collateral before paying the installment.",
  AlreadyPaid: "The installment is already paid for this cycle.",
  Shortfall: "The token transfer did not match the required amount.",
  NotVerifier: "Only the reveal verifier can do that.",
  DiscountAboveCap: "The discount is above the creator cap.",
  InvalidWinner: "The winner is not a valid member.",
  NotCreator: "Only the creator can do that.",
  NothingToSweep: "There is nothing to sweep.",
  AccountingMismatch: "The token balance does not match the contract accounting.",
  LockFlagMismatch: "The lock flag does not match the collateral contract.",
  EtherNotAccepted: "This contract does not accept ETH.",
  NotMember: "This wallet is not registered in the samity. Join before bidding.",
  AlreadyBid: "This wallet already submitted a bid for this cycle.",
  BidNotAllowed: "This wallet cannot bid yet. Join, lock collateral, and pay the installment while the window is open.",
  NoBid: "This account has not submitted a bid.",
  DirectJoinDisabled: "Join through the samity. The bid engine does not take direct joins.",
  InvalidSignature: "The ciphertext proof was rejected. Seal the bid again for this BidEngine.",
  InvalidSigner: "The ciphertext was encrypted for a different account, chain, or contract. Seal the bid again from this wallet.",
  ECDSAInvalidSignature: "The ciphertext proof is not a valid ECDSA signature. Seal the bid again from this wallet.",
  ECDSAInvalidSignatureLength: "The ciphertext proof is not 65 bytes. Seal the bid again from this wallet.",
  ECDSAInvalidSignatureS: "The ciphertext proof signature is not canonical. Seal the bid again from this wallet.",
  ACLNotAllowed: "The contract is not allowed to use that ciphertext.",
  InvalidEncryptedInput: "The ciphertext payload does not match a uint32 bid.",
  InvalidInputType: "The ciphertext type is not uint32.",
  SenderNotAllowed: "This account is not allowed to use that ciphertext.",
  ERC20InsufficientBalance: "The wallet does not hold enough tokens.",
  ERC20InsufficientAllowance: "The token allowance is below the required amount.",
  ERC20InvalidApprover: "The token rejected the approving account.",
  ERC20InvalidSpender: "The token rejected the spender address.",
  ERC20InvalidReceiver: "The token rejected the receiving address.",
  ERC20InvalidSender: "The token rejected the sending address.",
  SafeERC20FailedOperation: "The token transfer failed.",
};

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

function decodedRevert(error: unknown): string | null {
  const named = errorName(error);
  if (named) return REVERT_TEXT[named] ?? `The transaction reverted (${named}).`;
  const data = revertHex(error);
  if (!data) return null;
  try {
    const decoded = decodeErrorResult({ abi: revertAbi, data });
    if (decoded.errorName === "WindowClosed" && decoded.args && typeof decoded.args[0] === "bigint") {
      return `This cycle's window closed at ${decoded.args[0].toString()}.`;
    }
    return REVERT_TEXT[decoded.errorName] ?? `The transaction reverted (${decoded.errorName}).`;
  } catch {
    return null;
  }
}

function messages(error: unknown): string[] {
  const found: string[] = [];
  for (const item of walk(error)) {
    if (!item || typeof item !== "object") continue;
    if ("shortMessage" in item && typeof item.shortMessage === "string" && item.shortMessage) found.push(item.shortMessage);
    if ("message" in item && typeof item.message === "string" && item.message) found.push(item.message);
  }
  return found;
}

export function errorText(error: unknown): string {
  const text = messages(error);
  if (text.some((line) => /user rejected|user denied|rejected the request/i.test(line))) {
    return "You rejected the transaction in your wallet.";
  }
  const decoded = decodedRevert(error);
  if (decoded) return decoded;
  const specific = text.find((line) => line.length > 0 && !/^The contract function /.test(line) && !/unknown reason/i.test(line));
  if (specific) return specific;
  if (text[0]) return text[0];
  return "The request failed.";
}
