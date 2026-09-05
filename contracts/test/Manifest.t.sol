// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Manifest} from "../script/utils/Manifest.sol";

/// @dev Round-trip contract for the shared manifest: write -> read -> write
/// must preserve every field, and the strategy bytes key must be symmetric
/// (regression: read/write once used different JSON keys, so m.strategy
/// came back empty after every round-trip).
contract ManifestTest is Test {
    function test_RoundTrip_PreservesAllFields() external {
        string memory path = "deployments/test-roundtrip.json";
        Manifest.Data memory m;
        m.chainId = 84532;
        m.networkName = "Base Sepolia";
        m.publicRpcUrl = "https://sepolia.base.org";
        m.explorerUrl = "https://sepolia.basescan.org";
        m.deployer = makeAddr("deployer");
        m.aquaRegistry = makeAddr("registry");
        m.aquaRouter = makeAddr("router");
        m.dETH = makeAddr("deth");
        m.dUSD = makeAddr("dusd");
        m.slopePosition = makeAddr("slope");
        m.slopePositionBlock = 46418713;
        m.slopePositionTx = bytes32(uint256(0x1234));
        m.maker = makeAddr("maker");
        m.strategyHash = bytes32(uint256(0x5678));
        m.strategy = hex"11001408deadbeef";
        m.demoPositionId = 2;
        m.demoTaker = makeAddr("taker");
        m.sourceCommit = "abc123";
        m.deployedAt = "2026-09-05T10:55:14Z";

        Manifest.write(path, m);
        Manifest.Data memory back = Manifest.read(path);

        assertEq(back.chainId, m.chainId);
        assertEq(back.networkName, m.networkName);
        assertEq(back.explorerUrl, m.explorerUrl);
        assertEq(back.aquaRouter, m.aquaRouter);
        assertEq(back.slopePositionBlock, m.slopePositionBlock);
        assertEq(back.slopePositionTx, m.slopePositionTx);
        assertEq(back.strategyHash, m.strategyHash);
        // BUG 1 regression: strategy bytes must survive the round-trip.
        assertEq(back.strategy, m.strategy);
        assertEq(uint256(back.demoPositionId), 2);
        assertEq(back.sourceCommit, m.sourceCommit);
        assertEq(back.deployedAt, m.deployedAt);

        vm.removeFile(path);
    }
}
