// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {MockERC20} from "@test/mocks/MockERC20.sol";
import {DemoStrategy} from "./utils/DemoStrategy.sol";
import {Manifest} from "./utils/Manifest.sol";

/// @notice Deploys the two demo tokens with asymmetric decimals (18 / 6 —
/// this is what exercises price normalization in real conditions) and mints
/// the initial supply to the deployer, well above the strategy commitment.
contract DeployTokens is Script {
    function run() external {
        uint256 key = vm.envOr("PRIVATE_KEY", uint256(0));
        address deployer = key != 0 ? vm.addr(key) : msg.sender;
        if (key != 0) vm.startBroadcast(key);
        else vm.startBroadcast();
        MockERC20 dETH = new MockERC20("Demo ETH", "dETH", 18);
        MockERC20 dUSD = new MockERC20("Demo USD", "dUSD", 6);
        // 3x the seed commitment: re-seeding headroom without re-minting.
        dETH.mint(deployer, DemoStrategy.SEED_ETH * 3);
        dUSD.mint(deployer, DemoStrategy.SEED_USD * 3);

        vm.stopBroadcast();

        Manifest.Data memory m = Manifest.read(Manifest.baseSepoliaPath());
        m.chainId = block.chainid;
        m.dETH = address(dETH);
        m.dUSD = address(dUSD);
        Manifest.write(Manifest.baseSepoliaPath(), m);

        console2.log("dETH (18):", address(dETH));
        console2.log("dUSD (6):", address(dUSD));
        console2.log("minted to deployer: 3x seed amounts");
    }
}
