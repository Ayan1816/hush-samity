import type { Hex } from "viem";

/** `externalEuint32` is a `bytes32`. The SDK returns a 32-byte hex handle. */
export function normalizeHandle(handle: string): Hex {
  const body = handle.startsWith("0x") || handle.startsWith("0X") ? handle.slice(2) : handle;
  if (!/^[0-9a-fA-F]+$/.test(body) || body.length === 0 || body.length > 64) {
    throw new Error("The ciphertext handle is not a 32-byte hex value.");
  }
  return `0x${body.padStart(64, "0")}`;
}

/**
 * `submitBid` takes the batch signature from `encryptInputs`.
 * CoFHE appends `v = recid + 27`. TaskManager accepts only this 65-byte form.
 * A longer blob reverts `ECDSAInvalidSignatureLength`, which wallets report
 * as an unknown revert.
 */
export function normalizeProof(proof: string): Hex {
  const body = proof.startsWith("0x") || proof.startsWith("0X") ? proof.slice(2) : proof;
  if (!/^[0-9a-fA-F]+$/.test(body) || body.length !== 130) {
    throw new Error("The input proof is not the 65-byte CoFHE batch signature.");
  }
  const v = Number.parseInt(body.slice(128), 16);
  if (v !== 27 && v !== 28) {
    throw new Error("The input proof signature type is not an ECDSA recovery id.");
  }
  return `0x${body}`;
}
