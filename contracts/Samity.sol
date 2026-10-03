// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BidEngine} from "./BidEngine.sol";
import {Collateral} from "./Collateral.sol";
import {RevealVerifier} from "./RevealVerifier.sol";

/// @title Samity
/// @notice One confidential ROSCA: membership, the cycle clock, public installments,
///         and the ERC-20 movements that follow a verified reveal.
/// @dev Deployed with the rules a factory will later pass in. The max discount cap is
///      an immutable `uint32` in basis points, at most `10_000`, and there is no setter.
///      This contract deploys its own `BidEngine`, `Collateral`, and `RevealVerifier`.
///
///      Bids are not submitted here. `encryptInputs` binds the contract that calls
///      `FHE.asEuint32`, which is `BidEngine`. The member calls `BidEngine.submitBid`
///      directly. `canBid` is the plaintext gate.
///
///      Collateral is approved to `collateral`, then locked. The installment is
///      approved to this contract. Both transfers must be exact.
///
///      The clock starts at deployment. Cycle 1 is the only cycle that accepts new
///      members, and only until `cycleDeadline`. A later cycle starts when the previous
///      one is settled, so a slow reveal does not instantly slash the next round.
///      Payers lock again each cycle because a paid lock is refunded at settlement.
contract Samity is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BASIS_POINTS = 10_000;

    enum Phase {
        Bidding,
        AwaitingReveal,
        Complete
    }

    struct CycleResult {
        bool settled;
        bool hadBids;
        address winner;
        uint32 discountBps;
        uint256 dividend;
        uint256 winnerPayout;
        uint256 retained;
    }

    struct RosterSnap {
        address account;
        bool paid;
        bool locked;
        bool newlySlashed;
    }

    error ZeroAddress();
    error ZeroAmount();
    error CountIsZero();
    error CapAboveMax(uint32 cap);
    error BadDuration(uint256 duration);
    error JoinClosed();
    error AlreadyJoined(address account);
    error MemberCapReached(uint256 cap);
    error WindowClosed(uint256 deadline);
    error WindowOpen(uint256 deadline);
    error WrongPhase(Phase current);
    error NotEligible(address account);
    error AlreadyLocked(address account);
    error CollateralRequired(address account);
    error AlreadyPaid(address account);
    error Shortfall(address account, uint256 expected, uint256 actual);
    error NotVerifier(address account);
    error DiscountAboveCap(uint32 discountBps);
    error InvalidWinner(address winner);
    error NotCreator(address account);
    error NothingToSweep();
    error AccountingMismatch(uint256 accounted, uint256 balance);
    error LockFlagMismatch(address account);
    error EtherNotAccepted();

    IERC20 public immutable token;
    uint256 public immutable installmentAmount;
    uint256 public immutable collateralAmount;
    uint256 public immutable memberCap;
    uint256 public immutable cycleDuration;
    uint256 public immutable totalCycles;

    /// @notice Creator cap in basis points. Fixed. Cannot be raised.
    uint32 public immutable maxDiscountCap;

    /// @notice Receives the creator sweep. Not `msg.sender`, so a factory can pass the user.
    address public immutable creator;

    BidEngine public immutable bidEngine;
    Collateral public immutable collateral;
    RevealVerifier public immutable revealVerifier;

    Phase public phase;
    uint256 public currentCycle;
    uint256 public cycleOpenedAt;
    uint256 public collectedPot;
    uint256 public sweepable;

    mapping(address account => bool) public isMember;
    mapping(address account => bool) public hasWon;
    mapping(address account => bool) public slashed;
    mapping(address account => bool) public hasPaid;
    mapping(address account => bool) public hasLocked;
    mapping(uint256 cycle => CycleResult) public cycleResults;

    address[] private _members;
    bytes32 private _pendingDiscount;
    bytes32 private _pendingBidder;

    event Joined(address indexed account, uint256 index);
    event CollateralLocked(address indexed account, uint256 indexed cycle);
    event InstallmentPaid(address indexed account, uint256 indexed cycle, uint256 amount);
    event CycleClosed(uint256 indexed cycle, bool hadBids);
    event CycleOpened(uint256 indexed cycle, uint256 openedAt);
    event CycleSettled(
        uint256 indexed cycle,
        address indexed winner,
        uint32 discountBps,
        uint256 dividend,
        uint256 winnerPayout,
        uint256 retained
    );
    event MemberSlashed(address indexed account, uint256 indexed cycle, uint256 amount);
    event SamityComplete(uint256 indexed cycle);
    event Swept(address indexed to, uint256 amount);

    constructor(
        address creator_,
        IERC20 token_,
        uint256 installmentAmount_,
        uint256 collateralAmount_,
        uint256 memberCap_,
        uint256 cycleDuration_,
        uint256 totalCycles_,
        uint32 maxDiscountCap_
    ) {
        if (creator_ == address(0) || address(token_) == address(0)) revert ZeroAddress();
        if (installmentAmount_ == 0 || collateralAmount_ == 0) revert ZeroAmount();
        if (memberCap_ == 0 || totalCycles_ == 0) revert CountIsZero();
        if (cycleDuration_ == 0 || cycleDuration_ > type(uint256).max - block.timestamp) {
            revert BadDuration(cycleDuration_);
        }
        if (maxDiscountCap_ > BASIS_POINTS) revert CapAboveMax(maxDiscountCap_);

        creator = creator_;
        token = token_;
        installmentAmount = installmentAmount_;
        collateralAmount = collateralAmount_;
        memberCap = memberCap_;
        cycleDuration = cycleDuration_;
        totalCycles = totalCycles_;
        maxDiscountCap = maxDiscountCap_;

        bidEngine = new BidEngine(maxDiscountCap_);
        bidEngine.bindSamity();
        collateral = new Collateral(token_, collateralAmount_);
        revealVerifier = new RevealVerifier();

        currentCycle = 1;
        phase = Phase.Bidding;
        cycleOpenedAt = block.timestamp;
        emit CycleOpened(1, block.timestamp);
    }

    receive() external payable {
        revert EtherNotAccepted();
    }

    /// @notice Join during cycle 1. Locks collateral in the same call.
    /// @dev Approve `collateral` for `collateralAmount` first. Join order is the tie order.
    function join() external nonReentrant {
        if (currentCycle != 1 || phase != Phase.Bidding) revert JoinClosed();
        uint256 deadline = cycleOpenedAt + cycleDuration;
        if (block.timestamp >= deadline) revert WindowClosed(deadline);
        if (isMember[msg.sender]) revert AlreadyJoined(msg.sender);
        if (_members.length >= memberCap) revert MemberCapReached(memberCap);

        uint256 index = _members.length;
        _members.push(msg.sender);
        isMember[msg.sender] = true;
        hasLocked[msg.sender] = true;

        bidEngine.joinFor(msg.sender);
        collateral.lock(msg.sender);

        emit Joined(msg.sender, index);
        emit CollateralLocked(msg.sender, currentCycle);
    }

    /// @notice Lock collateral again after a refund. Required before the next installment.
    /// @dev A slashed member is out. A member who already won still locks, because they
    ///      still owe later installments.
    function lockCollateral() external nonReentrant {
        if (phase != Phase.Bidding) revert WrongPhase(phase);
        uint256 deadline = cycleOpenedAt + cycleDuration;
        if (block.timestamp >= deadline) revert WindowClosed(deadline);
        if (!isMember[msg.sender] || slashed[msg.sender]) revert NotEligible(msg.sender);
        if (hasLocked[msg.sender]) revert AlreadyLocked(msg.sender);

        hasLocked[msg.sender] = true;
        collateral.lock(msg.sender);
        emit CollateralLocked(msg.sender, currentCycle);
    }

    /// @notice Pay this cycle's public installment into the pot.
    /// @dev Approve this samity for `installmentAmount`. The pot increases by the tokens
    ///      actually received, which must equal the configured amount. Winners pay too.
    function payInstallment() external nonReentrant {
        if (phase != Phase.Bidding) revert WrongPhase(phase);
        uint256 deadline = cycleOpenedAt + cycleDuration;
        if (block.timestamp >= deadline) revert WindowClosed(deadline);
        if (!isMember[msg.sender] || slashed[msg.sender]) revert NotEligible(msg.sender);
        if (!hasLocked[msg.sender]) revert CollateralRequired(msg.sender);
        if (hasPaid[msg.sender]) revert AlreadyPaid(msg.sender);

        uint256 beforeBal = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), installmentAmount);
        uint256 received = token.balanceOf(address(this)) - beforeBal;
        if (received != installmentAmount) revert Shortfall(msg.sender, installmentAmount, received);

        hasPaid[msg.sender] = true;
        collectedPot += received;
        emit InstallmentPaid(msg.sender, currentCycle, received);
    }

    /// @notice Whether `account` may call `BidEngine.submitBid` right now.
    /// @dev Plaintext. It does not reveal an amount. `BidEngine` calls this under
    ///      `STATICCALL` when a samity is bound.
    function canBid(address account) external view returns (bool) {
        return phase == Phase.Bidding
            && block.timestamp < cycleOpenedAt + cycleDuration
            && isMember[account]
            && !slashed[account]
            && !hasWon[account]
            && hasPaid[account]
            && hasLocked[account];
    }

    /// @notice Close the bidding window. Anyone may call it once the deadline has passed.
    /// @dev No bids: settle immediately. Do not `allowPublic` an empty book.
    ///      At least one bid: `BidEngine` makes the two leader handles public and this
    ///      contract stores them. Tokens wait for `RevealVerifier.finalize`.
    function closeCycle() external nonReentrant {
        if (phase != Phase.Bidding) revert WrongPhase(phase);
        uint256 deadline = cycleOpenedAt + cycleDuration;
        if (block.timestamp < deadline) revert WindowOpen(deadline);

        uint256 cycle = currentCycle;
        if (bidEngine.submittedCount() == 0) {
            emit CycleClosed(cycle, false);
            _settle(address(0), 0, false);
        } else {
            (bytes32 discount, bytes32 bidder) = bidEngine.prepareReveal();
            _pendingDiscount = discount;
            _pendingBidder = bidder;
            phase = Phase.AwaitingReveal;
            emit CycleClosed(cycle, true);
        }
    }

    /// @notice Handles snapshotted at close. Both are already `allowPublic`.
    /// @dev Reverts outside the reveal phase so the leader handle is not handed out early.
    function pendingReveal() external view returns (bytes32 discount, bytes32 winner) {
        if (phase != Phase.AwaitingReveal) revert WrongPhase(phase);
        return (_pendingDiscount, _pendingBidder);
    }

    /// @notice Pay the verified round. Only the verifier deployed with this samity.
    /// @dev `winner == address(0)` means the ciphertext decrypted to nobody. The pot is
    ///      retained. A discount of `0` with a real member is a win of the whole pot,
    ///      not the empty case. Division runs here, on these plaintext numbers, after
    ///      `FHE.verifyDecryptResult` has already succeeded in the verifier.
    function settle(uint32 discountBps, address winner) external nonReentrant {
        if (msg.sender != address(revealVerifier)) revert NotVerifier(msg.sender);
        if (phase != Phase.AwaitingReveal) revert WrongPhase(phase);
        if (discountBps > maxDiscountCap) revert DiscountAboveCap(discountBps);
        if (winner != address(0)) {
            if (!isMember[winner] || slashed[winner] || !hasPaid[winner] || hasWon[winner]) {
                revert InvalidWinner(winner);
            }
        }
        _settle(winner, discountBps, true);
    }

    /// @notice Creator withdraws slashed collateral, rounding dust, and undistributed pots.
    /// @dev Does not touch `collectedPot` or the locks held by `Collateral`.
    function sweep(address to) external nonReentrant {
        if (msg.sender != creator) revert NotCreator(msg.sender);
        if (to == address(0) || to == address(this)) revert ZeroAddress();
        uint256 amount = sweepable;
        if (amount == 0) revert NothingToSweep();
        sweepable = 0;
        _send(to, amount);
        emit Swept(to, amount);
    }

    function memberCount() external view returns (uint256) {
        return _members.length;
    }

    function memberAt(uint256 index) external view returns (address) {
        return _members[index];
    }

    /// @notice First timestamp at which the current window is closed. Equal to the open time
    ///         plus `cycleDuration`.
    function cycleDeadline() external view returns (uint256) {
        return cycleOpenedAt + cycleDuration;
    }

    function _settle(address winner, uint32 discountBps, bool hadBids) internal {
        (uint256 dividend, uint256 payout, uint256 share, uint256 retained) = _quote(winner, discountBps);

        uint256 cycle = currentCycle;
        RosterSnap[] memory snap = _roster();
        uint256 n = snap.length;

        if (winner != address(0)) hasWon[winner] = true;
        collectedPot = 0;
        sweepable += retained;
        delete _pendingDiscount;
        delete _pendingBidder;

        CycleResult storage result = cycleResults[cycle];
        result.settled = true;
        result.hadBids = hadBids;
        result.winner = winner;
        result.discountBps = discountBps;
        result.dividend = dividend;
        result.winnerPayout = payout;
        result.retained = retained;

        bidEngine.resetForNextCycle();
        _openNext(cycle);

        _send(winner, payout);
        if (share != 0) {
            for (uint256 i = 0; i < n; ++i) {
                if (snap[i].paid && snap[i].account != winner) _send(snap[i].account, share);
            }
        }
        _settleCollateral(snap, cycle);

        uint256 accounted = sweepable + collectedPot;
        uint256 balance = token.balanceOf(address(this));
        if (balance < accounted) revert AccountingMismatch(accounted, balance);

        emit CycleSettled(cycle, winner, discountBps, dividend, payout, retained);
    }

    /// @dev Captures payers before clearing them. The lock bit has to match the tokens
    ///      `Collateral` still holds, or settlement would refund a seat that has no tokens
    ///      or leave a lock behind.
    function _roster() internal returns (RosterSnap[] memory snap) {
        uint256 n = _members.length;
        snap = new RosterSnap[](n);
        for (uint256 i = 0; i < n; ++i) {
            address account = _members[i];
            snap[i].account = account;
            if (slashed[account]) continue;

            bool paid = hasPaid[account];
            bool locked = collateral.locked(account) != 0;
            if (locked != hasLocked[account]) revert LockFlagMismatch(account);

            hasPaid[account] = false;
            hasLocked[account] = false;
            snap[i].paid = paid;
            snap[i].locked = locked;
            if (!paid) {
                slashed[account] = true;
                snap[i].newlySlashed = true;
            }
        }
    }

    function _quote(address winner, uint32 discountBps)
        internal
        view
        returns (uint256 dividend, uint256 payout, uint256 share, uint256 retained)
    {
        uint256 pot = collectedPot;
        if (winner == address(0)) {
            return (0, 0, 0, pot);
        }

        dividend = _bpsOf(pot, discountBps);
        payout = pot - dividend;
        uint256 sharers = _payerCount(winner);
        if (sharers == 0) {
            retained = dividend;
        } else {
            share = dividend / sharers;
            retained = dividend - (share * sharers);
        }

        uint256 distributed = payout + (share * sharers) + retained;
        if (distributed != pot) revert AccountingMismatch(distributed, pot);
    }

    function _payerCount(address except) internal view returns (uint256 count) {
        uint256 n = _members.length;
        for (uint256 i = 0; i < n; ++i) {
            address account = _members[i];
            if (account != except && hasPaid[account]) ++count;
        }
    }

    /// @dev `bps <= 10_000`, so neither product exceeds `pot`.
    function _bpsOf(uint256 pot, uint32 bps) internal pure returns (uint256) {
        uint256 rate = uint256(bps);
        return (pot / BASIS_POINTS) * rate + ((pot % BASIS_POINTS) * rate) / BASIS_POINTS;
    }

    function _openNext(uint256 finished) internal {
        if (finished == totalCycles) {
            phase = Phase.Complete;
            emit SamityComplete(finished);
            return;
        }
        uint256 next = finished + 1;
        currentCycle = next;
        cycleOpenedAt = block.timestamp;
        phase = Phase.Bidding;
        emit CycleOpened(next, block.timestamp);
    }

    function _settleCollateral(RosterSnap[] memory snap, uint256 cycle) internal {
        uint256 n = snap.length;
        for (uint256 i = 0; i < n; ++i) {
            if (!snap[i].locked) {
                if (snap[i].newlySlashed) emit MemberSlashed(snap[i].account, cycle, 0);
                continue;
            }
            if (snap[i].paid) {
                collateral.refund(snap[i].account);
                continue;
            }
            uint256 beforeBal = token.balanceOf(address(this));
            collateral.slash(snap[i].account);
            uint256 received = token.balanceOf(address(this)) - beforeBal;
            sweepable += received;
            emit MemberSlashed(snap[i].account, cycle, received);
        }
    }

    function _send(address to, uint256 value) internal {
        if (value == 0) return;
        if (to == address(0)) revert ZeroAddress();
        uint256 beforeBal = token.balanceOf(address(this));
        token.safeTransfer(to, value);
        uint256 sent = beforeBal - token.balanceOf(address(this));
        if (sent != value) revert Shortfall(to, value, sent);
    }
}
