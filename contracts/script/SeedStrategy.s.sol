// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IAquaRegistry} from "@/interfaces/IAquaRegistry.sol";
import {IAquaSwapVMRouter} from "@/interfaces/IAquaSwapVMRouter.sol";

/// @notice Seeds demo liquidity: mints demo tokens to the deployer (maker),
/// approves the Aqua registry, and ships an UNGATED xycSwapXD strategy
/// (program 0x1100 — deliberately WITHOUT the upstream KYC-gate opcode, per
/// the official "drop that instruction for a permissionless pool" path).
///
/// Safety invariant (docs/ARCHITECTURE.md section 4.4): total shipped stays
/// strictly below the maker wallet balance — Aqua virtual balances are
/// commitments, not escrow, so an over-committed strategy fails at fill.
///
/// Reads deployments/<chainId>.json written by DeploySlope.s.sol.
contract SeedStrategy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address maker = vm.addr(deployerKey);
        string memory json = vm.readFile(string.concat("deployments/", vm.toString(block.chainid), ".json"));
        address aquaRegistry = vm.parseJsonAddress(json, ".aquaRegistry");
        address aquaRouter = vm.parseJsonAddress(json, ".aquaRouter");
        address dETH = vm.parseJsonAddress(json, ".dETH");
        address dUSD = vm.parseJsonAddress(json, ".dUSD");

        // Maker strategy: ungated xycSwapXD ([opcode 0x11][argsLen 0x00]),
        // Aqua order traits bit 254 = useAquaInsteadOfSignature.
        bytes memory strategy = abi.encode(
            IAquaSwapVMRouter.Order({maker: maker, traits: 1 << 254, data: hex"1100"})
        );

        // Seed 1000 dETH against 3,000,000 dUSD -> 3000 dUSD per dETH.
        uint256 ethAmount = 1000 * 10 ** IERC20Metadata(dETH).decimals();
        uint256 usdAmount = 3_000_000 * 10 ** IERC20Metadata(dUSD).decimals();

        vm.startBroadcast(deployerKey);
        MockMintable(dETH).mint(maker, ethAmount * 3); // wallet > commitment
        MockMintable(dUSD).mint(maker, usdAmount * 3);
        IERC20(dETH).approve(aquaRegistry, type(uint256).max);
        IERC20(dUSD).approve(aquaRegistry, type(uint256).max);
        bytes32 strategyHash = IAquaRegistry(aquaRegistry).ship(
            aquaRouter,
            strategy,
            _addresses(dETH, dUSD),
            _amounts(ethAmount, usdAmount)
        );
        vm.stopBroadcast();

        require(IERC20(dETH).balanceOf(maker) > ethAmount, "maker dETH wallet must exceed commitment");
        require(IERC20(dUSD).balanceOf(maker) > usdAmount, "maker dUSD wallet must exceed commitment");

        string memory out = "seeding";
        vm.serializeBytes(out, "strategy", strategy);
        vm.serializeAddress(out, "maker", maker);
        string memory finalJson = vm.serializeBytes32(out, "strategyHash", strategyHash);
        string memory path = string.concat("deployments/", vm.toString(block.chainid), "-seed.json");
        vm.writeJson(finalJson, path);
        console2.log("strategyHash:", vm.toString(strategyHash));
        console2.log("seed manifest:", path);
    }

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

interface MockMintable {
    function mint(address to, uint256 amount) external;
}
