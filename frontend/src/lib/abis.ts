export const erc20Abi = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const samityErrorAbi = [
  { type: "error", name: "ZeroAddress", inputs: [] },
  { type: "error", name: "ZeroAmount", inputs: [] },
  { type: "error", name: "CountIsZero", inputs: [] },
  { type: "error", name: "CapAboveMax", inputs: [{ name: "cap", type: "uint32" }] },
  { type: "error", name: "BadDuration", inputs: [{ name: "duration", type: "uint256" }] },
  { type: "error", name: "JoinClosed", inputs: [] },
  { type: "error", name: "AlreadyJoined", inputs: [{ name: "account", type: "address" }] },
  { type: "error", name: "MemberCapReached", inputs: [{ name: "cap", type: "uint256" }] },
  { type: "error", name: "WindowClosed", inputs: [{ name: "deadline", type: "uint256" }] },
  { type: "error", name: "WindowOpen", inputs: [{ name: "deadline", type: "uint256" }] },
  { type: "error", name: "WrongPhase", inputs: [{ name: "current", type: "uint8" }] },
  { type: "error", name: "NotEligible", inputs: [{ name: "account", type: "address" }] },
  { type: "error", name: "AlreadyLocked", inputs: [{ name: "account", type: "address" }] },
  { type: "error", name: "CollateralRequired", inputs: [{ name: "account", type: "address" }] },
  { type: "error", name: "AlreadyPaid", inputs: [{ name: "account", type: "address" }] },
  { type: "error", name: "Shortfall", inputs: [
    { name: "account", type: "address" },
    { name: "expected", type: "uint256" },
    { name: "actual", type: "uint256" },
  ] },
  { type: "error", name: "NotVerifier", inputs: [{ name: "account", type: "address" }] },
  { type: "error", name: "DiscountAboveCap", inputs: [{ name: "discountBps", type: "uint32" }] },
  { type: "error", name: "InvalidWinner", inputs: [{ name: "winner", type: "address" }] },
  { type: "error", name: "NotCreator", inputs: [{ name: "account", type: "address" }] },
  { type: "error", name: "NothingToSweep", inputs: [] },
  { type: "error", name: "AccountingMismatch", inputs: [
    { name: "accounted", type: "uint256" },
    { name: "balance", type: "uint256" },
  ] },
  { type: "error", name: "LockFlagMismatch", inputs: [{ name: "account", type: "address" }] },
  { type: "error", name: "EtherNotAccepted", inputs: [] },
] as const;

const bidEngineErrorAbi = [
  { type: "error", name: "NotMember", inputs: [{ name: "account", type: "address" }] },
  { type: "error", name: "AlreadyBid", inputs: [{ name: "account", type: "address" }] },
  { type: "error", name: "BidNotAllowed", inputs: [{ name: "account", type: "address" }] },
  { type: "error", name: "NoBid", inputs: [{ name: "account", type: "address" }] },
  { type: "error", name: "DirectJoinDisabled", inputs: [] },
] as const;

/** Selectors from `@fhenixprotocol/cofhe-errors`. Bubbled by `FHE.asEuint32`. */
const cofheErrorAbi = [
  { type: "error", name: "InvalidSignature", inputs: [] },
  {
    type: "error",
    name: "InvalidSigner",
    inputs: [
      { name: "signer", type: "address" },
      { name: "expectedSigner", type: "address" },
    ],
  },
  {
    type: "error",
    name: "ACLNotAllowed",
    inputs: [
      { name: "handle", type: "uint256" },
      { name: "account", type: "address" },
    ],
  },
  {
    type: "error",
    name: "InvalidEncryptedInput",
    inputs: [
      { name: "got", type: "uint8" },
      { name: "expected", type: "uint8" },
    ],
  },
  {
    type: "error",
    name: "InvalidInputType",
    inputs: [
      { name: "actual", type: "uint8" },
      { name: "expected", type: "uint8" },
    ],
  },
  { type: "error", name: "SenderNotAllowed", inputs: [{ name: "sender", type: "address" }] },
  { type: "error", name: "ECDSAInvalidSignature", inputs: [] },
  { type: "error", name: "ECDSAInvalidSignatureLength", inputs: [{ name: "length", type: "uint256" }] },
  { type: "error", name: "ECDSAInvalidSignatureS", inputs: [{ name: "s", type: "bytes32" }] },
] as const;

const erc20ErrorAbi = [
  {
    type: "error",
    name: "ERC20InsufficientBalance",
    inputs: [
      { name: "sender", type: "address" },
      { name: "balance", type: "uint256" },
      { name: "needed", type: "uint256" },
    ],
  },
  {
    type: "error",
    name: "ERC20InsufficientAllowance",
    inputs: [
      { name: "spender", type: "address" },
      { name: "allowance", type: "uint256" },
      { name: "needed", type: "uint256" },
    ],
  },
  { type: "error", name: "ERC20InvalidApprover", inputs: [{ name: "approver", type: "address" }] },
  { type: "error", name: "ERC20InvalidSpender", inputs: [{ name: "spender", type: "address" }] },
  { type: "error", name: "ERC20InvalidReceiver", inputs: [{ name: "receiver", type: "address" }] },
  { type: "error", name: "ERC20InvalidSender", inputs: [{ name: "sender", type: "address" }] },
  { type: "error", name: "SafeERC20FailedOperation", inputs: [{ name: "token", type: "address" }] },
] as const;

export const revertAbi = [...samityErrorAbi, ...bidEngineErrorAbi, ...cofheErrorAbi, ...erc20ErrorAbi] as const;

export const collateralAbi = [
  {
    type: "function",
    name: "locked",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const bidEngineAbi = [
  ...bidEngineErrorAbi,
  ...cofheErrorAbi,
  {
    type: "function",
    name: "submitBid",
    stateMutability: "nonpayable",
    inputs: [
      { name: "inBid", type: "bytes32" },
      { name: "inputProof", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "hasSubmitted",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "myBid",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

export const samityAbi = [
  ...samityErrorAbi,
  {
    type: "constructor",
    stateMutability: "nonpayable",
    inputs: [
      { name: "creator_", type: "address" },
      { name: "token_", type: "address" },
      { name: "installmentAmount_", type: "uint256" },
      { name: "collateralAmount_", type: "uint256" },
      { name: "memberCap_", type: "uint256" },
      { name: "cycleDuration_", type: "uint256" },
      { name: "totalCycles_", type: "uint256" },
      { name: "maxDiscountCap_", type: "uint32" },
    ],
  },
  {
    type: "function",
    name: "token",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "creator",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "installmentAmount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "collateralAmount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "memberCap",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalCycles",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "maxDiscountCap",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }],
  },
  {
    type: "function",
    name: "bidEngine",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "collateral",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "phase",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "currentCycle",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "collectedPot",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "memberCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "cycleDeadline",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "isMember",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "slashed",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "hasLocked",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "hasPaid",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "hasWon",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "canBid",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "join",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "lockCollateral",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "payInstallment",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "closeCycle",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
] as const;

export const PHASES = ["Bidding", "AwaitingReveal", "Complete"] as const;

export function phaseName(phase: number): string {
  return PHASES[phase] ?? `Phase ${phase}`;
}
