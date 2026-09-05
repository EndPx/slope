// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev Minimal maker/taker surface of the official 1inch Aqua registry
/// (pinned: contracts/lib/aqua-protocol). Authored by Slope; selector- and
/// behavior-compatible with the deterministic Aqua deployments.
interface IAquaRegistry {
    /// @notice Publishes a maker strategy and seeds its virtual balances.
    /// `strategyHash = keccak256(strategy)`; tokens stay in the maker wallet
    /// (virtual balances are commitments, not escrow).
    function ship(address app, bytes calldata strategy, address[] calldata tokens, uint256[] calldata amounts)
        external
        returns (bytes32 strategyHash);

    /// @notice Closes a strategy: all listed tokens must be docked together.
    function dock(address app, bytes32 strategyHash, address[] calldata tokens) external;

    /// @notice Virtual balance read; reverts if the token is not in an
    /// active strategy.
    function safeBalances(address maker, address app, bytes32 strategyHash, address token0, address token1)
        external
        view
        returns (uint256 balance0, uint256 balance1);

    /// @notice Raw virtual balance read; never reverts. `tokensCount == 0`
    /// means never shipped, `0xff` means docked.
    function rawBalances(address maker, address app, bytes32 strategyHash, address token)
        external
        view
        returns (uint248 balance, uint8 tokensCount);

    /// @notice Called by the app (router) at fill time: moves the real token
    /// from the maker's wallet to `to` and decrements the virtual balance.
    function pull(address maker, bytes32 strategyHash, address token, uint256 amount, address to) external;

    /// @notice Called by the app (router) at fill time: credits the maker's
    /// virtual balance with the incoming token.
    function push(address maker, address app, bytes32 strategyHash, address token, uint256 amount) external;
}
