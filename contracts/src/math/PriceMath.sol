// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title PriceMath
/// @notice Price normalization and dual-quote impact measurement
/// (docs/MATH_SPEC.md section 5). Pure and non-reverting by construction:
/// degenerate inputs are reported as `(ok = false)` so the execution layer
/// can skip instead of revert.
library PriceMath {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    /// @notice tokenOut per one whole tokenIn, normalized to 18 decimals:
    /// `(amountOut * 10^(18 - decimalsOut) * 1e18) / (amountIn * 10^(18 - decimalsIn))`.
    /// Both the probe and the execution quote go through this identical
    /// formula with identical rounding, so their difference measures the
    /// market, not the arithmetic.
    /// @return ok false on a degenerate input (zero amountIn, or a scaled
    /// amount outside uint256) — the caller skips instead of reverting.
    function tryNormalizePrice(
        uint256 amountOut,
        uint8 decimalsOut,
        uint256 amountIn,
        uint8 decimalsIn
    ) internal pure returns (bool ok, uint256 price) {
        if (amountIn == 0 || amountOut == 0) return (false, 0);
        uint256 scaleOut = 10 ** (18 - decimalsOut);
        uint256 scaleIn = 10 ** (18 - decimalsIn);
        // Checked scaling: products are bounded before they happen.
        if (amountOut > type(uint256).max / scaleOut) return (false, 0);
        if (amountIn > type(uint256).max / scaleIn) return (false, 0);
        price = Math.mulDiv(amountOut * scaleOut, WAD, amountIn * scaleIn);
        return (true, price);
    }

    /// @notice Price impact of a fill in basis points, rounded UP — at the
    /// comparison boundary ambiguity resolves in the user's favor (a
    /// borderline fill skips rather than accepts). A favorable execution
    /// price (>= reference) has zero impact.
    /// @dev `referencePrice` must be non-zero (guaranteed by the caller,
    /// which skips degenerate quotes before measuring).
    function priceImpactBps(uint256 referencePrice, uint256 executionPrice) internal pure returns (uint256) {
        if (executionPrice >= referencePrice) return 0;
        return Math.mulDiv(referencePrice - executionPrice, BPS_DENOMINATOR, referencePrice, Math.Rounding.Ceil);
    }
}
