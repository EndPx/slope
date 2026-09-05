// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {SlopePosition} from "@/SlopePosition.sol";
import {MockERC20} from "@test/mocks/MockERC20.sol";

/// @notice Deploys the Slope-side contracts for a demo network and records
/// everything in deployments/<chainId>.json (committed manifest consumed by
/// frontend, keeper, and subgraph).
///
/// Required env:
///   PRIVATE_KEY       funded deployer (also becomes the demo-token minter)
///   AQUA_REGISTRY     official Aqua registry address on this network
///   AQUA_ROUTER       official AquaSwapVMRouter address on this network
///
/// The Aqua registry + SwapVM router themselves are deployed from the pinned
/// submodules (contracts/lib/aqua-protocol, contracts/lib/swap-vm, tag
/// v1.0.2) using their own scripts — see docs/DEPLOYMENT.md.
contract DeploySlope is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address aquaRegistry = vm.envAddress("AQUA_REGISTRY");
        address aquaRouter = vm.envAddress("AQUA_ROUTER");
        if (aquaRegistry == address(0) || aquaRouter == address(0)) {
            revert("AQUA_REGISTRY/AQUA_ROUTER must be set (deploy them from the pinned submodules first)");
        }

        vm.startBroadcast(deployerKey);
        MockERC20 dETH = new MockERC20("Demo ETH", "dETH", 18);
        MockERC20 dUSD = new MockERC20("Demo USD", "dUSD", 6);
        SlopePosition slope = new SlopePosition();
        vm.stopBroadcast();

        string memory json = "deployment";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "deployer", msg.sender);
        vm.serializeAddress(json, "aquaRegistry", aquaRegistry);
        vm.serializeAddress(json, "aquaRouter", aquaRouter);
        vm.serializeAddress(json, "dETH", address(dETH));
        vm.serializeAddress(json, "dUSD", address(dUSD));
        vm.serializeAddress(json, "slopePosition", address(slope));
        vm.serializeUint(json, "slopePositionBlock", vm.getBlockNumber());
        string memory finalJson =
            vm.serializeString(json, "note", "demo tokens are Slope-minted; strategy seeding via SeedStrategy.s.sol");
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(finalJson, path);
        console2.log("dETH:", address(dETH));
        console2.log("dUSD:", address(dUSD));
        console2.log("SlopePosition:", address(slope));
        console2.log("manifest:", path);
    }
}
