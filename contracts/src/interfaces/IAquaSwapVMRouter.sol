// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev Minimal taker surface of the official 1inch AquaSwapVMRouter
/// (pinned tag `v1.0.2`). Authored by Slope; the four-byte selectors must
/// match the deployed router (asserted by InterfaceSelectorsTest):
/// swap = 0xf4d2d412, quote = 0x44aa5f14.
/// The maker-side `Order` tuple and the opaque `takerTraitsAndData` blob are
/// passed through untouched, so the step-3 milestone replaces the test mocks
/// with the deployed router without reshaping `SlopePosition`.
interface IAquaSwapVMRouter {
    struct Order {
        address maker;
        uint256 traits;
        bytes data;
    }

    function quote(
        Order calldata order,
        address tokenIn,
        address tokenOut,
        uint256 amount,
        bytes calldata takerTraitsAndData
    ) external returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash);

    function swap(
        Order calldata order,
        address tokenIn,
        address tokenOut,
        uint256 amount,
        bytes calldata takerTraitsAndData
    ) external returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash);
}
