// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {CurveMath} from "@/math/CurveMath.sol";
import {CurveShape} from "@/SlopeTypes.sol";

/// @dev External wrapper for revert interception in tests.
contract ProgressCaller {
    function callProgress(uint256 elapsed, uint256 duration, CurveShape shape) external pure returns (uint256) {
        return CurveMath.progress(elapsed, duration, shape);
    }
}

contract CurveMathTest is Test {
    uint256 internal constant WAD = 1e18;

    /// @dev External surface so `vm.expectRevert` can intercept reverts of
    /// the internal library function (expectRevert only sees sub-calls).
    ProgressCaller internal caller;

    function setUp() external {
        caller = new ProgressCaller();
    }

    function test_ProgressIsZeroAtZeroElapsed() external pure {
        assertEq(CurveMath.progress(0, 1000, CurveShape.NEUTRAL), 0);
        assertEq(CurveMath.progress(0, 86400, CurveShape.NEUTRAL), 0);
    }

    function test_ProgressIsExactlyOneAtDuration() external pure {
        // Zero rounding error by construction: the boundary is a hard
        // MATH_SPEC obligation for every shape.
        assertEq(CurveMath.progress(1000, 1000, CurveShape.NEUTRAL), 1e18);
        assertEq(CurveMath.progress(86400, 86400, CurveShape.NEUTRAL), 1e18);
        assertEq(CurveMath.progress(type(uint256).max / 1e18, type(uint256).max / 1e18, CurveShape.NEUTRAL), 1e18);
    }

    function test_ProgressIsTheExactLinearTwap() external pure {
        assertEq(CurveMath.progress(500, 1000, CurveShape.NEUTRAL), 5e17);
        assertEq(CurveMath.progress(7, 1000, CurveShape.NEUTRAL), 7e15);
    }

    function test_ProgressFloorsNeverOverAuthorizes() external pure {
        assertEq(CurveMath.progress(333, 1000, CurveShape.NEUTRAL), 333000000000000000);
        assertEq(CurveMath.progress(1, 3, CurveShape.NEUTRAL), 333333333333333333);
    }

    function test_ProgressRevertsPastDuration() external {
        vm.expectRevert(CurveMath.ElapsedExceedsDuration.selector);
        caller.callProgress(1001, 1000, CurveShape.NEUTRAL);
    }

    function testFuzz_ProgressIsMonotonicAndBounded(uint128 e1Raw, uint128 e2Raw, uint128 durationRaw) external pure {
        uint256 duration = bound(uint256(durationRaw), 1, type(uint128).max);
        uint256 e1 = bound(uint256(e1Raw), 0, duration);
        uint256 e2 = bound(uint256(e2Raw), e1, duration);
        uint256 p1 = CurveMath.progress(e1, duration, CurveShape.NEUTRAL);
        uint256 p2 = CurveMath.progress(e2, duration, CurveShape.NEUTRAL);
        assertLe(p1, p2);
        assertGe(p2, 0);
        assertLe(p2, WAD);
    }

    function testFuzz_ProgressFloorsAgainstTheRealSchedule(uint128 elapsedRaw, uint128 durationRaw) external pure {
        uint256 duration = bound(uint256(durationRaw), 1, type(uint128).max);
        uint256 elapsed = bound(uint256(elapsedRaw), 0, duration);
        uint256 p = CurveMath.progress(elapsed, duration, CurveShape.NEUTRAL);
        // Floor semantics: progress * duration <= elapsed * 1e18 (bounded
        // here so the assertion's own multiplication cannot overflow).
        assertLe(p * duration, uint256(elapsed) * 1e18);
    }

    // ------------------------------------------------------------------
    // AGGRESSIVE and CONSERVATIVE (step-2 milestone)
    // ------------------------------------------------------------------

    function test_Boundaries_Aggressive() external pure {
        assertEq(CurveMath.progress(0, 1000, CurveShape.AGGRESSIVE), 0);
        // Zero rounding error at the boundary is a hard MATH_SPEC obligation.
        assertEq(CurveMath.progress(1000, 1000, CurveShape.AGGRESSIVE), 1e18);
        assertEq(CurveMath.progress(86400, 86400, CurveShape.AGGRESSIVE), 1e18);
    }

    function test_Boundaries_Conservative() external pure {
        assertEq(CurveMath.progress(0, 1000, CurveShape.CONSERVATIVE), 0);
        assertEq(CurveMath.progress(1000, 1000, CurveShape.CONSERVATIVE), 1e18);
        assertEq(CurveMath.progress(86400, 86400, CurveShape.CONSERVATIVE), 1e18);
    }

    function test_MidpointShapes_AggressiveAboveNeutralAboveConservative() external pure {
        // The whole product claim rests on the curves being ordered the way
        // their names say: front-loaded > linear > back-loaded. AGGRESSIVE
        // is asserted exactly: floor(sqrt(0.5e18 * 1e18)) = 707106781186547524.
        uint256 neutral = CurveMath.progress(500, 1000, CurveShape.NEUTRAL);
        uint256 aggressive = CurveMath.progress(500, 1000, CurveShape.AGGRESSIVE);
        uint256 conservative = CurveMath.progress(500, 1000, CurveShape.CONSERVATIVE);
        assertEq(neutral, 5e17);
        assertEq(conservative, 25e16); // exact: (0.5e18)^2 / 1e18
        assertEq(aggressive, 707106781186547524); // exact: floor(sqrt(5e35))
        assertGt(aggressive, neutral);
        assertGt(neutral, conservative);
    }

    function testFuzz_AggressiveIsMonotonicAndBounded(uint128 e1Raw, uint128 e2Raw, uint128 durationRaw) external pure {
        uint256 duration = bound(uint256(durationRaw), 1, type(uint128).max);
        uint256 e1 = bound(uint256(e1Raw), 0, duration);
        uint256 e2 = bound(uint256(e2Raw), e1, duration);
        uint256 p1 = CurveMath.progress(e1, duration, CurveShape.AGGRESSIVE);
        uint256 p2 = CurveMath.progress(e2, duration, CurveShape.AGGRESSIVE);
        assertLe(p1, p2);
        assertLe(p2, WAD);
    }

    function testFuzz_ConservativeIsMonotonicAndBounded(uint128 e1Raw, uint128 e2Raw, uint128 durationRaw) external pure {
        uint256 duration = bound(uint256(durationRaw), 1, type(uint128).max);
        uint256 e1 = bound(uint256(e1Raw), 0, duration);
        uint256 e2 = bound(uint256(e2Raw), e1, duration);
        uint256 p1 = CurveMath.progress(e1, duration, CurveShape.CONSERVATIVE);
        uint256 p2 = CurveMath.progress(e2, duration, CurveShape.CONSERVATIVE);
        assertLe(p1, p2);
        assertLe(p2, WAD);
    }

    function testFuzz_AggressiveSqrtFloorNeverOverAuthorizes(uint128 elapsedRaw, uint128 durationRaw) external pure {
        uint256 duration = bound(uint256(durationRaw), 1, type(uint128).max);
        uint256 elapsed = bound(uint256(elapsedRaw), 0, duration);
        uint256 r = Math.mulDiv(elapsed, 1e18, duration);
        uint256 p = CurveMath.progress(elapsed, duration, CurveShape.AGGRESSIVE);
        // Floor sqrt: p^2 <= r * 1e18 (bounded: p, r <= 1e18 -> p^2 <= 1e36).
        assertLe(p * p, r * 1e18);
    }

    function testFuzz_ConservativeNeverExceedsLinearFraction(uint128 elapsedRaw, uint128 durationRaw) external pure {
        uint256 duration = bound(uint256(durationRaw), 1, type(uint128).max);
        uint256 elapsed = bound(uint256(elapsedRaw), 0, duration);
        uint256 r = Math.mulDiv(elapsed, 1e18, duration);
        uint256 p = CurveMath.progress(elapsed, duration, CurveShape.CONSERVATIVE);
        // r <= 1e18 implies r^2/1e18 <= r: the back-loaded curve never
        // runs ahead of the linear schedule.
        assertLe(p, r);
    }
}
