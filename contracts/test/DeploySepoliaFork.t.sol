// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {DeployAll} from "../script/DeployAll.s.sol";
import {SlopePosition} from "@/SlopePosition.sol";
import {AquaRoute, CreateParams, CurveShape} from "@/SlopeTypes.sol";
import {IAquaRegistry} from "@/interfaces/IAquaRegistry.sol";
import {IAquaSwapVMRouter} from "@/interfaces/IAquaSwapVMRouter.sol";
import {MockERC20} from "@test/mocks/MockERC20.sol";

/// @dev Validates the FULL deployment pipeline (registry -> router -> tokens
/// -> SlopePosition -> seeded strategy) against a live Base Sepolia fork,
/// then proves a real taker fill through the freshly deployed router.
/// No private key needed: broadcast-in-test executes from a funded address.
contract DeploySepoliaForkTest is Test {
    // Base Sepolia canonical WETH predeploy (same address as mainnet).
    address internal constant WETH = 0x4200000000000000000000000000000000000006;

    function test_DeployPipeline_OnBaseSepoliaFork_EndsWithARealFill() external {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", string("https://sepolia.base.org"));
        vm.createSelectFork(rpc);

        uint256 deployerKey = 0xA11CE;
        address deployer = vm.addr(deployerKey);
        vm.deal(deployer, 10e18); // gas money for the pipeline

        DeployAll deployer_ = new DeployAll();
        DeployAll.Deployment memory d = deployer_.deploy(deployerKey, WETH, false, "");

        // Infrastructure landed and the strategy commitment is seeded.
        assertTrue(d.aquaRegistry != address(0));
        assertTrue(d.aquaRouter != address(0));
        assertTrue(d.slopePosition != address(0));
        assertTrue(d.strategyHash != bytes32(0));
        (uint256 ethVirtual, ) = IAquaRegistry(d.aquaRegistry).rawBalances(
            deployer, d.aquaRouter, d.strategyHash, d.dETH
        );
        (uint256 usdVirtual, ) = IAquaRegistry(d.aquaRegistry).rawBalances(
            deployer, d.aquaRouter, d.strategyHash, d.dUSD
        );
        assertEq(ethVirtual, 1000e18);
        assertEq(usdVirtual, 3_000_000e6);

        // A taker fills through the freshly deployed router.
        address alice = makeAddr("alice");
        MockERC20(d.dETH).mint(alice, 10e18);
        vm.startPrank(alice);
        MockERC20(d.dETH).approve(d.slopePosition, type(uint256).max);
        uint256 positionId = SlopePosition(d.slopePosition).createPosition(
            CreateParams({
                tokenIn: d.dETH,
                tokenOut: d.dUSD,
                totalBudget: 10e18,
                minFillAmount: 1e15,
                duration: 1000,
                curveShape: CurveShape.NEUTRAL,
                minPrice: 100e18,
                maxPrice: 10_000e18,
                maxSlippageBps: 500
            }),
            AquaRoute({
                router: IAquaSwapVMRouter(d.aquaRouter),
                order: IAquaSwapVMRouter.Order({maker: deployer, traits: 1 << 254, data: hex"1100"}),
                takerTraitsAndData: hex"00000000000000000000000000000000000000000041"
            })
        );
        vm.stopPrank();

        vm.warp(block.timestamp + 500); // NEUTRAL midpoint: 5e18 authorized
        assertTrue(SlopePosition(d.slopePosition).adaptiveExecute(positionId, 1e17)); // 0.1 dETH fill

        // Real proceeds at the seeded ratio (0.1% of reserves -> ~300e6 out,
        // slightly under the constant-product ideal).
        uint256 proceeds = IERC20(d.dUSD).balanceOf(alice);
        assertGt(proceeds, 290e6);
        assertLt(proceeds, 310e6);
        assertEq(IERC20(d.dUSD).balanceOf(d.slopePosition), 0);
        assertEq(IERC20(d.dETH).balanceOf(d.slopePosition), 0);
    }
}
