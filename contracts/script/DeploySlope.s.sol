// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {SlopePosition} from "@/SlopePosition.sol";
import {Manifest} from "./utils/Manifest.sol";

/// @notice Deploys SlopePosition and records its address AND the deployment
/// block number in the shared manifest — the block number is the subgraph's
/// startBlock, so this must never be skipped.
contract DeploySlope is Script {
    function run() external {
        uint256 key = vm.envOr("PRIVATE_KEY", uint256(0));
        if (key != 0) vm.startBroadcast(key);
        else vm.startBroadcast();

        SlopePosition slope = new SlopePosition();

        vm.stopBroadcast();

        Manifest.Data memory m = Manifest.read(Manifest.baseSepoliaPath());
        m.chainId = block.chainid;
        m.slopePosition = address(slope);
        m.slopePositionBlock = vm.getBlockNumber();
        Manifest.write(Manifest.baseSepoliaPath(), m);

        console2.log("SlopePosition:", address(slope));
        console2.log("block (subgraph startBlock):", vm.toString(vm.getBlockNumber()));
    }
}
