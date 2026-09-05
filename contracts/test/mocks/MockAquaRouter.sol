// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAquaSwapVMRouter} from "src/interfaces/IAquaSwapVMRouter.sol";

/// @dev Deterministic AquaSwapVMRouter stand-in for the step-1 milestone.
/// Pricing is a fixed WAD ratio (tokenOut raw per tokenIn raw, WAD-scaled).
/// `largeFillPenaltyBps` is applied to quotes at or above
/// `largeFillThreshold` only, which makes the probe-versus-execution price
/// difference (and therefore the impact check) observable and testable.
/// Step 3 replaces this contract with the deployed official router; the
/// interface shape is identical.
contract MockAquaRouter is IAquaSwapVMRouter {
    uint256 public priceWad = 1e18;
    uint256 public largeFillThreshold = 10e18;
    uint256 public largeFillPenaltyBps = 0;
    uint256 public zeroQuoteBelow = 0;

    function setPriceWad(uint256 priceWad_) external {
        priceWad = priceWad_;
    }

    function setLargeFillPenalty(uint256 threshold, uint256 penaltyBps) external {
        largeFillThreshold = threshold;
        largeFillPenaltyBps = penaltyBps;
    }

    function setZeroQuoteBelow(uint256 threshold) external {
        zeroQuoteBelow = threshold;
    }

    function quote(
        IAquaSwapVMRouter.Order calldata,
        address,
        address,
        uint256 amount,
        bytes calldata
    ) external view returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash) {
        amountOut = _quote(amount);
        return (amount, amountOut, bytes32(uint256(1)));
    }

    function swap(
        IAquaSwapVMRouter.Order calldata,
        address tokenIn,
        address tokenOut,
        uint256 amount,
        bytes calldata
    ) external returns (uint256 amountIn, uint256 amountOut, bytes32 orderHash) {
        amountOut = _quote(amount);
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amount);
        IERC20(tokenOut).transfer(msg.sender, amountOut);
        return (amount, amountOut, bytes32(uint256(1)));
    }

    function _quote(uint256 amount) internal view returns (uint256) {
        if (amount < zeroQuoteBelow) return 0;
        uint256 amountOut = Math.mulDiv(amount, priceWad, 1e18);
        if (amount >= largeFillThreshold && largeFillPenaltyBps > 0) {
            amountOut -= Math.mulDiv(amountOut, largeFillPenaltyBps, 10_000);
        }
        return amountOut;
    }
}
