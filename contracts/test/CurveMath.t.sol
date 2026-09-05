// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {CurveMath} from "src/math/CurveMath.sol";
import {CurveShape} from "src/SlopeTypes.sol";

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

    function test_UnsupportedShapeRevertsUntilStepTwo() external {
        vm.expectRevert(CurveMath.UnsupportedShape.selector);
        caller.callProgress(500, 1000, CurveShape.AGGRESSIVE);
        vm.expectRevert(CurveMath.UnsupportedShape.selector);
        caller.callProgress(500, 1000, CurveShape.CONSERVATIVE);
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
}
