// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IAquaSwapVMRouter} from "./interfaces/IAquaSwapVMRouter.sol";

/// @dev Execution schedule shapes. Only NEUTRAL is implemented in the step-1
/// milestone; AGGRESSIVE and CONSERVATIVE land in the step-2 milestone.
enum CurveShape {
    AGGRESSIVE,
    NEUTRAL,
    CONSERVATIVE
}

/// @dev Why a trigger of AdaptiveExecute produced no fill. Skips are
/// first-class outcomes: they are emitted as events so the keeper and the
/// Subgraph can surface them, and they never revert the trigger.
enum SkipReason {
    NOT_DUE,
    MIN_FILL,
    BOUNDS,
    IMPACT,
    QUOTE_INVALID,
    TRANSFER_FAILED
}

/// @dev The stored position policy. Static fields are immutable after
/// creation; only `executedAmount` and `isActive` evolve.
struct Position {
    address owner;
    address tokenIn;
    address tokenOut;
    uint8 decimalsIn;
    uint8 decimalsOut;
    uint256 totalBudget;
    uint256 executedAmount;
    uint256 minFillAmount;
    uint256 startTimestamp;
    uint256 duration;
    CurveShape curveShape;
    uint256 minPrice;
    uint256 maxPrice;
    uint16 maxSlippageBps;
    bool isActive;
}

/// @dev The Aqua execution target for a position (SPEC Decision 13): the
/// maker strategy this position fills against, plus the opaque taker blob.
/// The owner may replace it at any time via `updateRoute` — changing the
/// route never changes what the curve authorizes. Upgrade path to multi-route
/// selection is a formal REVISION 3 (see SPEC Decision Log).
struct AquaRoute {
    IAquaSwapVMRouter router;
    IAquaSwapVMRouter.Order order;
    bytes takerTraitsAndData;
}

/// @dev Creation parameters (everything except the route).
struct CreateParams {
    address tokenIn;
    address tokenOut;
    uint256 totalBudget;
    uint256 minFillAmount;
    uint256 duration;
    CurveShape curveShape;
    uint256 minPrice;
    uint256 maxPrice;
    uint16 maxSlippageBps;
}

interface ISlopeEvents {
    event PositionCreated(
        uint256 indexed positionId,
        address indexed owner,
        address tokenIn,
        address tokenOut,
        uint8 decimalsIn,
        uint8 decimalsOut,
        uint256 totalBudget,
        uint256 minFillAmount,
        uint256 duration,
        CurveShape curveShape,
        uint256 minPrice,
        uint256 maxPrice,
        uint16 maxSlippageBps
    );
    event PositionCancelled(uint256 indexed positionId);
    event RouteUpdated(uint256 indexed positionId);
    event FillExecuted(
        uint256 indexed positionId,
        uint256 amountIn,
        uint256 amountOut,
        uint256 executionPrice,
        uint256 timestamp
    );
    event PositionSkipped(uint256 indexed positionId, SkipReason reason);
    event PositionCompleted(uint256 indexed positionId);
}

library SlopeErrors {
    error PositionNotActive();
    error NotOwner();
    error UnsupportedShape();
    error InvalidToken();
    error InvalidDecimals();
    error InvalidBudget();
    error InvalidMinFill();
    error InvalidDuration();
    error InvalidBounds();
    error InvalidSlippage();
    error InvalidRoute();
}
