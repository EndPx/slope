// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {SlopePosition} from "@/SlopePosition.sol";
import {CurveMath} from "@/math/CurveMath.sol";
import {AquaRoute, CreateParams, CurveShape, ISlopeEvents, Position, SkipReason, SlopeErrors} from "@/SlopeTypes.sol";
import {IAquaSwapVMRouter} from "@/interfaces/IAquaSwapVMRouter.sol";
import {MockERC20} from "@test/mocks/MockERC20.sol";
import {MockAquaRouter} from "@test/mocks/MockAquaRouter.sol";

/// @dev Full lifecycle integration: create, execute the exact schedule on
/// every simulated tick, complete via the terminal clamp, and verify that
/// the sum of fills equals the budget with no dust anywhere.
contract SlopeLifecycleTest is Test, ISlopeEvents {
    SlopePosition internal slope;
    MockERC20 internal tokenIn;
    MockERC20 internal tokenOut;
    MockAquaRouter internal router;
    address internal alice = makeAddr("alice");

    uint256 internal constant BUDGET = 100e18;
    uint256 internal constant DURATION = 100;
    uint256 internal constant TICK = 10;

    function setUp() public {
        slope = new SlopePosition();
        tokenIn = new MockERC20("TokenIn", "TIN", 18);
        tokenOut = new MockERC20("TokenOut", "TOUT", 18);
        router = new MockAquaRouter();
        tokenOut.mint(address(router), type(uint256).max / 4);
        tokenIn.mint(alice, BUDGET);
    }

    function test_Lifecycle_TenTicksFollowTheScheduleExactly() external {
        vm.startPrank(alice);
        tokenIn.approve(address(slope), type(uint256).max);
        uint256 id = slope.createPosition(
            CreateParams({
                tokenIn: address(tokenIn),
                tokenOut: address(tokenOut),
                totalBudget: BUDGET,
                minFillAmount: 1,
                duration: DURATION,
                curveShape: CurveShape.NEUTRAL,
                minPrice: 0.5e18,
                maxPrice: 2e18,
                maxSlippageBps: 500
            }),
            AquaRoute({
                router: router,
                order: IAquaSwapVMRouter.Order({maker: makeAddr("maker"), traits: 1 << 254, data: hex"1100"}),
                takerTraitsAndData: hex"000000000000000000000000000000000000000041"
            })
        );
        vm.stopPrank();

        uint256 cumulativeAuthorized;
        for (uint256 tick = 1; tick <= DURATION / TICK; tick++) {
            vm.warp(1 + tick * TICK); // elapsed = tick * TICK
            uint256 authorizedNow = CurveMath.progress(tick * TICK, DURATION, CurveShape.NEUTRAL)
                * BUDGET / 1e18 - cumulativeAuthorized;
            cumulativeAuthorized += authorizedNow;
            // The keeper proposes exactly the schedule amount; the contract
            // must agree to the unit. The final tick lands on duration, so
            // the terminal clamp completes the position there.
            if (tick == DURATION / TICK) {
                vm.expectEmit(true, false, false, false, address(slope));
                emit PositionCompleted(id);
            }
            assertTrue(slope.adaptiveExecute(id, authorizedNow));
            (Position memory p, ) = slope.getPosition(id);
            assertEq(p.executedAmount, cumulativeAuthorized);
            // Schedule adherence: executed never exceeds the authorized cumulative.
            assertLe(p.executedAmount, p.totalBudget * (tick * TICK) / DURATION + 1);
        }

        // Post-completion: the position is inert.
        vm.warp(1 + DURATION);
        vm.expectRevert(SlopeErrors.PositionNotActive.selector);
        slope.adaptiveExecute(id, 1);
        (Position memory pFinal, ) = slope.getPosition(id);
        assertEq(pFinal.executedAmount, BUDGET);
        assertFalse(pFinal.isActive);
        // Conservation, both sides: budget in, proceeds out, nothing stuck.
        assertEq(tokenIn.balanceOf(alice), 0);
        assertEq(tokenOut.balanceOf(alice), BUDGET);
        assertEq(tokenIn.balanceOf(address(slope)), 0);
        assertEq(tokenOut.balanceOf(address(slope)), 0);
    }

    /// @dev REVISION 3 proof: the keeper abandons the position mid-window
    /// (only fills at ticks 3, 6, 9 clear the 30e18 min fill, leaving a
    /// 10e18 tail BELOW minFill), and only returns LONG after the window.
    /// The terminal clamp must still authorize the sub-minFill tail, settle
    /// it, and complete the position with the budget exact.
    function test_Lifecycle_TailBelowMinFill_SettlesLongAfterTheWindow() external {
        uint256 minFill = 30e18;
        vm.startPrank(alice);
        tokenIn.approve(address(slope), type(uint256).max);
        uint256 id = slope.createPosition(
            CreateParams({
                tokenIn: address(tokenIn),
                tokenOut: address(tokenOut),
                totalBudget: BUDGET,
                minFillAmount: minFill,
                duration: DURATION,
                curveShape: CurveShape.NEUTRAL,
                minPrice: 0.5e18,
                maxPrice: 2e18,
                maxSlippageBps: 500
            }),
            AquaRoute({
                router: router,
                order: IAquaSwapVMRouter.Order({maker: makeAddr("maker"), traits: 1 << 254, data: hex"1100"}),
                takerTraitsAndData: hex"000000000000000000000000000000000000000041"
            })
        );
        vm.stopPrank();

        uint256 executed;
        for (uint256 tick = 1; tick <= 9; tick++) {
            vm.warp(1 + tick * TICK);
            uint256 authorizedNow =
                CurveMath.progress(tick * TICK, DURATION, CurveShape.NEUTRAL) * BUDGET / 1e18 - executed;
            slope.adaptiveExecute(id, authorizedNow); // fills only when >= minFill
            executed += authorizedNow >= minFill ? authorizedNow : 0;
        }
        (Position memory pMid, ) = slope.getPosition(id);
        assertEq(pMid.executedAmount, 90e18); // 10e18 tail is below minFill

        // WELL past the window — not at its exact end — one call settles
        // the sub-minFill tail and completes the position exactly.
        vm.warp(1 + DURATION * 3 + 555);
        vm.expectEmit(true, false, false, false, address(slope));
        emit PositionCompleted(id);
        assertTrue(slope.adaptiveExecute(id, BUDGET));
        (Position memory p, ) = slope.getPosition(id);
        assertEq(p.executedAmount, BUDGET);
        assertFalse(p.isActive);
        assertEq(tokenOut.balanceOf(alice), BUDGET);
        assertEq(tokenOut.balanceOf(address(slope)), 0);
    }

    /// @dev Terminal path on a non-NEUTRAL shape (REVISION 3 semantics):
    /// AGGRESSIVE fills 65e18 of its 100e18 budget inside the window —
    /// authorized there is exactly 100e18 * floor(sqrt(5e35)) / 1e18 =
    /// 70710678118654752400 — leaving a 35e18 remainder BELOW minFill
    /// 60e18. Long after the window the terminal clamp authorizes the
    /// exact remainder, bypasses minFill, and completes the position with
    /// the budget exact.
    function test_Lifecycle_AggressivePartialFillThenTerminalSettlement() external {
        vm.startPrank(alice);
        tokenIn.approve(address(slope), type(uint256).max);
        uint256 id = slope.createPosition(
            CreateParams({
                tokenIn: address(tokenIn),
                tokenOut: address(tokenOut),
                totalBudget: BUDGET,
                minFillAmount: 60e18,
                duration: DURATION,
                curveShape: CurveShape.AGGRESSIVE,
                minPrice: 0.5e18,
                maxPrice: 2e18,
                maxSlippageBps: 500
            }),
            AquaRoute({
                router: router,
                order: IAquaSwapVMRouter.Order({maker: makeAddr("maker"), traits: 1 << 254, data: hex"1100"}),
                takerTraitsAndData: hex"000000000000000000000000000000000000000041"
            })
        );
        vm.stopPrank();

        vm.warp(1 + 500);
        assertTrue(slope.adaptiveExecute(id, 65e18)); // fills 65e18, capped by maxAmountIn
        (Position memory pMid, ) = slope.getPosition(id);
        assertEq(pMid.executedAmount, 65e18);
        assertLt(BUDGET - pMid.executedAmount, 60e18); // remainder below minFill

        vm.warp(1 + DURATION * 3 + 111);
        vm.expectEmit(true, false, false, false, address(slope));
        emit PositionCompleted(id);
        assertTrue(slope.adaptiveExecute(id, BUDGET)); // terminal bypass settles 35e18
        (Position memory p, ) = slope.getPosition(id);
        assertEq(p.executedAmount, BUDGET);
        assertFalse(p.isActive);
        assertEq(tokenOut.balanceOf(alice), BUDGET);
        assertEq(tokenOut.balanceOf(address(slope)), 0);
    }

    /// @dev Terminal path on CONSERVATIVE with exact numbers: at elapsed
    /// 900 the back-loaded schedule authorizes (0.9)^2 = 81% of the budget
    /// — the only in-window moment the 80e18 min fill is cleared — leaving
    /// a 19e18 tail BELOW minFill. Long after the window the terminal clamp
    /// authorizes the exact remainder, bypasses minFill, and completes the
    /// position with the budget exact.
    function test_Lifecycle_ConservativeTailBelowMinFill_SettlesPastTheWindow() external {
        uint256 minFill = 80e18;
        vm.startPrank(alice);
        tokenIn.approve(address(slope), type(uint256).max);
        uint256 id = slope.createPosition(
            CreateParams({
                tokenIn: address(tokenIn),
                tokenOut: address(tokenOut),
                totalBudget: BUDGET,
                minFillAmount: minFill,
                duration: DURATION,
                curveShape: CurveShape.CONSERVATIVE,
                minPrice: 0.5e18,
                maxPrice: 2e18,
                maxSlippageBps: 500
            }),
            AquaRoute({
                router: router,
                order: IAquaSwapVMRouter.Order({maker: makeAddr("maker"), traits: 1 << 254, data: hex"1100"}),
                takerTraitsAndData: hex"000000000000000000000000000000000000000041"
            })
        );
        vm.stopPrank();

        // Mid-window: back-loaded schedule authorizes only 25e18 < 80e18 —
        // the fill is skipped, proving minFill actually gates this shape.
        vm.warp(1 + 50); // elapsed 50 of 100: (0.5)^2 = 25% authorized
        vm.expectEmit(true, false, false, true, address(slope));
        emit PositionSkipped(id, SkipReason.MIN_FILL);
        assertFalse(slope.adaptiveExecute(id, 25e18));

        // Late window: 81% authorized clears the min fill.
        vm.warp(1 + 90); // elapsed 90 of 100: (0.9)^2 = 81% -> 81e18 (exact)
        assertTrue(slope.adaptiveExecute(id, 81e18));
        (Position memory pMid, ) = slope.getPosition(id);
        assertEq(pMid.executedAmount, 81e18);
        assertLt(BUDGET - pMid.executedAmount, minFill); // 19e18 tail

        // WELL past the window: the terminal clamp settles the tail.
        vm.warp(1 + DURATION * 3 + 999);
        vm.expectEmit(true, false, false, false, address(slope));
        emit PositionCompleted(id);
        assertTrue(slope.adaptiveExecute(id, BUDGET));
        (Position memory p, ) = slope.getPosition(id);
        assertEq(p.executedAmount, BUDGET);
        assertFalse(p.isActive);
        assertEq(tokenOut.balanceOf(alice), BUDGET);
        assertEq(tokenOut.balanceOf(address(slope)), 0);
    }
}
