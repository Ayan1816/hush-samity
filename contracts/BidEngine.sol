// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FHE, euint32, ebool, eaddress, externalEuint32} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @notice Samity gate. Plaintext only. It must not reveal a bid amount.
interface ISamityBids {
    function canBid(address account) external view returns (bool);
}

/// @title BidEngine
/// @notice One cycle of confidential discount bids.
/// @dev The creator's cap is fixed in the constructor. Basis points, `10_000` is 100 percent.
///      There is no function that raises it. Losing bids are never publicly permitted.
///      Membership order is recorded here because a tie must go to the earlier-joined member.
///      Unbound, `join` and `submitBid` stay open so this engine can run by itself.
///      After `bindSamity`, only that samity may add members, open a reveal, or reset.
///      The member still calls `submitBid`. The input proof binds `msg.sender`, so Samity
///      cannot forward the ciphertext. This contract does not move tokens.
contract BidEngine {
    uint32 public constant MAX_DISCOUNT_BPS = 10_000;

    error CapAboveMax(uint32 cap);
    error AlreadyJoined(address account);
    error NotMember(address account);
    error AlreadyBid(address account);
    error NoBid(address account);
    error Unauthorized(address account);
    error SamityAlreadyBound(address samity);
    error BindAfterJoin();
    error NotSamity(address account);
    error ZeroAddress();
    error DirectJoinDisabled();
    error BidNotAllowed(address account);
    error NoBidsToReveal();

    /// @notice Plaintext cap in basis points. Set once. Cannot be raised.
    uint32 public immutable maxDiscountCap;

    /// @notice Bound samity. Zero until `bindSamity`. Immutable after that.
    address public samity;

    /// @dev Deployer may bind once. Samity deploys this engine, so the deployer is the samity.
    address private immutable _deployer;

    address[] private _members;
    mapping(address account => uint256 indexPlusOne) private _joinIndexPlusOne;
    mapping(address account => euint32 bid) private _bids;
    mapping(address account => bool submitted) private _submitted;
    uint256 private _submittedCount;

    euint32 private _bestDiscount;
    eaddress private _bestBidder;
    ebool private _hasLeader;

    event Joined(address indexed account, uint256 index);
    event BidSubmitted(address indexed account);
    event SamityBound(address indexed samity);
    event RevealPrepared(uint256 submittedCount);
    event CycleReset(uint256 members);

    constructor(uint32 maxDiscountCap_) {
        if (maxDiscountCap_ > MAX_DISCOUNT_BPS) revert CapAboveMax(maxDiscountCap_);
        maxDiscountCap = maxDiscountCap_;
        _deployer = msg.sender;
    }

    /// @notice Bind the deploying samity. Once. No members yet. No path raises the cap.
    function bindSamity() external {
        if (samity != address(0)) revert SamityAlreadyBound(samity);
        if (msg.sender != _deployer) revert Unauthorized(msg.sender);
        if (_members.length != 0) revert BindAfterJoin();
        samity = msg.sender;
        emit SamityBound(msg.sender);
    }

    /// @notice Join when this engine is not bound to a samity. Index `0` is the earliest member.
    function join() external {
        if (samity != address(0)) revert DirectJoinDisabled();
        _join(msg.sender);
    }

    /// @notice Samity records a member in the same order the samity joined them.
    function joinFor(address account) external {
        if (samity == address(0) || msg.sender != samity) revert NotSamity(msg.sender);
        if (account == address(0)) revert ZeroAddress();
        _join(account);
    }

    /// @notice Store one encrypted discount and fold it into the encrypted leader.
    /// @dev `inputProof` must be the batch signature from `encryptInputs`, and
    ///      `setConsumingContract` must be this engine. The member is `msg.sender`
    ///      because the proof binds the caller. A bound samity must report `canBid`.
    function submitBid(externalEuint32 inBid, bytes calldata inputProof) external {
        if (_joinIndexPlusOne[msg.sender] == 0) revert NotMember(msg.sender);
        if (_submitted[msg.sender]) revert AlreadyBid(msg.sender);
        if (samity != address(0) && !ISamityBids(samity).canBid(msg.sender)) revert BidNotAllowed(msg.sender);

        euint32 bid = FHE.asEuint32(inBid, inputProof);
        // The bidder may decrypt their own bid. Nobody else receives `FHE.allow`.
        // `allowThis` is what lets a later bid fold this ciphertext.
        FHE.allowThis(bid);
        FHE.allow(bid, msg.sender);

        _bids[msg.sender] = bid;
        _submitted[msg.sender] = true;
        _submittedCount += 1;

        _fold();
        emit BidSubmitted(msg.sender);
    }

    function memberCount() external view returns (uint256) {
        return _members.length;
    }

    function memberAt(uint256 index) external view returns (address) {
        return _members[index];
    }

    /// @notice Zero-based join index. Reverts if `account` never joined.
    function joinIndex(address account) external view returns (uint256) {
        uint256 indexPlusOne = _joinIndexPlusOne[account];
        if (indexPlusOne == 0) revert NotMember(account);
        return indexPlusOne - 1;
    }

    function hasSubmitted(address account) external view returns (bool) {
        return _submitted[account];
    }

    function submittedCount() external view returns (uint256) {
        return _submittedCount;
    }

    /// @dev False until the first bid is folded. True does not mean someone won:
    ///      an over-cap bid still records a selection whose encrypted leader is false.
    function leaderRecorded() external view returns (bool) {
        return FHE.isInitialized(_hasLeader);
    }

    function bestDiscount() external view returns (euint32) {
        return _bestDiscount;
    }

    function bestBidder() external view returns (eaddress) {
        return _bestBidder;
    }

    function hasLeader() external view returns (ebool) {
        return _hasLeader;
    }

    /// @notice The caller's own bid handle. Other accounts cannot ask for it.
    function myBid() external view returns (euint32) {
        if (!_submitted[msg.sender]) revert NoBid(msg.sender);
        return _bids[msg.sender];
    }

    /// @notice Make the current leader handles publicly decryptable.
    /// @dev Only the winning discount and the winning `eaddress`. Never a per-member bid,
    ///      and never an uninitialized handle. `hasLeader` stays contract-only: `address(0)`
    ///      is the no-winner signal, including the case where every bid was over the cap.
    /// @return discount Handle to pass to `decryptForTx` without an ACP.
    /// @return bidder Handle of the encrypted winner.
    function prepareReveal() external returns (bytes32 discount, bytes32 bidder) {
        if (msg.sender != samity) revert NotSamity(msg.sender);
        if (_submittedCount == 0 || !FHE.isInitialized(_bestDiscount) || !FHE.isInitialized(_bestBidder)) {
            revert NoBidsToReveal();
        }

        FHE.allowPublic(_bestDiscount);
        FHE.allowPublic(_bestBidder);
        emit RevealPrepared(_submittedCount);
        return (euint32.unwrap(_bestDiscount), eaddress.unwrap(_bestBidder));
    }

    /// @notice Clear this cycle's bids and leader. Join order stays.
    /// @dev Deletes handles. It does not trivial-encrypt a zero, because a trivial handle
    ///      is initialized and would look like a recorded leader. No `allowPublic` here.
    function resetForNextCycle() external {
        if (msg.sender != samity) revert NotSamity(msg.sender);

        uint256 n = _members.length;
        for (uint256 i = 0; i < n; ++i) {
            address member = _members[i];
            // A zero handle, not a trivial encryption of zero. `delete` is rejected on
            // the ciphertext type, and a trivial zero would look initialized.
            _bids[member] = euint32.wrap(bytes32(0));
            _submitted[member] = false;
        }
        _submittedCount = 0;
        _bestDiscount = euint32.wrap(bytes32(0));
        _bestBidder = eaddress.wrap(bytes32(0));
        _hasLeader = ebool.wrap(bytes32(0));
        emit CycleReset(n);
    }

    /// @dev Rescan in join order. `FHE.gt` is strict, so an equal later bid does not
    ///      replace the earlier member. No `if` on an `ebool`.
    function _fold() internal {
        euint32 best = FHE.asEuint32(0);
        eaddress winner = FHE.asEaddress(address(0));
        ebool leader = FHE.asEbool(false);
        euint32 cap = FHE.asEuint32(maxDiscountCap);
        ebool yes = FHE.asEbool(true);

        uint256 n = _members.length;
        for (uint256 i = 0; i < n; ++i) {
            address member = _members[i];
            // Submission is public. The amount is not, so this branch is not on an ebool.
            if (!_submitted[member]) continue;
            (best, winner, leader) = _consider(member, best, winner, leader, cap, yes);
        }

        // New handles do not keep the previous permission. These three stay
        // contract-only. Losing bids are never passed to `allowPublic`.
        FHE.allowThis(best);
        FHE.allowThis(winner);
        FHE.allowThis(leader);

        _bestDiscount = best;
        _bestBidder = winner;
        _hasLeader = leader;
    }

    function _join(address account) internal {
        if (_joinIndexPlusOne[account] != 0) revert AlreadyJoined(account);
        _members.push(account);
        _joinIndexPlusOne[account] = _members.length;
        emit Joined(account, _members.length - 1);
    }

    /// @dev Same comparison as the spec (`lte`, `gt`, `select`). The outer `select`
    ///      is the empty-seat case: a strict `gt` against a zero seat would reject
    ///      a legitimate 0 bps bid, and a cap of 0 would then be unable to seat anyone.
    ///      The address written is `member`, not `msg.sender`, because this fold
    ///      replays earlier bids.
    function _consider(
        address member,
        euint32 best,
        eaddress winner,
        ebool leader,
        euint32 cap,
        ebool yes
    ) internal returns (euint32, eaddress, ebool) {
        euint32 bid = _bids[member];
        ebool withinCap = FHE.lte(bid, cap);
        ebool improves = FHE.and(withinCap, FHE.gt(bid, best));
        ebool replace = FHE.select(leader, improves, withinCap);

        best = FHE.select(replace, bid, best);
        winner = FHE.select(replace, FHE.asEaddress(member), winner);
        leader = FHE.select(replace, yes, leader);
        return (best, winner, leader);
    }
}
