// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {CurveShape} from "@/SlopeTypes.sol";

/// @title CurveMath
/// @notice The execution schedule kernel (docs/MATH_SPEC.md section 3).
/// Pure, storage-free, and rounding-exact at both window boundaries.
/// @dev Shapes (SPEC section 4): NEUTRAL = exact linear TWAP; AGGRESSIVE =
/// (t/d)^(1/2) via the pinned, battle-tested OpenZeppelin floor sqrt —
/// never a hand-rolled power; CONSERVATIVE = (t/d)^2 via plain
/// multiplication.
library CurveMath {
    error ElapsedExceedsDuration();
    error UnsupportedShape();

    uint256 internal constant WAD = 1e18;

    /// @notice Fraction of the budget authorized at `elapsed`, in WAD
    /// (1e18 = 100%). Boundary conditions are exact for every shape:
    /// `progress(0) = 0` and `progress(duration) = 1e18` with zero rounding
    /// error (MATH_SPEC section 3, hard test obligation).
    /// @dev Preconditions: `duration > 0` (enforced at creation) and
    /// `elapsed <= duration` (enforced by the caller, which clamps the
    /// schedule input at the window edge).
    function progress(uint256 elapsed, uint256 duration, CurveShape shape) internal pure returns (uint256) {
        if (elapsed > duration) revert ElapsedExceedsDuration();
        if (elapsed == 0) return 0;
        if (elapsed == duration) return WAD;
        // r is the WAD window fraction; floored, hence never over-authorizes.
        uint256 r = Math.mulDiv(elapsed, WAD, duration);
        if (shape == CurveShape.NEUTRAL) {
            return r;
        }
        if (shape == CurveShape.AGGRESSIVE) {
            // WAD square root of the WAD fraction: floor(sqrt(r * 1e18)).
            // r <= 1e18 by construction, so r * WAD <= 1e36 cannot overflow.
            return Math.sqrt(r * WAD);
        }
        if (shape == CurveShape.CONSERVATIVE) {
            return Math.mulDiv(r, r, WAD);
        }
        // Honest failure mode if a fourth CurveShape member is ever added
        // without a branch here: never report a false duration problem.
        revert UnsupportedShape();
    }
}
