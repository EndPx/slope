// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {PriceMath} from "@/math/PriceMath.sol";

contract PriceMathTest is Test {
    function test_Normalize_WethToUsdc() external pure {
        // 1 WETH (18) in, 2500.123456 USDC (6) out -> 2500.123456e18.
        (bool ok, uint256 price) = PriceMath.tryNormalizePrice(2_500_123_456, 6, 1e18, 18);
        assertTrue(ok);
        assertEq(price, 2500123456 * 1e12);
    }

    function test_Normalize_UsdcToWeth() external pure {
        // 3000 USDC (6) in, 1 WETH (18) out -> (1/3000)e18, floored.
        (bool ok, uint256 price) = PriceMath.tryNormalizePrice(1e18, 18, 3000e6, 6);
        assertTrue(ok);
        assertEq(price, 333333333333333);
    }

    function test_Normalize_FloorsOnRoundingSensitiveCases() external pure {
        (bool ok, uint256 price) = PriceMath.tryNormalizePrice(1, 18, 3, 18);
        assertTrue(ok);
        assertEq(price, 333333333333333333);
    }

    function test_Normalize_DegenerateInputsReportNotOk() external pure {
        (bool okOut, ) = PriceMath.tryNormalizePrice(0, 6, 1e18, 18);
        assertFalse(okOut);
        (bool okIn, ) = PriceMath.tryNormalizePrice(1e18, 18, 0, 6);
        assertFalse(okIn);
    }

    function test_Normalize_ScaledOverflowReportsNotOkInsteadOfReverting() external pure {
        unchecked {
            uint256 huge = type(uint256).max;
            (bool ok, ) = PriceMath.tryNormalizePrice(huge, 6, 1e18, 18);
            assertFalse(ok);
        }
    }

    function test_Impact_RoundsUpAtTheBoundary() external pure {
        // (3000e18 - 2980e18) * 10000 / 3000e18 = 66.67 -> ceil = 67 bps.
        assertEq(PriceMath.priceImpactBps(3000e18, 2980e18), 67);
    }

    function test_Impact_IsZeroForFavorableOrFlatExecutions() external pure {
        assertEq(PriceMath.priceImpactBps(3000e18, 3100e18), 0);
        assertEq(PriceMath.priceImpactBps(3000e18, 3000e18), 0);
    }

    function testFuzz_ImpactCeilMatchesExactPlusOneWhenNotDivisible(uint256 refRaw, uint256 execRaw) external pure {
        uint256 ref = bound(refRaw, 1, 1e40);
        uint256 exec = bound(execRaw, 0, ref);
        uint256 bps = PriceMath.priceImpactBps(ref, exec);
        uint256 floored = (ref - exec) * 10_000 / ref;
        if ((ref - exec) * 10_000 % ref == 0) {
            assertEq(bps, floored);
        } else {
            assertEq(bps, floored + 1);
        }
    }
}
