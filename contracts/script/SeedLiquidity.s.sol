// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAquaRegistry} from "@/interfaces/IAquaRegistry.sol";
import {DemoStrategy} from "./utils/DemoStrategy.sol";
import {Manifest} from "./utils/Manifest.sol";

/// @notice Ships an UNGATED demo strategy (xycSwapXD + salt, no KYC-gate
/// opcode) from the maker wallet into the official Aqua registry. This is
/// the script most often re-run: every time testing drains liquidity or the
/// strategy needs a fresh hash, re-run it with a new EPOCH — the salt
/// derived from (epoch, index) guarantees a non-colliding strategyHash.
///
/// Safety invariant: total shipped stays strictly below the maker wallet
/// balance — Aqua virtual balances are commitments, not escrow.
contract SeedLiquidity is Script {
    function run() external {
        uint256 key = vm.envOr("PRIVATE_KEY", uint256(0));
        uint64 epoch = uint64(vm.envOr("EPOCH", block.timestamp));
        address maker = key != 0 ? vm.addr(key) : msg.sender;
        if (key != 0) vm.startBroadcast(key);
        else vm.startBroadcast();
        Manifest.Data memory m = Manifest.read(Manifest.baseSepoliaPath());
        require(m.aquaRegistry != address(0), "seed: run DeployAqua first");
        require(m.dETH != address(0) && m.dUSD != address(0), "seed: run DeployTokens first");
        require(m.aquaRouter != address(0), "seed: manifest missing aquaRouter");

        bytes memory program = DemoStrategy.saltedProgram(DemoStrategy.programSalt(epoch, 0));
        bytes memory strategy = DemoStrategy.strategy(maker, program);

        // Mint 3x the commitment, then ship the commitment only.
        MockMintable(m.dETH).mint(maker, DemoStrategy.SEED_ETH * 3);
        MockMintable(m.dUSD).mint(maker, DemoStrategy.SEED_USD * 3);
        IERC20(m.dETH).approve(m.aquaRegistry, type(uint256).max);
        IERC20(m.dUSD).approve(m.aquaRegistry, type(uint256).max);

        address[] memory tokens = new address[](2);
        tokens[0] = m.dETH;
        tokens[1] = m.dUSD;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = DemoStrategy.SEED_ETH;
        amounts[1] = DemoStrategy.SEED_USD;

        bytes32 strategyHash = IAquaRegistry(m.aquaRegistry).ship(m.aquaRouter, strategy, tokens, amounts);
        vm.stopBroadcast();

        // Commitment-inventory invariant: wallet must cover the commitment.
        require(IERC20(m.dETH).balanceOf(maker) > DemoStrategy.SEED_ETH, "seed: dETH wallet must exceed commitment");
        require(IERC20(m.dUSD).balanceOf(maker) > DemoStrategy.SEED_USD, "seed: dUSD wallet must exceed commitment");

        m.maker = maker;
        m.strategyHash = strategyHash;
        m.strategy = strategy; // full abi.encode(Order) — CreateDemoPosition decodes this
        Manifest.write(Manifest.baseSepoliaPath(), m);

        console2.log("maker:", maker);
        console2.log("program:", vm.toString(program));
        console2.log("strategyHash:", vm.toString(strategyHash));
    }
}

interface MockMintable {
    function mint(address to, uint256 amount) external;
}
