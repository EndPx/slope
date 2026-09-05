// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SlopePosition} from "@/SlopePosition.sol";
import {AquaRoute, CreateParams, CurveShape} from "@/SlopeTypes.sol";
import {IAquaSwapVMRouter} from "@/interfaces/IAquaSwapVMRouter.sol";
import {DemoStrategy} from "./utils/DemoStrategy.sol";
import {Manifest} from "./utils/Manifest.sol";

/// @notice Creates a demo taker position against the seeded maker strategy
/// without going through the UI. Used for demo recordings and keeper
/// debugging. Funds the taker from the demo faucet (open-mint tokens) and
/// records the positionId in the shared manifest.
contract CreateDemoPosition is Script {
    function run() external {
        uint256 key = vm.envOr("PRIVATE_KEY", uint256(0));
        address taker = key != 0 ? vm.addr(key) : msg.sender;
        if (key != 0) vm.startBroadcast(key);
        else vm.startBroadcast();
        Manifest.Data memory m = Manifest.read(Manifest.baseSepoliaPath());
        require(m.slopePosition != address(0), "demo: run DeploySlope first");
        require(m.strategyHash != bytes32(0), "demo: run SeedLiquidity first");
        require(m.strategy.length != 0, "demo: manifest missing strategy bytes");

        // The route must mirror the SEEDED strategy exactly (same maker,
        // same salted program) — a divergence here fails fills opaquely.
        // m.strategy is abi.encode(Order); decode it into the route.
        IAquaSwapVMRouter.Order memory order = abi.decode(m.strategy, (IAquaSwapVMRouter.Order));
        AquaRoute memory route = AquaRoute({
            router: IAquaSwapVMRouter(m.aquaRouter),
            order: order,
            takerTraitsAndData: DemoStrategy.takerBlob(0) // quote-level guards; OI-2 wires min-out
        });
        CreateParams memory params = CreateParams({
            tokenIn: m.dETH,
            tokenOut: m.dUSD,
            totalBudget: 10e18,
            minFillAmount: 1e17,
            duration: 1000,
            curveShape: CurveShape.NEUTRAL,
            minPrice: 100e18,
            maxPrice: 10_000e18,
            maxSlippageBps: 500
        });

        // Faucet: demo tokens are open-mint; the taker needs input inventory.
        MockMintable(m.dETH).mint(taker, params.totalBudget);
        SlopePosition slope = SlopePosition(m.slopePosition);
        IERC20(m.dETH).approve(m.slopePosition, type(uint256).max);
        uint256 positionId = slope.createPosition(params, route);

        vm.stopBroadcast();

        m.demoTaker = taker;
        m.demoPositionId = positionId;
        Manifest.write(Manifest.baseSepoliaPath(), m);

        console2.log("taker:", taker);
        console2.log("positionId:", positionId);
    }
}

interface MockMintable {
    function mint(address to, uint256 amount) external;
}
