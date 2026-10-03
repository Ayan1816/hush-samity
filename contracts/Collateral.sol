// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Collateral
/// @notice Holds one ERC-20 lock per member for a samity.
/// @dev The samity is the deployer. Members approve this contract, not the samity.
///      `transferFrom` pulls the lock. Refunds go back to the member. Slashes are a
///      real transfer to the samity, which accounts them for the creator sweep.
///      Every movement must change this contract's balance by exactly the accounted
///      amount. A fee-on-transfer token cannot leave an internal balance that the
///      tokens on hand do not back. No ciphertext and no mock.
contract Collateral is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error ZeroAddress();
    error ZeroAmount();
    error NotSamity(address account);
    error AlreadyLocked(address account);
    error NotLocked(address account);
    error Shortfall(address account, uint256 expected, uint256 actual);
    error EtherNotAccepted();

    IERC20 public immutable token;

    /// @notice Configured lock. Set once. The same amount for every member.
    uint256 public immutable amount;

    /// @notice The samity that deployed this contract. The only caller.
    address public immutable samity;

    mapping(address account => uint256 amount) public locked;

    /// @notice Sum of `locked`. Must stay equal to the tokens this contract holds
    ///         when every transfer is exact.
    uint256 public totalLocked;

    event Locked(address indexed account, uint256 amount);
    event Refunded(address indexed account, uint256 amount);
    event Slashed(address indexed account, address indexed to, uint256 amount);

    constructor(IERC20 token_, uint256 amount_) {
        if (address(token_) == address(0)) revert ZeroAddress();
        if (amount_ == 0) revert ZeroAmount();
        token = token_;
        amount = amount_;
        samity = msg.sender;
    }

    receive() external payable {
        revert EtherNotAccepted();
    }

    /// @notice Pull `amount` from `account`. `account` must have approved this contract.
    function lock(address account) external onlySamity nonReentrant {
        if (account == address(0)) revert ZeroAddress();
        if (locked[account] != 0) revert AlreadyLocked(account);

        uint256 beforeBal = token.balanceOf(address(this));
        token.safeTransferFrom(account, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - beforeBal;
        if (received != amount) revert Shortfall(account, amount, received);

        locked[account] = received;
        totalLocked += received;
        emit Locked(account, received);
    }

    /// @notice Return the lock to the member who posted it.
    function refund(address account) external onlySamity nonReentrant {
        uint256 held = locked[account];
        if (held == 0) revert NotLocked(account);

        locked[account] = 0;
        totalLocked -= held;
        _send(account, held);
        emit Refunded(account, held);
    }

    /// @notice Send the lock to the samity. The member's seat is cleared here.
    ///         The samity decides that the member is out.
    function slash(address account) external onlySamity nonReentrant {
        uint256 held = locked[account];
        if (held == 0) revert NotLocked(account);

        locked[account] = 0;
        totalLocked -= held;
        _send(samity, held);
        emit Slashed(account, samity, held);
    }

    function _send(address to, uint256 value) internal {
        uint256 beforeBal = token.balanceOf(address(this));
        token.safeTransfer(to, value);
        uint256 sent = beforeBal - token.balanceOf(address(this));
        if (sent != value) revert Shortfall(to, value, sent);
    }

    modifier onlySamity() {
        if (msg.sender != samity) revert NotSamity(msg.sender);
        _;
    }
}
