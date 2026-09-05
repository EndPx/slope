// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {AquaRouter} from "aqua-0.1.0/src/AquaRouter.sol";
import {AquaSwapVMRouter} from "swap-vm/routers/AquaSwapVMRouter.sol";
import {Manifest} from "./utils/Manifest.sol";

/// @notice One-time deployment of the official Aqua infrastructure from the
/// pinned v1.0.2 sources: the registry (from the 1inch/aqua 0.1.0 package
/// — the exact version the pinned router was built against) and the
/// AquaSwapVMRouter. Results land in the shared manifest; everything
/// downstream reads them from there.
contract DeployAqua is Script {
    /// @dev Base Sepolia canonical WETH predeploy (same address as mainnet);
    /// stored by the router as the unwrap target (unused by our taker blobs).
    address internal constant WETH = 0x4200000000000000000000000000000000000006;

    function run() external {
        uint256 key = vm.envOr("PRIVATE_KEY", uint256(0));
        address deployer = key != 0 ? vm.addr(key) : msg.sender;
        if (key != 0) vm.startBroadcast(key);
        else vm.startBroadcast();
        address registry = address(new AquaRouter());
        address router = address(new AquaSwapVMRouter(registry, WETH, deployer, "AquaSwapVMRouter", "1.0.2"));

        vm.stopBroadcast();

        Manifest.Data memory m = Manifest.read(Manifest.baseSepoliaPath());
        m.chainId = block.chainid;
        m.networkName = "Base Sepolia";
        m.publicRpcUrl = "https://sepolia.base.org";
        m.explorerUrl = "https://sepolia.basescan.org";
        m.deployer = deployer;
        m.aquaRegistry = registry;
        m.aquaRouter = router;
        m.sourceCommit = vm.envOr("SOURCE_COMMIT", string(""));
        m.deployedAt = vm.envOr("DEPLOYED_AT", string(""));
        Manifest.write(Manifest.baseSepoliaPath(), m);

        console2.log("AquaRegistry:", registry);
        console2.log("AquaSwapVMRouter:", router);
        console2.log("manifest updated:", Manifest.baseSepoliaPath());
    }
}
