// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";

/// @title Manifest
/// @notice Read/update/write helpers for the ONE shared deployment state
/// file (deployments/base-sepolia.json). Every deployment/seeding script
/// loads it, fills in its own fields, and writes it back — so the pipeline
/// can be run stage by stage without copying addresses by hand. Frontend,
/// keeper, and subgraph consume the same file. Structure stays FLAT: one
/// core contract, one target chain.
library Manifest {
    // Vm constant so scripts do not have to thread the cheatcode around.
    Vm internal constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct Data {
        uint256 chainId;
        string networkName;
        string publicRpcUrl;
        string explorerUrl;
        address deployer;
        address aquaRegistry;
        address aquaRouter;
        address dETH;
        address dUSD;
        address slopePosition;
        uint256 slopePositionBlock;
        bytes32 slopePositionTx;
        address maker;
        bytes32 strategyHash;
        bytes strategy;
        uint256 demoPositionId;
        address demoTaker;
        string sourceCommit;
        string deployedAt; // ISO 8601
        uint256 updatedAt; // epoch seconds, machine-readable
    }

    function baseSepoliaPath() internal view returns (string memory) {
        return string.concat(VM.projectRoot(), "/deployments/base-sepolia.json");
    }

    function read(string memory path) internal view returns (Data memory m) {
        string memory json;
        try VM.readFile(path) returns (string memory content) {
            json = content;
        } catch {
            return m; // first run: empty file, all defaults
        }
        try VM.parseJsonUint(json, ".chainId") returns (uint256 v) {
            m.chainId = v;
        } catch {}
        try VM.parseJsonString(json, ".networkName") returns (string memory v) {
            m.networkName = v;
        } catch {}
        try VM.parseJsonString(json, ".publicRpcUrl") returns (string memory v) {
            m.publicRpcUrl = v;
        } catch {}
        try VM.parseJsonString(json, ".explorerUrl") returns (string memory v) {
            m.explorerUrl = v;
        } catch {}
        try VM.parseJsonAddress(json, ".deployer") returns (address v) {
            m.deployer = v;
        } catch {}
        try VM.parseJsonAddress(json, ".aquaRegistry") returns (address v) {
            m.aquaRegistry = v;
        } catch {}
        try VM.parseJsonAddress(json, ".aquaRouter") returns (address v) {
            m.aquaRouter = v;
        } catch {}
        try VM.parseJsonAddress(json, ".dETH") returns (address v) {
            m.dETH = v;
        } catch {}
        try VM.parseJsonAddress(json, ".dUSD") returns (address v) {
            m.dUSD = v;
        } catch {}
        try VM.parseJsonAddress(json, ".slopePosition") returns (address v) {
            m.slopePosition = v;
        } catch {}
        try VM.parseJsonUint(json, ".slopePositionBlock") returns (uint256 v) {
            m.slopePositionBlock = v;
        } catch {}
        try VM.parseJsonBytes32(json, ".slopePositionTx") returns (bytes32 v) {
            m.slopePositionTx = v;
        } catch {}
        try VM.parseJsonAddress(json, ".maker") returns (address v) {
            m.maker = v;
        } catch {}
        try VM.parseJsonBytes32(json, ".strategyHash") returns (bytes32 v) {
            m.strategyHash = v;
        } catch {}
        try VM.parseJsonBytes(json, ".strategy") returns (bytes memory v) {
            m.strategy = v;
        } catch {}
        try VM.parseJsonUint(json, ".demoPositionId") returns (uint256 v) {
            m.demoPositionId = v;
        } catch {}
        try VM.parseJsonAddress(json, ".demoTaker") returns (address v) {
            m.demoTaker = v;
        } catch {}
        try VM.parseJsonString(json, ".sourceCommit") returns (string memory v) {
            m.sourceCommit = v;
        } catch {}
        try VM.parseJsonString(json, ".deployedAt") returns (string memory v) {
            m.deployedAt = v;
        } catch {}
        try VM.parseJsonUint(json, ".updatedAt") returns (uint256 v) {
            m.updatedAt = v;
        } catch {}
    }

    function write(string memory path, Data memory m) internal {
        require(m.chainId != 0, "manifest: chainId required (set on first write)");
        string memory json = "manifest";
        VM.serializeUint(json, "chainId", m.chainId);
        VM.serializeString(json, "networkName", m.networkName);
        VM.serializeString(json, "publicRpcUrl", m.publicRpcUrl);
        VM.serializeString(json, "explorerUrl", m.explorerUrl);
        VM.serializeAddress(json, "deployer", m.deployer);
        VM.serializeAddress(json, "aquaRegistry", m.aquaRegistry);
        VM.serializeAddress(json, "aquaRouter", m.aquaRouter);
        VM.serializeAddress(json, "dETH", m.dETH);
        VM.serializeAddress(json, "dUSD", m.dUSD);
        VM.serializeAddress(json, "slopePosition", m.slopePosition);
        VM.serializeUint(json, "slopePositionBlock", m.slopePositionBlock);
        VM.serializeBytes32(json, "slopePositionTx", m.slopePositionTx);
        VM.serializeAddress(json, "maker", m.maker);
        VM.serializeBytes32(json, "strategyHash", m.strategyHash);
        VM.serializeBytes(json, "strategy", m.strategy);
        VM.serializeUint(json, "demoPositionId", m.demoPositionId);
        VM.serializeAddress(json, "demoTaker", m.demoTaker);
        VM.serializeString(json, "sourceCommit", m.sourceCommit);
        VM.serializeString(json, "deployedAt", m.deployedAt);
        string memory finalJson = VM.serializeUint(json, "updatedAt", block.timestamp);
        VM.writeJson(finalJson, path);
    }
}
