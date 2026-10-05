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
};

function walk(error: unknown, depth = 0): unknown[] {
  if (!error || typeof error !== "object" || depth > 6) return [];
  const next = "cause" in error ? walk(error.cause, depth + 1) : [];
  return [error, ...next];
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
  const name = errorName(error);
  if (name) return REVERT_TEXT[name] ?? `The transaction reverted (${name}).`;
  const specific = text.find((line) => line.length > 0 && !/^The contract function /.test(line));
  if (specific) return specific;
  if (text[0]) return text[0];
  return "The request failed.";
}
