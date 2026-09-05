// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TakerTraitsLib} from "swap-vm-libs/TakerTraits.sol";

import {SlopePosition} from "@/SlopePosition.sol";
import {AquaRoute, CreateParams, CurveShape, Position} from "@/SlopeTypes.sol";
import {IAquaSwapVMRouter} from "@/interfaces/IAquaSwapVMRouter.sol";
import {IAquaRegistry} from "@/interfaces/IAquaRegistry.sol";
import {MockERC20} from "@test/mocks/MockERC20.sol";

/// @dev End-to-end validation against the OFFICIAL Aqua deployment on Base
/// mainnet (fork). Proves, with the real router and real pull/push flows:
///   OI-1  exact-in swaps consume the full requested input;
///   OI-2  the takerTraitsAndData threshold is a hard swap-level floor;
///   D     the probe floor notionals return meaningful quotes;
///   E     createPosition -> adaptiveExecute settles a real fill on-chain.
///
/// Requires an RPC endpoint for Base mainnet; defaults to the public one.
contract AquaBaseForkTest is Test {
    // Deterministic official deployments (identical across 13 chains).
    IAquaRegistry internal constant AQUA =
        IAquaRegistry(0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a);
    IAquaSwapVMRouter internal constant ROUTER =
        IAquaSwapVMRouter(0x111111338c5091E8440b67B168bAe16a668AC0De);
    uint256 internal constant AQUA_ORDER_TRAITS = 1 << 254; // useAquaInsteadOfSignature

    SlopePosition internal slope;
    MockERC20 internal dETH; // 18 decimals (tokenIn)
    MockERC20 internal dUSD; // 6 decimals (tokenOut)
    address internal maker = makeAddr("maker");
    address internal alice = makeAddr("alice");

    uint256 internal positionId;
    bytes internal makerStrategy;

    // Seeded strategy: 1000 dETH against 3,000,000 dUSD -> 3000 per 1.
    uint256 internal constant SEED_ETH = 1000e18;
    uint256 internal constant SEED_USD = 3_000_000e6;

    function setUp() public {
        // Fork Base mainnet; the public RPC keeps this runnable without keys.
        vm.createSelectFork(vm.envOr("BASE_MAINNET_RPC_URL", string("https://mainnet.base.org")));

        slope = new SlopePosition();
        dETH = new MockERC20("Demo ETH", "dETH", 18);
        dUSD = new MockERC20("Demo USD", "dUSD", 6);

        // Maker inventory covers both the virtual commitment and the real
        // wallet pull at fill time (virtual balances are commitments).
        dETH.mint(maker, SEED_ETH * 3);
        dUSD.mint(maker, SEED_USD * 3);
        dETH.mint(alice, 100e18);

        vm.startPrank(maker);
        dETH.approve(address(AQUA), type(uint256).max);
        dUSD.approve(address(AQUA), type(uint256).max);
        makerStrategy = abi.encode(
            IAquaSwapVMRouter.Order({maker: maker, traits: AQUA_ORDER_TRAITS, data: hex"1100"}) // ungated xycSwapXD
        );
        address[] memory tokens = new address[](2);
        tokens[0] = address(dETH);
        tokens[1] = address(dUSD);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = SEED_ETH;
        amounts[1] = SEED_USD;
        AQUA.ship(address(ROUTER), makerStrategy, tokens, amounts);
        vm.stopPrank();

        vm.startPrank(alice);
        dETH.approve(address(slope), type(uint256).max);
        positionId = slope.createPosition(
            CreateParams({
                tokenIn: address(dETH),
                tokenOut: address(dUSD),
                totalBudget: 10e18,
                minFillAmount: 1e17,
                duration: 1000,
                curveShape: CurveShape.NEUTRAL,
                minPrice: 1000e18,
                maxPrice: 5000e18,
                maxSlippageBps: 500
            }),
            AquaRoute({
                router: ROUTER,
                order: IAquaSwapVMRouter.Order({maker: maker, traits: AQUA_ORDER_TRAITS, data: hex"1100"}),
                takerTraitsAndData: _takerBlob(1) // minimal floor; OI-2 refines
            })
        );
        vm.stopPrank();
    }

    /// @dev Builds the opaque taker blob with the official library layout:
    /// 22-byte header (slice offsets + flags) + optional 32-byte threshold.
    /// Flags: isExactIn | useTransferFromAndAquaPush (0x0041). Test-only
    /// use of the upstream lib; production blobs come from the TS SDK at
    /// route-update time.
    function _takerBlob(uint256 minOut) internal view returns (bytes memory) {
        return TakerTraitsLib.build(
            TakerTraitsLib.Args({
                taker: address(slope),
                isExactIn: true,
                shouldUnwrapWeth: false,
                isStrictThresholdAmount: false,
                isFirstTransferFromTaker: false,
                useTransferFromAndAquaPush: true,
                threshold: minOut == 0 ? new bytes(0) : abi.encodePacked(minOut),
                to: address(0), // defaults to the taker (SlopePosition), which sweeps to the owner
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

    function _order() internal view returns (IAquaSwapVMRouter.Order memory) {
        return IAquaSwapVMRouter.Order({maker: maker, traits: AQUA_ORDER_TRAITS, data: hex"1100"});
    }

    // ------------------------------------------------------------------
    // D — probe floor against the REAL router
    // ------------------------------------------------------------------

    function test_Fork_ProbeFloorReturnsMeaningfulQuotesOnRealRouter() external {
        (, uint256 out18, ) = ROUTER.quote(_order(), address(dETH), address(dUSD), 1e14, _takerBlob(0));
        (, uint256 out6, ) = ROUTER.quote(_order(), address(dUSD), address(dETH), 100, _takerBlob(0));
        assertGt(out18, 0); // 0.0001 dETH probe
        assertGt(out6, 0); // 0.0001 dUSD probe
    }

    // ------------------------------------------------------------------
    // C — OPEN ITEM OI-1: exact-in consumes the full requested input
    // ------------------------------------------------------------------

    function test_Fork_ExactInConsumesFullInputOnRealRouter() external {
        (uint256 virtualEthBefore, ) = AQUA.rawBalances(maker, address(ROUTER), keccak256(makerStrategy), address(dETH));
        uint256 aliceEthBefore = dETH.balanceOf(alice);

        vm.warp(block.timestamp + 200); // NEUTRAL: 20% of the 10e18 budget = 2e18 authorized
        assertTrue(slope.adaptiveExecute(positionId, 2e18)); // fill 2 dETH

        (uint256 virtualEthAfter, ) = AQUA.rawBalances(maker, address(ROUTER), keccak256(makerStrategy), address(dETH));
        // OI-1: the pushed input equals the requested fill exactly — nothing
        // was partially consumed — so executedAmount += fillAmount is exact.
        assertEq(virtualEthAfter - virtualEthBefore, 2e18);
        // The taker's wallet paid exactly the fill, not a wei more.
        assertEq(aliceEthBefore - dETH.balanceOf(alice), 2e18);
    }

    // ------------------------------------------------------------------
    // C — OPEN ITEM OI-2: threshold is a hard swap-level floor
    // ------------------------------------------------------------------

    function test_Fork_ThresholdAboveQuote_RevertsAtSwapLevel() external {
        vm.warp(block.timestamp + 100);
        (, uint256 quotedOut, ) = ROUTER.quote(_order(), address(dETH), address(dUSD), 1e18, _takerBlob(0));
        // Direct-router probe: a threshold above the achievable output must
        // be enforced by the swap itself, not only by the pre-swap quote.
        vm.startPrank(alice);
        dETH.approve(address(ROUTER), type(uint256).max);
        bytes memory impossible = _takerBlob(quotedOut + 1);
        vm.expectRevert();
        ROUTER.swap(_order(), address(dETH), address(dUSD), 1e18, impossible);
        vm.stopPrank();

        // The same fill with an achievable threshold succeeds.
        vm.startPrank(alice);
        bytes memory achievable = _takerBlob(quotedOut);
        ROUTER.swap(_order(), address(dETH), address(dUSD), 1e18, achievable);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // E — full taker flow through the REAL router
    // ------------------------------------------------------------------

    function test_Fork_EndToEnd_CreateThenFillThroughRealRouter() external {
        uint256 aliceUsdBefore = dUSD.balanceOf(alice);
        vm.warp(block.timestamp + 100);
        assertTrue(slope.adaptiveExecute(positionId, 1e18));

        (Position memory p, ) = slope.getPosition(positionId);
        assertEq(p.executedAmount, 1e18);
        // Real proceeds arrived at the owner; nothing stuck in the contract.
        assertGt(dUSD.balanceOf(alice), aliceUsdBefore);
        assertEq(dUSD.balanceOf(address(slope)), 0);
        assertEq(dETH.balanceOf(address(slope)), 0);
        // Sanity: ~3000 dUSD per dETH inside the declared bounds.
        assertGe(dUSD.balanceOf(alice) - aliceUsdBefore, 2900e6);
        assertLe(dUSD.balanceOf(alice) - aliceUsdBefore, 3100e6);
    }
}
