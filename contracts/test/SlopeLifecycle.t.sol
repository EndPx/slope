// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {SlopePosition} from "../src/SlopePosition.sol";
import {CurveMath} from "../src/math/CurveMath.sol";
import {AquaRoute, CreateParams, CurveShape, ISlopeEvents, Position, SlopeErrors} from "../src/SlopeTypes.sol";
import {IAquaSwapVMRouter} from "../src/interfaces/IAquaSwapVMRouter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockAquaRouter} from "./mocks/MockAquaRouter.sol";

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
}
