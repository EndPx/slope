# Deployment Runbook & Provenance

Everything deployed for the Slope demo, with the exact sources it was built from and the on-chain evidence that the deployments match those sources. The single source of truth for addresses is [`contracts/deployments/base-sepolia.json`](../contracts/deployments/base-sepolia.json); frontend, keeper, and the subgraph all read it.

## Live deployment — Base Sepolia (chainId 84532)

**All five contracts are source-verified on Basescan** (2026-09-06) — judges can read the exact sources on the explorer:

| Contract | Address | Verification |
| --- | --- | --- |
| AquaRegistry (`AquaRouter`, official aqua package 0.1.0) | [`0xd2A8f6D7645F53aB23dC3EcB146a196026F964DA`](https://sepolia.basescan.org/address/0xd2A8f6D7645F53aB23dC3EcB146a196026F964DA#code) | ✅ verified |
| AquaSwapVMRouter (official swap-vm tag `v1.0.2`) | [`0x054F6A7CE03fdEB7814977B0FE7017cc5B2d7DA2`](https://sepolia.basescan.org/address/0x054F6A7CE03fdEB7814977B0FE7017cc5B2d7DA2#code) | ✅ verified (constructor args: registry, WETH, owner, `"AquaSwapVMRouter"`, `"1.0.2"`) |
| dETH demo token (18 dec) | [`0xD524e3d9E7f0B419A862B4Ad854422d573B5D651`](https://sepolia.basescan.org/address/0xD524e3d9E7f0B419A862B4Ad854422d573B5D651#code) | ✅ verified |
| dUSD demo token (6 dec) | [`0x06A41268C8cA9d5ADa19b02a8E2f37A0195dC49c`](https://sepolia.basescan.org/address/0x06A41268C8cA9d5ADa19b02a8E2f37A0195dC49c#code) | ✅ verified |
| SlopePosition | [`0xC7c6FaD1C2A0e8961E34D40c39C059ECE6dBB8Cc`](https://sepolia.basescan.org/address/0xC7c6FaD1C2A0e8961E34D40c39C059ECE6dBB8Cc#code) | ✅ verified |

Reproduce verification with `forge verify-contract --chain-id 84532 --compiler-version 0.8.30 --num-of-optimizations 1000 --evm-version cancun --via-ir` using the contract identifiers recorded below (source keys match the build's `compilationTarget` exactly — the registry lives at `lib/swap-vm/node_modules/@1inch/aqua/src/AquaRouter.sol`, the path where the router's own lockfile pins `@1inch/aqua@0.1.0`). The Etherscan API key is kept outside the repository (`~/.etherscan-key`, chmod 600) and is never committed.

| Contract | Address | Deployment tx |
| --- | --- | --- |
| AquaRegistry (`AquaRouter`, official aqua package 0.1.0) | `0xd2A8f6D7645F53aB23dC3EcB146a196026F964DA` | `0x38db6f7e025fbc1c9559e3560b0ac1c960564abd6a12687c145173d076b55d0f` |
| AquaSwapVMRouter (official swap-vm tag `v1.0.2`) | `0x054F6A7CE03fdEB7814977B0FE7017cc5B2d7DA2` | `0xe6ae208169c04007370d8af21b2d9497d8e646b5069b6a090adda4643e6b1c51` |
| dETH demo token (18 dec) | `0xD524e3d9E7f0B419A862B4Ad854422d573B5D651` | `0x5a98ad3a879cb427fa3b907258c1efa77ba5d1b45bb8763630e81cbf0d2f7d5f` |
| dUSD demo token (6 dec) | `0x06A41268C8cA9d5ADa19b02a8E2f37A0195dC49c` | `0x79a6ae7dd0ea86f39a38f12c1e7a873f918a6a1de7ff00ff36b98e46746194eb` |
| SlopePosition | `0xC7c6FaD1C2A0e8961E34D40c39C059ECE6dBB8Cc` | `0x35252728034939ae40e4eba187191172c3da5174d21531cc7dfd754f45dcd01c` |
| SlopePosition deployment block (**subgraph startBlock**) | block `46418713` | — |

Liquidity seeding (maker = deployer = `0xc82f469Aa95a2f7792300c8d11230e9023A98600`):

| Action | tx |
| --- | --- |
| Mint dETH ×3 seed | `0x763821b7450cdc8e2867115ab7a327c8e030fbd682e9b305b4491ce1fa882d36` |
| Mint dUSD ×3 seed | `0x7ccf3f765b87d6ebfe3ad9f22a35078995a6a5408a700835343664147b583bb4` |
| Approve dETH / dUSD to registry | `0x783d0384…` / `0x4e5231e5…` |
| **Ship UNGATED strategy** (hash `0x4a4ffe294877219b0438c8ad16ef5ff405a523c95bf5225f56b354507657c8db`) | `0x8e60342e0a1e1b76ab327580ab54414d880236adb528503b7928a1e985deab8e` |
| Create demo position #1 (10 dETH, NEUTRAL, 1000 s) | `0x7a107c65058c33088baf35a3c6ebde328ed23129e541624acfa39b330fee32c2` |

### On-chain execution evidence (the 1inch prize requirement)

- **Terminal settlement fill** — position #1, after its window: exactly **10 dETH in → 29,702.97 dUSD out** through the official pull/push flow, `FillExecuted` + `PositionCompleted`: tx [`0x3ca31dd7488ad4303a5822bed5c085a95dc8b71c329336e72528421430b28c70`](https://sepolia.basescan.org/tx/0x3ca31dd7488ad4303a5822bed5c085a95dc8b71c329336e72528421430b28c70).
- **Natural mid-window fill** — position #2, created and filled while the curve was live (elapsed ≈ 55 s of 1000): exactly **0.5 dETH in → 1,469.72 dUSD out**, `executedAmount = 0.5e18`, position still **active** (no completion event): tx [`0xf46ae64daeeca8a51e98ebbdad4e1b63832cc87e12ca2122cca92684c4c555a6`](https://sepolia.basescan.org/tx/0xf46ae64daeeca8a51e98ebbdad4e1b63832cc87e12ca2122cca92684c4c555a6). Price 2939.43 dUSD/dETH is consistent with the spot after fill #1 moved the shared-liquidity state (~2941) — the curve math tracks reality.
- Post-fill maker virtual balance: 1010.5 dETH (1000 seed + 10 + 0.5 pushed) — exactly the sum of both fills.

## Source provenance (what the deployed bytecode was built from)

Everything is traceable from this repository — no local-only sources:

1. **Registry** — built from the `@1inch/aqua` **npm package version 0.1.0**, which is pinned by the router's own repo: `contracts/lib/swap-vm/package.json` (`"@1inch/aqua": "github:1inch/aqua#0.1.0"`, locked in `yarn.lock`). Constructor: `AquaRouter()` (no args, no owner in this version).
2. **Router** — built from the pinned submodule `contracts/lib/swap-vm` at git tag **`v1.0.2`** (submodule commit `32c687c2b73101fc26549e48fa1ff8a4d73afbac`). Constructor: `AquaSwapVMRouter(registry, WETH, owner, "AquaSwapVMRouter", "1.0.2")` with `WETH = 0x4200000000000000000000000000000000000006` (Base canonical predeploy; unwrap target — inert because our taker blobs never request unwrapping).
3. **SlopePosition, tokens, scripts** — this repository, `contracts/src` + `contracts/script`, built with the committed `contracts/foundry.toml`: **solc 0.8.30, `via_ir = true`, `evm_version = cancun`** (required by the SwapVM opcode table), OpenZeppelin v5.4.0 and forge-std v1.11.0 as pinned submodules.

### Bytecode verification (2026-09-06)

Runtime code on-chain compared against a local build of exactly these sources:

- `AquaRouter`, `SlopePosition`, `MockERC20` (dETH): **byte-identical** runtime bytecode.
- `AquaSwapVMRouter`: identical length (41,040 hex chars); the only differences are the 37 **constructor-immutable regions** — the registry address (`0xd2a8f6…`, embedded at each reference site), the router's own address, the ASCII strings `"AquaSwapVMRouter"` / `"1.0.2"`, and hashes derived from those constructor arguments. All immutables match the recorded constructor inputs.

Reproduce with: clone this repo → `git submodule update --init` → inside `contracts/lib/swap-vm`: `npm install` (pins `@1inch/aqua@0.1.0`) → `forge build` in `contracts/` → compare `out/*.sol/*.json` `deployedBytecode` against `cast code <address>`.

## Runbook (re-run any stage independently)

Signer: the foundry keystore account (`--account deployer --password-file ~/.foundry/pw`). Run from a **native filesystem** (WSL `~/slope-live` copy of `contracts/`) — broadcasting from `/mnt/*` (Windows DrvFs) fails on forge's broadcast-archive writes (EPERM) **before** transactions are sent. Two compounding causes in our setup: the repository path contains **spaces** (`Hackacton yang masih jalan`), a classic tooling hazard, and DrvFs' permission layer is unreliable for the copy/rename operations forge performs on its broadcast artifacts. The native-FS copy is byte-identical to the repo (same sources, same pinned submodules), so provenance is unaffected; the repo remains the canonical source of truth.

```bash
cd ~/slope-live   # native-FS copy of contracts/ (sources identical to the repo)
forge script script/DeployAqua.s.sol        --rpc-url https://sepolia.base.org --account deployer --password-file ~/.foundry/pw --broadcast --slow
forge script script/DeployTokens.s.sol      --rpc-url https://sepolia.base.org --account deployer --password-file ~/.foundry/pw --broadcast --slow
forge script script/DeploySlope.s.sol       --rpc-url https://sepolia.base.org --account deployer --password-file ~/.foundry/pw --broadcast --slow
forge script script/SeedLiquidity.s.sol     --rpc-url https://sepolia.base.org --account deployer --password-file ~/.foundry/pw --broadcast --slow   # re-runnable: set EPOCH=<unix time> for a fresh salted strategyHash
forge script script/CreateDemoPosition.s.sol --rpc-url https://sepolia.base.org --account deployer --password-file ~/.foundry/pw --broadcast --slow
```

Every script reads and updates the one manifest (`deployments/base-sepolia.json`), so stages run independently without copying addresses. After re-seeding, update the taker route with `updateRoute` (position owner) to point at the new strategy hash.

## Known deployment-forensics note

During test development, `vm.startBroadcast()` was briefly used **inside fork tests**. With a remote fork RPC this signs real transactions — ours were never included on-chain (verified: every deterministic deployment address from those runs has zero bytecode on-chain, and the real registry/SlopePosition event logs contain only the transactions listed above; the maker nonce of 16 equals exactly the legit deployment + fill transactions). Broadcast-in-test has been removed from the suite: all fork tests are impersonated (`vm.prank`), and broadcasting now happens only through the scripts above with the keystore signer.
