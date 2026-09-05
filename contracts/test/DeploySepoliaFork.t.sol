// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {AquaRouter} from "aqua-0.1.0/src/AquaRouter.sol";
import {AquaSwapVMRouter} from "swap-vm/routers/AquaSwapVMRouter.sol";
import {SlopePosition} from "@/SlopePosition.sol";
import {AquaRoute, CreateParams, CurveShape, Position} from "@/SlopeTypes.sol";
import {IAquaRegistry} from "@/interfaces/IAquaRegistry.sol";
import {IAquaSwapVMRouter} from "@/interfaces/IAquaSwapVMRouter.sol";
import {DemoStrategy} from "../script/utils/DemoStrategy.sol";
import {MockERC20} from "@test/mocks/MockERC20.sol";

/// @dev Proves the FULL Slope pipeline against REAL Aqua contracts on a live
/// Base Sepolia fork: registry (aqua 0.1.0) + AquaSwapVMRouter (swap-vm
/// v1.0.2) deployed fresh, an UNGATED strategy shipped by the maker, a taker
/// position created through SlopePosition, and a real fill settled through
/// the router's pull/push.
///
/// IMPORTANT: this test is fully IMPERSONATED (vm.prank) — it never uses
/// vm.broadcast. Broadcast-in-test with a remote fork RPC signs and sends
/// transactions to the REAL network, which both pollutes the chain and
/// makes the pipeline unrunnable without a funded key. The five deployment
/// scripts (contracts/script/*.s.sol) wrap the identical call sequence for
/// the real, key-based deployment.
contract DeploySepoliaForkTest is Test {
    IAquaRegistry internal aquaRegistry;
    IAquaSwapVMRouter internal aquaRouter;
    SlopePosition internal slope;
    MockERC20 internal dETH;
    MockERC20 internal dUSD;
    address internal maker = makeAddr("maker");
    address internal alice = makeAddr("alice");

    function setUp() public {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", string("https://sepolia.base.org"));
        vm.createSelectFork(rpc);

        // Official Aqua infra, freshly deployed from the pinned sources.
        address weth = 0x4200000000000000000000000000000000000006;
        aquaRegistry = IAquaRegistry(address(new AquaRouter()));
        aquaRouter = IAquaSwapVMRouter(
            address(new AquaSwapVMRouter(address(aquaRegistry), weth, maker, "AquaSwapVMRouter", "1.0.2"))
        );

        // Maker inventory: 3x the commitment (fills pull from the wallet).
        dETH = new MockERC20("Demo ETH", "dETH", 18);
        dUSD = new MockERC20("Demo USD", "dUSD", 6);
        dETH.mint(maker, DemoStrategy.SEED_ETH * 3);
        dUSD.mint(maker, DemoStrategy.SEED_USD * 3);

        vm.startPrank(maker);
        dETH.approve(address(aquaRegistry), type(uint256).max);
        dUSD.approve(address(aquaRegistry), type(uint256).max);
        aquaRegistry.ship(
            address(aquaRouter),
            DemoStrategy.strategy(maker, DemoStrategy.PROGRAM),
            DemoStrategy.tokens(address(dETH), address(dUSD)),
            DemoStrategy.seedAmounts()
        );
        vm.stopPrank();

        slope = new SlopePosition();
    }

    function _createPosition(address owner, CurveShape shape) internal returns (uint256) {
        dETH.mint(owner, 10e18); // taker input inventory
        vm.startPrank(owner);
        dETH.approve(address(slope), type(uint256).max);
        uint256 id = slope.createPosition(
            CreateParams({
                tokenIn: address(dETH),
                tokenOut: address(dUSD),
                totalBudget: 10e18,
                minFillAmount: 1e15,
                duration: 1000,
                curveShape: shape,
                minPrice: 100e18,
                maxPrice: 10_000e18,
                maxSlippageBps: 500
            }),
            AquaRoute({
                router: aquaRouter,
                order: DemoStrategy.order(maker, DemoStrategy.PROGRAM),
                takerTraitsAndData: DemoStrategy.takerBlob(0)
            })
        );
        vm.stopPrank();
        return id;
    }

    function test_Fork_CreateFill_ThroughRealAquaContracts() external {
        uint256 id = _createPosition(alice, CurveShape.NEUTRAL);
        vm.warp(block.timestamp + 500); // NEUTRAL midpoint: 5e18 authorized

        uint256 aliceEthBefore = dETH.balanceOf(alice);
        assertTrue(slope.adaptiveExecute(id, 1e18)); // fill 1 dETH

        // Real settlement through the official pull/push flow: exactly
        // 1 dETH left alice's wallet and ~3000 dUSD arrived at the owner.
        assertEq(aliceEthBefore - dETH.balanceOf(alice), 1e18);
        uint256 proceeds = dUSD.balanceOf(alice);
        assertGt(proceeds, 2900e6);
        assertLt(proceeds, 3100e6);
        assertEq(dUSD.balanceOf(address(slope)), 0);
        assertEq(dETH.balanceOf(address(slope)), 0);
    }

    function test_Fork_MinFillGateAndCompletion() external {
        uint256 id = _createPosition(alice, CurveShape.NEUTRAL);
        vm.warp(block.timestamp + 500); // elapsed 500: 50% authorized = 5e18

        // Below minFill (1e15): skip, nothing moves.
        assertFalse(slope.adaptiveExecute(id, 1e14), "below minFill should skip");
        assertEq(dUSD.balanceOf(alice), 0, "skipped fill must not pay");

        // Real fill inside the window: 5e18 at the midpoint.
        vm.warp(block.timestamp + 100); // elapsed 600: 60% authorized
        assertTrue(slope.adaptiveExecute(id, 5e18), "midpoint fill should execute");

        // LONG after the window: the terminal clamp settles the exact
        // remainder (5e18) in one call and completes the position.
        vm.warp(block.timestamp + 3000 * 3 + 999);
        assertTrue(slope.adaptiveExecute(id, 10e18), "terminal settle should execute");

        (Position memory p, ) = slope.getPosition(id);
        assertFalse(p.isActive, "position must be completed");
        assertEq(p.executedAmount, 10e18, "budget must be exact");
        assertEq(dETH.balanceOf(alice), 0, "budget fully pulled");
        uint256 proceeds = dUSD.balanceOf(alice);
        assertGt(proceeds, 29_000e6, "proceeds too low");
        assertLt(proceeds, 30_100e6, "proceeds too high");
        assertEq(dUSD.balanceOf(address(slope)), 0);
    }
}
