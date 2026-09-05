// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {CurveShape} from "@/SlopeTypes.sol";

/// @title CurveMath
/// @notice The execution schedule kernel (docs/MATH_SPEC.md section 3).
/// Pure, storage-free, and rounding-exact at both window boundaries.
/// @dev Step-1 milestone implements NEUTRAL only; AGGRESSIVE (floor sqrt)
/// and CONSERVATIVE (floor square) land in the step-2 milestone.
library CurveMath {
    error ElapsedExceedsDuration();
    error UnsupportedShape();

    uint256 internal constant WAD = 1e18;

    /// @notice Fraction of the budget authorized at `elapsed`, in WAD
    /// (1e18 = 100%). NEUTRAL is the exact linear TWAP:
    /// `elapsed * 1e18 / duration`, floored.
    /// @dev Preconditions: `duration > 0` (enforced at creation) and
    /// `elapsed <= duration` (enforced by the caller: calls past the window
    /// are refused as expired; at `elapsed == duration` the terminal clamp
    /// in SlopePosition authorizes the exact remainder directly).
    function progress(uint256 elapsed, uint256 duration, CurveShape shape) internal pure returns (uint256) {
        if (elapsed > duration) revert ElapsedExceedsDuration();
        if (elapsed == 0) return 0;
        if (elapsed == duration) return WAD;
        if (shape == CurveShape.NEUTRAL) {
            // Full-precision product: never overflows, never over-authorizes.
            return Math.mulDiv(elapsed, WAD, duration);
        }
        revert UnsupportedShape();
    }
}
