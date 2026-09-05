// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {AquaRouter} from "aqua-0.1.0/src/AquaRouter.sol";
import {AquaSwapVMRouter} from "swap-vm/routers/AquaSwapVMRouter.sol";
import {SlopePosition} from "@/SlopePosition.sol";
import {MockERC20} from "@test/mocks/MockERC20.sol";
import {IAquaRegistry} from "@/interfaces/IAquaRegistry.sol";
import {IAquaSwapVMRouter} from "@/interfaces/IAquaSwapVMRouter.sol";

/// @notice One-command deployment of the full Slope demo stack:
///   1. Aqua registry (official 1inch aqua package 0.1.0 — the exact
///      version the pinned router v1.0.2 was built against)
///   2. AquaSwapVMRouter (official swap-vm tag v1.0.2)
///   3. Demo tokens dETH (18) and dUSD (6) — asymmetric decimals by design
///   4. SlopePosition
///   5. Liquidity seeding: mint to the maker, approve the registry, ship an
///      UNGATED xycSwapXD strategy (program 0x1100, no KYC-gate opcode),
///      commitment strictly below the maker wallet balance.
/// Writes deployments/<chainId>.json for frontend, keeper, and subgraph.
///
/// Signer: resolved by forge — pass `--keystore ~/.foundry/keystores/deployer`
/// (password prompted once) or `--private-key $PRIVATE_KEY`.
contract DeployAll is Script {
    struct Deployment {
        address deployer;
        address aquaRegistry;
        address aquaRouter;
        address weth;
        address dETH;
        address dUSD;
        address slopePosition;
        bytes32 strategyHash;
        uint256 blockNumber;
    }

    function run() external returns (Deployment memory d) {
        // msg.sender is the broadcaster forge resolved (--keystore or
        // --private-key). No secret ever touches this script.
        d = deploy(msg.sender, WETH_BASE_SEPOLIA, true, "deployments/");
    }

    /// @param weth is only stored by the router (unwrap target; unused
    /// because taker blobs never request unwrapping). Test-only entry point
    /// uses the same code path with an in-memory signer.
    function deploy(address deployer, address weth, bool writeManifest, string memory manifestDir)
        public
        returns (Deployment memory d)
    {
        vm.startBroadcast();

        d.deployer = deployer;
        d.weth = weth;
        d.aquaRegistry = address(new AquaRouter());
        d.aquaRouter = address(new AquaSwapVMRouter(d.aquaRegistry, weth, deployer, "AquaSwapVMRouter", "1.0.2"));
        d.dETH = address(new MockERC20("Demo ETH", "dETH", 18));
        d.dUSD = address(new MockERC20("Demo USD", "dUSD", 6));
        d.slopePosition = address(new SlopePosition());

        // Seed: 1000 dETH against 3,000,000 dUSD (~3000 per dETH).
        // Inventory is minted to the SHIPPER (msg.sender) — the maker whose
        // wallet fills will pull from — and the commitment stays strictly
        // below that wallet balance (commitments are not escrow).
        MockERC20(d.dETH).mint(msg.sender, 3000e18);
        MockERC20(d.dUSD).mint(msg.sender, 9_000_000e6);
        MockERC20(d.dETH).approve(d.aquaRegistry, type(uint256).max);
        MockERC20(d.dUSD).approve(d.aquaRegistry, type(uint256).max);
        bytes memory strategy =
            abi.encode(IAquaSwapVMRouter.Order({maker: msg.sender, traits: 1 << 254, data: hex"1100"}));
        address[] memory tokens = _addresses(d.dETH, d.dUSD);
        uint256[] memory amounts = _amounts(1000e18, 3_000_000e6);
        d.strategyHash = IAquaRegistry(d.aquaRegistry).ship(d.aquaRouter, strategy, tokens, amounts);
        d.blockNumber = vm.getBlockNumber();

        vm.stopBroadcast();

        if (writeManifest) {
            string memory json = "deployment";
            vm.serializeAddress(json, "deployer", d.deployer);
            vm.serializeAddress(json, "aquaRegistry", d.aquaRegistry);
            vm.serializeAddress(json, "aquaRouter", d.aquaRouter);
            vm.serializeAddress(json, "weth", weth);
            vm.serializeAddress(json, "dETH", d.dETH);
            vm.serializeAddress(json, "dUSD", d.dUSD);
            vm.serializeAddress(json, "slopePosition", d.slopePosition);
            vm.serializeBytes32(json, "strategyHash", d.strategyHash);
            vm.serializeString(json, "strategy", "0x1100"); // ungated xycSwapXD
            vm.serializeUint(json, "startBlock", d.blockNumber);
            string memory finalJson = vm.serializeUint(json, "chainId", block.chainid);
            string memory path = string.concat(manifestDir, vm.toString(block.chainid), ".json");
            vm.writeJson(finalJson, path);
            console2.log("manifest:", path);
        }

        console2.log("deployer:", deployer);
        console2.log("AquaRegistry:", d.aquaRegistry);
        console2.log("AquaSwapVMRouter:", d.aquaRouter);
        console2.log("dETH:", d.dETH);
        console2.log("dUSD:", d.dUSD);
        console2.log("SlopePosition:", d.slopePosition);
        console2.log("strategyHash:", vm.toString(d.strategyHash));
    }

    /// @dev Base Sepolia canonical WETH predeploy (same address as mainnet).
    address internal constant WETH_BASE_SEPOLIA = 0x4200000000000000000000000000000000000006;

    function _addresses(address a, address b) private pure returns (address[] memory v) {
        v = new address[](2);
        v[0] = a;
        v[1] = b;
    }

    function _amounts(uint256 a, uint256 b) private pure returns (uint256[] memory v) {
        v = new uint256[](2);
        v[0] = a;
        v[1] = b;
    }
}
