// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SlopePosition} from "@/SlopePosition.sol";
import {AquaRoute, CreateParams, CurveShape, ISlopeEvents, Position, SkipReason, SlopeErrors} from "@/SlopeTypes.sol";
import {IAquaSwapVMRouter} from "@/interfaces/IAquaSwapVMRouter.sol";
import {MockERC20} from "@test/mocks/MockERC20.sol";
import {MockAquaRouter} from "@test/mocks/MockAquaRouter.sol";

contract SlopePositionTest is Test, ISlopeEvents {
    SlopePosition internal slope;
    MockERC20 internal tokenIn;
    MockERC20 internal tokenOut;
    MockAquaRouter internal router;
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    uint256 internal constant BUDGET = 100e18;
    uint256 internal constant DURATION = 1000;
    uint256 internal constant MIN_FILL = 1e18;
    // Creation happens at the default foundry timestamp (1).
    uint256 internal constant T0 = 1;

    function setUp() public {
        slope = new SlopePosition();
        tokenIn = new MockERC20("TokenIn", "TIN", 18);
        tokenOut = new MockERC20("TokenOut", "TOUT", 18);
        router = new MockAquaRouter();
        tokenOut.mint(address(router), type(uint256).max / 4);
        tokenIn.mint(alice, BUDGET);
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    function _defaultParams() internal view returns (CreateParams memory) {
        return CreateParams({
            tokenIn: address(tokenIn),
            tokenOut: address(tokenOut),
            totalBudget: BUDGET,
            minFillAmount: MIN_FILL,
            duration: DURATION,
            curveShape: CurveShape.NEUTRAL,
            minPrice: 0.5e18,
            maxPrice: 2e18,
            maxSlippageBps: 500
        });
    }

    function _route() internal returns (AquaRoute memory) {
        return AquaRoute({
            router: router,
            order: IAquaSwapVMRouter.Order({maker: makeAddr("maker"), traits: 1 << 254, data: hex"1100"}),
            takerTraitsAndData: hex"000000000000000000000000000000000000000041"
        });
    }

    function _create() internal returns (uint256 positionId) {
        return _createWithMinFill(MIN_FILL);
    }

    function _createWithMinFill(uint256 minFillAmount) internal returns (uint256 positionId) {
        vm.startPrank(alice);
        tokenIn.approve(address(slope), type(uint256).max);
        CreateParams memory params = _defaultParams();
        params.minFillAmount = minFillAmount;
        positionId = slope.createPosition(params, _route());
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // creation
    // ------------------------------------------------------------------

    function test_Create_StoresTheFullPolicyAndCachesDecimals() external {
        uint256 id = _create();
        (Position memory p, AquaRoute memory r) = slope.getPosition(id);
        assertEq(p.owner, alice);
        assertEq(p.tokenIn, address(tokenIn));
        assertEq(p.tokenOut, address(tokenOut));
        assertEq(p.decimalsIn, 18);
        assertEq(p.decimalsOut, 18);
        assertEq(p.totalBudget, BUDGET);
        assertEq(p.executedAmount, 0);
        assertEq(p.minFillAmount, MIN_FILL);
        assertEq(p.startTimestamp, T0);
        assertEq(p.duration, DURATION);
        assertEq(uint8(p.curveShape), uint8(CurveShape.NEUTRAL));
        assertEq(p.minPrice, 0.5e18);
        assertEq(p.maxPrice, 2e18);
        assertEq(p.maxSlippageBps, 500);
        assertTrue(p.isActive);
        assertEq(address(r.router), address(router));
        assertEq(r.order.maker, _route().order.maker);
    }

    function test_Create_EmitsPositionCreated() external {
        vm.startPrank(alice);
        tokenIn.approve(address(slope), type(uint256).max);
        vm.expectEmit(true, true, false, true, address(slope));
        emit PositionCreated(
            1, alice, address(tokenIn), address(tokenOut), 18, 18,
            BUDGET, MIN_FILL, DURATION, CurveShape.NEUTRAL, 0.5e18, 2e18, 500
        );
        slope.createPosition(_defaultParams(), _route());
        vm.stopPrank();
    }

    function test_Create_RejectsInvalidTokens() external {
        vm.startPrank(alice);
        tokenIn.approve(address(slope), type(uint256).max);
        CreateParams memory p = _defaultParams();
        p.tokenIn = address(0);
        vm.expectRevert(SlopeErrors.InvalidToken.selector);
        slope.createPosition(p, _route());
        p = _defaultParams();
        p.tokenIn = p.tokenOut;
        vm.expectRevert(SlopeErrors.InvalidToken.selector);
        slope.createPosition(p, _route());
        vm.stopPrank();
    }

    function test_Create_RejectsInvalidBudgetAndMinFill() external {
        vm.startPrank(alice);
        tokenIn.approve(address(slope), type(uint256).max);
        CreateParams memory p = _defaultParams();
        p.totalBudget = 0;
        vm.expectRevert(SlopeErrors.InvalidBudget.selector);
        slope.createPosition(p, _route());
        p = _defaultParams();
        p.minFillAmount = 0;
        vm.expectRevert(SlopeErrors.InvalidMinFill.selector);
        slope.createPosition(p, _route());
        p = _defaultParams();
        p.minFillAmount = BUDGET + 1;
        vm.expectRevert(SlopeErrors.InvalidMinFill.selector);
        slope.createPosition(p, _route());
        vm.stopPrank();
    }

    function test_Create_RejectsInvalidDurationBoundsAndSlippage() external {
        vm.startPrank(alice);
        tokenIn.approve(address(slope), type(uint256).max);
        CreateParams memory p = _defaultParams();
        p.duration = 0;
        vm.expectRevert(SlopeErrors.InvalidDuration.selector);
        slope.createPosition(p, _route());
        p = _defaultParams();
        p.minPrice = 0;
        vm.expectRevert(SlopeErrors.InvalidBounds.selector);
        slope.createPosition(p, _route());
        p = _defaultParams();
        p.minPrice = p.maxPrice;
        vm.expectRevert(SlopeErrors.InvalidBounds.selector);
        slope.createPosition(p, _route());
        p = _defaultParams();
        p.maxSlippageBps = 0;
        vm.expectRevert(SlopeErrors.InvalidSlippage.selector);
        slope.createPosition(p, _route());
        vm.stopPrank();
    }


    function test_Create_RejectsInvalidRoute() external {
        vm.startPrank(alice);
        tokenIn.approve(address(slope), type(uint256).max);
        AquaRoute memory r = _route();
        r.router = IAquaSwapVMRouter(address(0));
        vm.expectRevert(SlopeErrors.InvalidRoute.selector);
        slope.createPosition(_defaultParams(), r);
        r = _route();
        r.order.maker = address(0);
        vm.expectRevert(SlopeErrors.InvalidRoute.selector);
        slope.createPosition(_defaultParams(), r);
        vm.stopPrank();
    }

    function test_Create_RejectsDecimalsAbove18() external {
        MockERC20 weird = new MockERC20("Weird", "WRD", 19);
        weird.mint(alice, BUDGET);
        vm.startPrank(alice);
        tokenIn.approve(address(slope), type(uint256).max);
        weird.approve(address(slope), type(uint256).max);
        CreateParams memory p = _defaultParams();
        p.tokenIn = address(weird);
        vm.expectRevert(SlopeErrors.InvalidDecimals.selector);
        slope.createPosition(p, _route());
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // adaptiveExecute: the schedule
    // ------------------------------------------------------------------

    function test_Execute_AtZeroElapsed_SkipsNotDue() external {
        uint256 id = _create();
        vm.expectEmit(false, false, false, true, address(slope));
        emit PositionSkipped(id, SkipReason.NOT_DUE);
        bool executed = slope.adaptiveExecute(id, 50e18);
        assertFalse(executed);
    }

    function test_Execute_AtHalfWindow_FillsHalfAndSweepsToOwner() external {
        uint256 id = _create();
        vm.warp(T0 + 500);
        bool executed = slope.adaptiveExecute(id, 50e18);
        assertTrue(executed);
        (Position memory p, ) = slope.getPosition(id);
        assertEq(p.executedAmount, 50e18);
        // Owner received tokenOut; the contract holds nothing between fills.
        assertEq(tokenOut.balanceOf(alice), 50e18);
        assertEq(tokenOut.balanceOf(address(slope)), 0);
        assertEq(tokenIn.balanceOf(alice), BUDGET - 50e18);
        assertEq(tokenIn.balanceOf(address(slope)), 0);
    }

    function test_Execute_MaxAmountInTightensButNeverExceedsTheSchedule() external {
        uint256 id = _create();
        vm.warp(T0 + 500);
        slope.adaptiveExecute(id, 30e18);
        (Position memory p, ) = slope.getPosition(id);
        assertEq(p.executedAmount, 30e18);
        // A hostile or oversized proposal cannot exceed the schedule.
        vm.warp(T0 + 500);
        slope.adaptiveExecute(id, type(uint256).max);
        (p, ) = slope.getPosition(id);
        assertEq(p.executedAmount, 50e18);
    }

    function test_Execute_ZeroProposed_SkipsNotDue() external {
        uint256 id = _create();
        vm.warp(T0 + 500);
        vm.expectEmit(false, false, false, true, address(slope));
        emit PositionSkipped(id, SkipReason.NOT_DUE);
        assertFalse(slope.adaptiveExecute(id, 0));
    }

    function test_Execute_BelowMinFill_SkipsOutsideTheTerminalWindow() external {
        CreateParams memory params = _defaultParams();
        params.minFillAmount = 10e18;
        vm.startPrank(alice);
        tokenIn.approve(address(slope), type(uint256).max);
        uint256 id = slope.createPosition(params, _route());
        vm.stopPrank();
        vm.warp(T0 + 50); // authorized: 5e18 < 10e18 min fill
        vm.expectEmit(false, false, false, true, address(slope));
        emit PositionSkipped(id, SkipReason.MIN_FILL);
        assertFalse(slope.adaptiveExecute(id, 5e18));
    }

    // ------------------------------------------------------------------
    // adaptiveExecute: price guardrails
    // ------------------------------------------------------------------

    function test_Execute_PriceAboveMax_SkipsBounds() external {
        uint256 id = _create();
        router.setPriceWad(3e18);
        vm.warp(T0 + 500);
        vm.expectEmit(false, false, false, true, address(slope));
        emit PositionSkipped(id, SkipReason.BOUNDS);
        assertFalse(slope.adaptiveExecute(id, 50e18));
    }

    function test_Execute_PriceBelowMin_SkipsBounds() external {
        uint256 id = _create();
        router.setPriceWad(0.4e18);
        vm.warp(T0 + 500);
        vm.expectEmit(false, false, false, true, address(slope));
        emit PositionSkipped(id, SkipReason.BOUNDS);
        assertFalse(slope.adaptiveExecute(id, 50e18));
    }

    function test_Execute_ImpactAboveLimit_SkipsAndRecoversWhenLiquidityCalms() external {
        uint256 id = _create();
        // Large fills (>= 10e18) get a 20% worse price on the mock; the
        // probe (0.1% of the fill) is unaffected, so impact = 2000 bps.
        router.setLargeFillPenalty(10e18, 2000);
        vm.warp(T0 + 500);
        vm.expectEmit(false, false, false, true, address(slope));
        emit PositionSkipped(id, SkipReason.IMPACT);
        assertFalse(slope.adaptiveExecute(id, 50e18));
        (Position memory p, ) = slope.getPosition(id);
        assertEq(p.executedAmount, 0);

        // Liquidity calms to 3% (< the 5% limit): the same fill now executes.
        router.setLargeFillPenalty(10e18, 300);
        assertTrue(slope.adaptiveExecute(id, 50e18));
        (p, ) = slope.getPosition(id);
        assertEq(p.executedAmount, 50e18);
        assertEq(tokenOut.balanceOf(alice), 48.5e18);
    }

    // ------------------------------------------------------------------
    // adaptiveExecute: pull-per-fill custody
    // ------------------------------------------------------------------

    function test_Execute_InsufficientBalance_SkipsWithoutReverting() external {
        uint256 id = _create();
        vm.startPrank(alice);
        tokenIn.transfer(bob, BUDGET); // approval remains, balance is gone
        vm.stopPrank();
        vm.warp(T0 + 500);
        vm.expectEmit(false, false, false, true, address(slope));
        emit PositionSkipped(id, SkipReason.TRANSFER_FAILED);
        assertFalse(slope.adaptiveExecute(id, 50e18));
        (Position memory p, ) = slope.getPosition(id);
        assertEq(p.executedAmount, 0);
        assertEq(tokenOut.balanceOf(alice), 0);
    }

    function test_Execute_RevokedApproval_SkipsWithoutReverting() external {
        uint256 id = _create();
        vm.startPrank(alice);
        tokenIn.approve(address(slope), 0);
        vm.stopPrank();
        vm.warp(T0 + 500);
        vm.expectEmit(false, false, false, true, address(slope));
        emit PositionSkipped(id, SkipReason.TRANSFER_FAILED);
        assertFalse(slope.adaptiveExecute(id, 50e18));
    }

    // ------------------------------------------------------------------
    // adaptiveExecute: window edges and completion
    // ------------------------------------------------------------------

    function test_Execute_LongAfterDuration_SettlesRemainderAndCompletes() external {
        uint256 id = _create();
        // Only half the schedule executes during the window.
        vm.warp(T0 + 500);
        assertTrue(slope.adaptiveExecute(id, 50e18));

        // WELL past the window — not the exact second — the remainder is
        // still authorized, the position completes, and nothing is forfeited.
        vm.warp(T0 + DURATION * 3 + 777);
        vm.expectEmit(true, false, false, false, address(slope));
        emit PositionCompleted(id);
        assertTrue(slope.adaptiveExecute(id, BUDGET));
        (Position memory p, ) = slope.getPosition(id);
        assertEq(p.executedAmount, BUDGET);
        assertFalse(p.isActive);
        assertEq(tokenOut.balanceOf(alice), BUDGET);
    }

    function test_Execute_TerminalClampBypassesMinFillAndCompletes() external {
        CreateParams memory params = _defaultParams();
        params.minFillAmount = 30e18;
        vm.startPrank(alice);
        tokenIn.approve(address(slope), type(uint256).max);
        uint256 id = slope.createPosition(params, _route());
        vm.stopPrank();

        vm.warp(T0 + 500);
        assertTrue(slope.adaptiveExecute(id, 45e18)); // executed 45e18
        vm.warp(T0 + 800);
        assertTrue(slope.adaptiveExecute(id, 30e18)); // executed 75e18

        // At expiry: remainder 25e18 < minFill 30e18, but the terminal clamp
        // authorizes the exact remainder and the bypass applies.
        vm.warp(T0 + DURATION);
        assertTrue(slope.adaptiveExecute(id, 25e18));
        (Position memory p, ) = slope.getPosition(id);
        assertEq(p.executedAmount, BUDGET);
        assertFalse(p.isActive);
        assertEq(tokenOut.balanceOf(alice), BUDGET);
    }

    function test_Execute_AfterCompletion_Reverts() external {
        uint256 id = _create();
        vm.warp(T0 + DURATION);
        vm.expectEmit(true, false, false, false, address(slope));
        emit PositionCompleted(id);
        assertTrue(slope.adaptiveExecute(id, BUDGET));
        vm.expectRevert(SlopeErrors.PositionNotActive.selector);
        slope.adaptiveExecute(id, 1);
    }

    function test_Execute_IsPermissionless() external {
        uint256 id = _create();
        vm.warp(T0 + 500);
        vm.prank(bob); // not the owner, not the keeper — anyone
        assertTrue(slope.adaptiveExecute(id, 50e18));
        (Position memory p, ) = slope.getPosition(id);
        assertEq(p.executedAmount, 50e18);
    }

    function test_Execute_SmallFillOnSixDecimalToken_ProbeDoesNotStrand() external {
        // Regression test (review pass): on a 6-decimal tokenIn the floored
        // probe (fill/1000) used to collapse to 1 wei, whose quote returns
        // zero and stranded the position on a misleading IMPACT skip.
        // The decimal-derived probe floor keeps the probe meaningful.
        MockERC20 usdcIn = new MockERC20("USDC", "USDC", 6);
        usdcIn.mint(alice, 100e6);
        // 1:1 economic price across decimals: rawOut = rawIn * 1e12.
        router.setPriceWad(1e30);

        vm.startPrank(alice);
        usdcIn.approve(address(slope), type(uint256).max);
        CreateParams memory params = _defaultParams();
        params.tokenIn = address(usdcIn);
        params.totalBudget = 100e6;
        params.minFillAmount = 1e6; // 1 USDC
        uint256 id = slope.createPosition(params, _route());
        vm.stopPrank();

        vm.warp(T0 + 10); // authorized: 1 USDC = 1e6 raw
        // probe = max(1e6/1000, floor 1e4 = 0.01 USDC) = 1e4 raw — a real
        // notional the router prices at 1e16 out. Nonzero, no stranding.
        assertTrue(slope.adaptiveExecute(id, 1e6));
        (Position memory p, ) = slope.getPosition(id);
        assertEq(p.executedAmount, 1e6);
        assertEq(tokenOut.balanceOf(alice), 1e18);
    }

    function test_Execute_DegenerateProbeQuote_SkipsQuoteInvalid_NotImpact() external {
        uint256 id = _create();
        // Every quote below max returns zero: a quote-quality failure must
        // surface as QUOTE_INVALID, distinct from IMPACT.
        router.setZeroQuoteBelow(type(uint256).max);
        vm.warp(T0 + 500);
        vm.expectEmit(false, false, false, true, address(slope));
        emit PositionSkipped(id, SkipReason.QUOTE_INVALID);
        assertFalse(slope.adaptiveExecute(id, 50e18));
    }

    function test_Execute_BelowProbeFloor_FillsWithImpactNotChecked() external {
        uint256 id = _createWithMinFill(1000); // dust min-fill: the 5e13 fill passes it
        // Floor is 1e14 raw (0.0001 WETH). A 5e13 fill is below it: the fill
        // is its own probe, the impact measurement is not applied, and the
        // event says so honestly — the absolute bounds still protect it.
        vm.warp(T0 + 500);
        vm.expectEmit(true, false, false, true, address(slope));
        emit FillExecuted(id, 5e13, 5e13, 1e18, T0 + 500, false);
        assertTrue(slope.adaptiveExecute(id, 5e13));
        (Position memory p, ) = slope.getPosition(id);
        assertEq(p.executedAmount, 5e13);
    }

    function test_Execute_AboveProbeFloor_FlagsImpactChecked() external {
        uint256 id = _create();
        vm.warp(T0 + 500);
        vm.expectEmit(true, false, false, true, address(slope));
        emit FillExecuted(id, 50e18, 50e18, 1e18, T0 + 500, true);
        assertTrue(slope.adaptiveExecute(id, 50e18));
    }

    // ------------------------------------------------------------------
    // shapes end-to-end (step-2 milestone)
    // ------------------------------------------------------------------

    function test_Execute_ShapeOrderingAtMidpoint_AggressiveAboveNeutralAboveConservative() external {
        // Three positions, same pair and route price; only the schedule
        // differs. At the window midpoint the executed amounts must be
        // ordered front-loaded > linear > back-loaded.
        vm.startPrank(alice);
        tokenIn.approve(address(slope), type(uint256).max);
        uint256 aggressiveId = slope.createPosition(_shapeParams(CurveShape.AGGRESSIVE), _route());
        uint256 neutralId = slope.createPosition(_shapeParams(CurveShape.NEUTRAL), _route());
        uint256 conservativeId = slope.createPosition(_shapeParams(CurveShape.CONSERVATIVE), _route());
        vm.stopPrank();
        // Full fills at midpoint need sqrt(0.5)e18*100 + 50e18 + 25e18
        // ≈ 145.72e18 tokenIn; mint well above that.
        tokenIn.mint(alice, 50e18);

        vm.warp(T0 + 500);
        assertTrue(slope.adaptiveExecute(aggressiveId, BUDGET));
        assertTrue(slope.adaptiveExecute(neutralId, BUDGET));
        assertTrue(slope.adaptiveExecute(conservativeId, BUDGET));

        (Position memory agg, ) = slope.getPosition(aggressiveId);
        (Position memory neu, ) = slope.getPosition(neutralId);
        (Position memory con, ) = slope.getPosition(conservativeId);
        assertEq(neu.executedAmount, 50e18);
        assertEq(con.executedAmount, 25e18);
        // Exact: 100e18 * floor(sqrt(5e35)) / 1e18 = 70710678118654752400.
        assertEq(agg.executedAmount, 70710678118654752400);
        assertGt(agg.executedAmount, neu.executedAmount);
        assertGt(neu.executedAmount, con.executedAmount);
    }

    function _shapeParams(CurveShape shape) internal view returns (CreateParams memory) {
        CreateParams memory params = _defaultParams();
        params.curveShape = shape;
        return params;
    }

    // ------------------------------------------------------------------
    // cancel and route management
    // ------------------------------------------------------------------

    function test_Cancel_IsOwnerOnlyAndDeactivates() external {
        uint256 id = _create();
        vm.prank(bob);
        vm.expectRevert(SlopeErrors.NotOwner.selector);
        slope.cancel(id);
        vm.startPrank(alice);
        vm.expectEmit(true, false, false, false, address(slope));
        emit PositionCancelled(id);
        slope.cancel(id);
        vm.stopPrank();
        vm.expectRevert(SlopeErrors.PositionNotActive.selector);
        slope.adaptiveExecute(id, 50e18);
        vm.prank(alice);
        vm.expectRevert(SlopeErrors.PositionNotActive.selector);
        slope.cancel(id);
    }

    function test_UpdateRoute_IsOwnerOnlyAndAppliesToFutureFills() external {
        uint256 id = _create();
        MockAquaRouter router2 = new MockAquaRouter();
        router2.setPriceWad(2e18);
        tokenOut.mint(address(router2), type(uint256).max / 4);

        AquaRoute memory r2 = _route();
        r2.router = router2;
        vm.prank(bob);
        vm.expectRevert(SlopeErrors.NotOwner.selector);
        slope.updateRoute(id, r2);

        vm.startPrank(alice);
        vm.expectEmit(true, false, false, false, address(slope));
        emit RouteUpdated(id);
        slope.updateRoute(id, r2);
        vm.stopPrank();

        vm.warp(T0 + 500);
        assertTrue(slope.adaptiveExecute(id, 50e18));
        // The new route's price is 2e18: the owner received double.
        assertEq(tokenOut.balanceOf(alice), 100e18);
    }

    function test_UpdateRoute_RevertsOnInactivePosition() external {
        uint256 id = _create();
        vm.startPrank(alice);
        slope.cancel(id);
        vm.expectRevert(SlopeErrors.PositionNotActive.selector);
        slope.updateRoute(id, _route());
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // asymmetric decimals (WETH/USDC shape)
    // ------------------------------------------------------------------

    function test_Execute_AsymmetricDecimals_WethToUsdc() external {
        MockERC20 weth = new MockERC20("WETH", "WETH", 18);
        MockERC20 usdc = new MockERC20("USDC", "USDC", 6);
        weth.mint(alice, BUDGET);
        // priceWad is the raw-out / raw-in ratio in WAD:
        // 3000 USDC raw (3e9) per 1 WETH raw (1e18) -> 3e9 WAD.
        router.setPriceWad(3e9);
        usdc.mint(address(router), type(uint256).max / 4);

        vm.startPrank(alice);
        weth.approve(address(slope), type(uint256).max);
        CreateParams memory params = _defaultParams();
        params.tokenIn = address(weth);
        params.tokenOut = address(usdc);
        // Price bounds in normalized convention: 1000e18..5000e18.
        params.minPrice = 1000e18;
        params.maxPrice = 5000e18;
        uint256 id = slope.createPosition(params, _route());
        vm.stopPrank();

        vm.warp(T0 + 500);
        assertTrue(slope.adaptiveExecute(id, 50e18));
        // 50 WETH sold at 3000 USDC per WETH = 150,000 USDC (150_000e6 raw).
        assertEq(usdc.balanceOf(alice), 150_000e6);
        assertEq(usdc.balanceOf(address(slope)), 0);
    }
}
