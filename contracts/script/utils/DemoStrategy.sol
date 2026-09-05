// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {TakerTraitsLib} from "swap-vm-libs/TakerTraits.sol";
import {IAquaSwapVMRouter} from "@/interfaces/IAquaSwapVMRouter.sol";

/// @title DemoStrategy
/// @notice Shared fixture for every script that touches the demo Aqua
/// strategy (SeedLiquidity, CreateDemoPosition, fork tests). All parties
/// must agree EXACTLY on the program, order tuple, traits, and taker blob —
/// one divergent value and fills fail with an error that does not point at
/// the cause.
/// @dev The strategy program is the minimal UNGATED xycSwapXD (`0x11` args
/// len `0x00`) followed by the SALT instruction (`0x14`, argsLen `0x08`,
/// uint64 salt): `[swap][salt][uint64]`. The salt is a pure hash
/// diversifier — the instruction is a no-op — and it makes every re-seed
/// produce a fresh strategyHash instead of colliding with a docked one.
library DemoStrategy {
    uint256 internal constant AQUA_ORDER_TRAITS = 1 << 254; // useAquaInsteadOfSignature
    bytes internal constant XYC_SWAP_XD = hex"1100"; // [opcode 0x11][argsLen 0x00]
    uint8 internal constant SALT_OPCODE = 0x14;
    uint8 internal constant SALT_ARGS_LEN = 8;

    // Seed size: 1000 dETH against 3,000,000 dUSD (~3000 per dETH).
    uint256 internal constant SEED_ETH = 1000e18;
    uint256 internal constant SEED_USD = 3_000_000e6;

    /// @dev The minimal UNGATED swap program: [opcode 0x11 = xycSwapXD]
    /// [argsLen 0x00]. Deliberately WITHOUT the upstream KYC-gate opcode.
    bytes internal constant PROGRAM = hex"1100";

    function tokens(address tokenA, address tokenB) internal pure returns (address[] memory v) {
        v = new address[](2);
        v[0] = tokenA;
        v[1] = tokenB;
    }

    function seedAmounts() internal pure returns (uint256[] memory v) {
        v = new uint256[](2);
        v[0] = SEED_ETH;
        v[1] = SEED_USD;
    }    /// @dev 64-bit salt derived from a label, an epoch, and a per-epoch
    /// index. A new epoch re-seeds into fresh, non-colliding strategies.
    function programSalt(uint64 epoch, uint256 index) internal pure returns (uint64) {
        return uint64(uint256(keccak256(abi.encode("slope-demo-strategy", epoch, index))));
    }

    /// @dev The strategy program with a salt baked in: the economics are
    /// identical for every salt; only strategyHash changes.
    function saltedProgram(uint64 salt) internal pure returns (bytes memory) {
        return abi.encodePacked(PROGRAM, SALT_OPCODE, SALT_ARGS_LEN, salt);
    }

    function order(address maker, bytes memory program)
        internal
        pure
        returns (IAquaSwapVMRouter.Order memory)
    {
        return IAquaSwapVMRouter.Order({maker: maker, traits: AQUA_ORDER_TRAITS, data: program});
    }

    function strategy(address maker, bytes memory program) internal pure returns (bytes memory) {
        return abi.encode(order(maker, program));
    }

    function strategyHash(address maker, bytes memory program) internal pure returns (bytes32) {
        return keccak256(strategy(maker, program));
    }

    /// @dev Exact-in taker blob: 22-byte header (slice offsets + flags
    /// 0x0041 = isExactIn | useTransferFromAndAquaPush) with an optional
    /// 32-byte minimum-output threshold. `minOut == 0` omits the threshold
    /// (quote-level checks remain); production routes embed the quoted
    /// output as the hard floor (SPEC OI-2, verified on the real router).
    /// The blob is taker-agnostic: recipient defaults to msg.sender.
    function takerBlob(uint256 minOut) internal pure returns (bytes memory) {
        return TakerTraitsLib.build(
            TakerTraitsLib.Args({
                taker: address(0),
                isExactIn: true,
                shouldUnwrapWeth: false,
                isStrictThresholdAmount: false,
                isFirstTransferFromTaker: false,
                useTransferFromAndAquaPush: true,
                threshold: minOut == 0 ? new bytes(0) : abi.encodePacked(minOut),
                to: address(0),
                deadline: 0,
                hasPreTransferInCallback: false,
                hasPreTransferOutCallback: false,
                preTransferInHookData: new bytes(0),
                postTransferInHookData: new bytes(0),
                preTransferOutHookData: new bytes(0),
                postTransferOutHookData: new bytes(0),
                preTransferInCallbackData: new bytes(0),
                preTransferOutCallbackData: new bytes(0),
                instructionsArgs: new bytes(0),
                signature: new bytes(0)
            })
        );
    }

}
