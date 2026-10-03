// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FHE, euint32, eaddress} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @notice What Samity exposes to the verifier. Handles are raw `bytes32` so this
///         call does not pass a bare `euint32` in for computation.
interface ISamityReveal {
    function pendingReveal() external view returns (bytes32 discount, bytes32 winner);
    function settle(uint32 discountBps, address winner) external;
}

/// @title RevealVerifier
/// @notice Checks a `decryptForTx(...).withoutACP()` result and then settles the round.
/// @dev `FHE.verifyDecryptResult` reverts on a bad Teecryptor signature. The bool is
///      still required, so a `false` return cannot move tokens. Publish runs only
///      after both signatures verify, and only for the two handles Samity snapshotted
///      at close. Those are the winning discount and the winning `eaddress`.
///      This contract never calls `allowPublic` and never sees a losing bid.
///      The samity is the deployer.
contract RevealVerifier {
    error NothingToReveal();
    error InvalidSignature();

    ISamityReveal public immutable samity;

    event RoundFinalized(uint32 discountBps, address indexed winner);

    constructor() {
        samity = ISamityReveal(msg.sender);
    }

    /// @notice Verify both decrypt results, publish them, and settle the open round.
    /// @param discountBps Plaintext from `decryptForTx` on the winning discount handle.
    ///        Basis points, not token wei.
    /// @param discountSignature Signature bundled with that decrypt result.
    /// @param winner Plaintext from `decryptForTx` on the winning `eaddress` handle.
    ///        `address(0)` is a real outcome: nobody cleared the cap. It is not a skipped check.
    /// @param winnerSignature Signature bundled with that decrypt result.
    /// @dev The caller does not choose the ciphertext. The handles are the ones `BidEngine`
    ///      made public at close. A signature over any other handle fails verification.
    function finalize(
        uint32 discountBps,
        bytes calldata discountSignature,
        address winner,
        bytes calldata winnerSignature
    ) external {
        (bytes32 discountHandle, bytes32 winnerHandle) = samity.pendingReveal();
        euint32 discountCt = FHE.wrapEuint32(discountHandle);
        eaddress winnerCt = FHE.wrapEaddress(winnerHandle);
        if (!FHE.isInitialized(discountCt) || !FHE.isInitialized(winnerCt)) revert NothingToReveal();

        // View check. A bad signature reverts inside the task manager. A false
        // return is rejected here as well, before any publish or token movement.
        if (!FHE.verifyDecryptResult(discountCt, discountBps, discountSignature)) revert InvalidSignature();
        if (!FHE.verifyDecryptResult(winnerCt, winner, winnerSignature)) revert InvalidSignature();

        FHE.publishDecryptResult(discountCt, discountBps, discountSignature);
        FHE.publishDecryptResult(winnerCt, winner, winnerSignature);

        samity.settle(discountBps, winner);
        emit RoundFinalized(discountBps, winner);
    }
}
