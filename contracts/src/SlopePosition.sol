// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {CurveMath} from "./math/CurveMath.sol";
import {PriceMath} from "./math/PriceMath.sol";
import {IAquaSwapVMRouter} from "./interfaces/IAquaSwapVMRouter.sol";
import {
    AquaRoute,
    CreateParams,
    CurveShape,
    ISlopeEvents,
    Position,
    SkipReason,
    SlopeErrors
} from "./SlopeTypes.sol";

/// @title SlopePosition
/// @notice Taker-side adaptive execution (docs/PRODUCT_SPEC.md). A position
/// is a bounded time-curve execution policy: the schedule is the only thing
/// that authorizes amounts, custody is pull-per-fill (no escrow, no refund
/// path), and every fill settles through the official 1inch Aqua router.
///
/// Execution is permissionless by design — any caller produces the same
/// state transition, and the caller's `maxAmountIn` can only tighten what
/// the curve authorizes, never exceed it.
contract SlopePosition is ISlopeEvents, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant WAD = 1e18;
    uint256 private constant PROBE_DENOMINATOR = 1000;

    uint256 private _nextPositionId = 1;
    mapping(uint256 positionId => Position) private _positions;
    mapping(uint256 positionId => AquaRoute) private _routes;

    /// @notice Creates a position. The token allowance of `msg.sender` to
    /// this contract must cover `params.totalBudget` before the first fill —
    /// funds are pulled per fill at execution time, never escrowed.
    function createPosition(
        CreateParams calldata params,
        AquaRoute calldata route
    ) external returns (uint256 positionId) {
        if (
            params.tokenIn == address(0) || params.tokenOut == address(0)
                || params.tokenIn == params.tokenOut
        ) revert SlopeErrors.InvalidToken();
        if (params.totalBudget == 0) revert SlopeErrors.InvalidBudget();
        if (params.minFillAmount == 0 || params.minFillAmount > params.totalBudget) {
            revert SlopeErrors.InvalidMinFill();
        }
        if (params.duration == 0) revert SlopeErrors.InvalidDuration();
        // The step-2 milestone adds AGGRESSIVE and CONSERVATIVE.
        if (params.curveShape != CurveShape.NEUTRAL) revert SlopeErrors.UnsupportedShape();
        if (params.minPrice == 0 || params.minPrice >= params.maxPrice) revert SlopeErrors.InvalidBounds();
        if (params.maxSlippageBps == 0) revert SlopeErrors.InvalidSlippage();
        if (route.router == IAquaSwapVMRouter(address(0)) || route.order.maker == address(0)) {
            revert SlopeErrors.InvalidRoute();
        }

        uint8 decimalsIn = IERC20Metadata(params.tokenIn).decimals();
        uint8 decimalsOut = IERC20Metadata(params.tokenOut).decimals();
        if (decimalsIn > 18 || decimalsOut > 18) revert SlopeErrors.InvalidDecimals();

        positionId = _nextPositionId++;
        _positions[positionId] = Position({
            owner: msg.sender,
            tokenIn: params.tokenIn,
            tokenOut: params.tokenOut,
            decimalsIn: decimalsIn,
            decimalsOut: decimalsOut,
            totalBudget: params.totalBudget,
            executedAmount: 0,
            minFillAmount: params.minFillAmount,
            startTimestamp: block.timestamp,
            duration: params.duration,
            curveShape: params.curveShape,
            minPrice: params.minPrice,
            maxPrice: params.maxPrice,
            maxSlippageBps: params.maxSlippageBps,
            isActive: true
        });
        _routes[positionId] = route;

        emit PositionCreated(
            positionId,
            msg.sender,
            params.tokenIn,
            params.tokenOut,
            decimalsIn,
            decimalsOut,
            params.totalBudget,
            params.minFillAmount,
            params.duration,
            params.curveShape,
            params.minPrice,
            params.maxPrice,
            params.maxSlippageBps
        );
    }

    /// @notice Replaces the Aqua execution target (SPEC Decision 13).
    /// Owner-only; changing the route never changes what the curve
    /// authorizes — the schedule, bounds, and impact checks apply unchanged.
    function updateRoute(uint256 positionId, AquaRoute calldata route) external {
        Position storage p = _positions[positionId];
        if (msg.sender != p.owner) revert SlopeErrors.NotOwner();
        if (!p.isActive) revert SlopeErrors.PositionNotActive();
        if (route.router == IAquaSwapVMRouter(address(0)) || route.order.maker == address(0)) {
            revert SlopeErrors.InvalidRoute();
        }
        _routes[positionId] = route;
        emit RouteUpdated(positionId);
    }

    /// @notice Deactivates the position. Nothing is refunded: with
    /// pull-per-fill custody the unexecuted budget never left the wallet.
    function cancel(uint256 positionId) external {
        Position storage p = _positions[positionId];
        if (msg.sender != p.owner) revert SlopeErrors.NotOwner();
        if (!p.isActive) revert SlopeErrors.PositionNotActive();
        p.isActive = false;
        emit PositionCancelled(positionId);
    }

    /// @notice Executes one fill of `positionId`, bounded by the curve
    /// schedule and by `maxAmountIn`. Permissionless. Returns true when a
    /// fill settled; emits `PositionSkipped` with a reason otherwise.
    /// Reverts only for genuinely invalid states: inactive (cancelled or
    /// completed) and expired positions.
    function adaptiveExecute(uint256 positionId, uint256 maxAmountIn)
        external
        nonReentrant
        returns (bool)
    {
        Position storage p = _positions[positionId];
        if (!p.isActive) revert SlopeErrors.PositionNotActive();
        AquaRoute storage r = _routes[positionId];

        // Schedule (docs/MATH_SPEC.md section 3-4, REVISION 3). `duration`
        // is the execution schedule, not a forfeiture deadline: past the
        // window the schedule is clamped at 100% and the exact remainder
        // stays executable until the budget is exhausted — nothing is ever
        // forfeited, and the position completes whenever the last unit
        // actually executes.
        uint256 elapsed = block.timestamp - p.startTimestamp;
        uint256 scheduleElapsed = elapsed < p.duration ? elapsed : p.duration;
        uint256 progress_ = CurveMath.progress(scheduleElapsed, p.duration, p.curveShape);
        uint256 authorizedCumulative = scheduleElapsed == p.duration
            ? p.totalBudget
            : Math.mulDiv(p.totalBudget, progress_, WAD);
        uint256 authorizedNow = authorizedCumulative - p.executedAmount;
        uint256 fillAmount = authorizedNow < maxAmountIn ? authorizedNow : maxAmountIn;

        if (fillAmount == 0) {
            emit PositionSkipped(positionId, SkipReason.NOT_DUE);
            return false;
        }
        if (fillAmount < p.minFillAmount && scheduleElapsed < p.duration) {
            emit PositionSkipped(positionId, SkipReason.MIN_FILL);
            return false;
        }

        // Dual quotes on the route's router: the probe approximates the spot
        // price, the execution quote is the real size. Both run the same
        // program, so their difference is the fill's own footprint.
        // Probe floor (REVISION 3): 0.01 whole tokenIn units, derived from
        // the cached decimals. Prevents floored division from collapsing the
        // probe to a dust notional the router prices at zero on 6-decimal
        // tokens. When the fill itself is smaller than the floor, the fill
        // is its own probe and the impact check is vacuous — negligible by
        // definition.
        uint256 probeAmount = fillAmount / PROBE_DENOMINATOR;
        uint256 probeFloor = p.decimalsIn >= 2 ? 10 ** (p.decimalsIn - 2) : 1;
        if (probeAmount < probeFloor) probeAmount = probeFloor < fillAmount ? probeFloor : fillAmount;
        (, uint256 probeOut,) = r.router.quote(r.order, p.tokenIn, p.tokenOut, probeAmount, r.takerTraitsAndData);
        (uint256 quotedIn, uint256 amountOut,) = r.router.quote(r.order, p.tokenIn, p.tokenOut, fillAmount, r.takerTraitsAndData);

        (bool okRef, uint256 referencePrice) =
            PriceMath.tryNormalizePrice(probeOut, p.decimalsOut, probeAmount, p.decimalsIn);
        (bool okExec, uint256 executionPrice) =
            PriceMath.tryNormalizePrice(amountOut, p.decimalsOut, quotedIn, p.decimalsIn);
        if (!okRef || !okExec || referencePrice == 0) {
            // A zero or unpriceable quote is a quote-quality failure, not an
            // impact failure — the two are reported separately (REVISION 3)
            // so logs and the Subgraph never claim a market move that did
            // not happen.
            emit PositionSkipped(positionId, SkipReason.QUOTE_INVALID);
            return false;
        }
        if (executionPrice < p.minPrice || executionPrice > p.maxPrice) {
            emit PositionSkipped(positionId, SkipReason.BOUNDS);
            return false;
        }
        if (PriceMath.priceImpactBps(referencePrice, executionPrice) > p.maxSlippageBps) {
            emit PositionSkipped(positionId, SkipReason.IMPACT);
            return false;
        }

        // Pull-per-fill: a failing transfer skips the fill and is reported —
        // it never reverts the trigger (a revoked allowance is a user
        // decision, not an error to pay gas for).
        if (!_tryTransferFrom(p.tokenIn, p.owner, address(this), fillAmount)) {
            emit PositionSkipped(positionId, SkipReason.TRANSFER_FAILED);
            return false;
        }

        _ensureRouterAllowance(p.tokenIn, address(r.router), fillAmount);
        (, uint256 swappedOut,) = r.router.swap(r.order, p.tokenIn, p.tokenOut, fillAmount, r.takerTraitsAndData);

        // OPEN ITEM OI-1 (SPEC appendix, verify at step 3): the official
        // router's exact-in swap is assumed to always consume the full
        // requested input. If step-3 verification shows partial consumption,
        // increment by the swap-returned input instead of `fillAmount`.
        p.executedAmount += fillAmount;
        _sweep(p.tokenOut, p.owner);
        emit FillExecuted(positionId, fillAmount, swappedOut, executionPrice, block.timestamp);

        if (p.executedAmount >= p.totalBudget) {
            p.isActive = false;
            emit PositionCompleted(positionId);
        }
        return true;
    }

    function getPosition(uint256 positionId) external view returns (Position memory position, AquaRoute memory route) {
        position = _positions[positionId];
        route = _routes[positionId];
    }

    /// @dev Raw low-level transferFrom: both `false` returns and reverts are
    /// reported as a failure (the caller skips), which keeps the skip
    /// semantics intact for non-standard behavior without opening the
    /// standard-token surface to silent losses.
    function _tryTransferFrom(address token, address from, address to, uint256 amount) private returns (bool) {
        (bool callOk, bytes memory ret) = token.call(abi.encodeCall(IERC20.transferFrom, (from, to, amount)));
        return callOk && (ret.length == 0 || abi.decode(ret, (bool)));
    }

    /// @dev Deliberately unlimited allowance to the route's router: the
    /// router address is chosen by the position owner, the contract holds no
    /// funds between fills, so exposure is bounded to the single fill in
    /// flight — a risk the owner accepts by choosing the route. Not an
    /// oversight; revisit only if a custody-bearing refactor ever lands.
    function _ensureRouterAllowance(address token, address router, uint256 amount) private {
        if (IERC20(token).allowance(address(this), router) < amount) {
            IERC20(token).forceApprove(router, type(uint256).max);
        }
    }

    /// @dev Forwards the contract's entire tokenOut balance to `to`. The
    /// contract holds no tokenOut between fills — this only ever moves the
    /// current fill's proceeds. Known edge case, accepted at MVP scope:
    /// tokenOut donated directly to the contract by an unrelated party is
    /// swept to the next position's owner; per-position donation accounting
    /// is deliberately not added.
    function _sweep(address token, address to) private {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) IERC20(token).safeTransfer(to, balance);
    }
}
