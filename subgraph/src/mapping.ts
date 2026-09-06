/**
 * Slope subgraph mappings — pure event indexing, zero eth_calls.
 *
 * Sources of truth:
 *  - SPEC.md section 6: the four entities (Position, Fill, Skip,
 *    BenchmarkComparison).
 *  - MATH_SPEC.md section 6 + DECISION 4: the benchmark is an AS-OF-LAST-FILL
 *    SNAPSHOT comparing realized execution against the NEUTRAL shape at the
 *    same observed fill prices; the live planned-vs-actual curves are
 *    computed in the frontend, because mappings only run on events and there
 *    is no "now" at query time.
 */
import {BigDecimal, BigInt} from "@graphprotocol/graph-ts";
import {
  FillExecuted,
  PositionCancelled,
  PositionCompleted,
  PositionCreated,
  PositionSkipped,
} from "../generated/SlopePosition/SlopePosition";
import {BenchmarkComparison, Fill, Position, Skip} from "../generated/schema";

const TEN_THOUSAND = BigDecimal.fromString("10000");
const REASONS: string[] = ["NOT_DUE", "MIN_FILL", "BOUNDS", "IMPACT", "QUOTE_INVALID", "TRANSFER_FAILED"];

export function handlePositionCreated(event: PositionCreated): void {
  const position = new Position(event.params.positionId.toString());
  position.owner = event.params.owner;
  position.tokenIn = event.params.tokenIn;
  position.tokenOut = event.params.tokenOut;
  position.decimalsIn = event.params.decimalsIn;
  position.decimalsOut = event.params.decimalsOut;
  position.totalBudget = event.params.totalBudget;
  position.minFillAmount = event.params.minFillAmount;
  position.curveShape = event.params.curveShape;
  // The event carries no start time: creation block time is the start.
  position.startTimestamp = event.block.timestamp;
  position.duration = event.params.duration;
  position.minPrice = event.params.minPrice;
  position.maxPrice = event.params.maxPrice;
  position.maxSlippageBps = event.params.maxSlippageBps;
  position.isActive = true;
  position.executedAmount = BigInt.zero();
  position.save();
}

export function handleFillExecuted(event: FillExecuted): void {
  const position = Position.load(event.params.positionId.toString());
  if (position === null) return; // creation and fills share the start block; always indexed first

  const fill = new Fill(event.transaction.hash.toHex() + "-" + event.logIndex.toString());
  fill.position = position.id;
  fill.amountIn = event.params.amountIn;
  fill.amountOut = event.params.amountOut;
  fill.executionPrice = event.params.executionPrice;
  fill.timestamp = event.params.timestamp;
  fill.impactChecked = event.params.impactChecked;
  fill.blockNumber = event.block.number;
  fill.txHash = event.transaction.hash;
  fill.save();

  position.executedAmount = position.executedAmount.plus(event.params.amountIn);
  position.save();

  updateBenchmark(position, event);
}

export function handlePositionSkipped(event: PositionSkipped): void {
  // Skips are first-class audit records: they prove the guard rails
  // (schedule, bounds, impact, custody) made the decision, not the keeper.
  const skip = new Skip(event.transaction.hash.toHex() + "-" + event.logIndex.toString());
  skip.position = event.params.positionId.toString();
  skip.reason = REASONS[event.params.reason];
  skip.timestamp = event.block.timestamp;
  skip.blockNumber = event.block.number;
  skip.txHash = event.transaction.hash;
  skip.save();
}

export function handlePositionCompleted(event: PositionCompleted): void {
  const position = Position.load(event.params.positionId.toString());
  if (position === null) return;
  position.isActive = false;
  position.save();
}

export function handlePositionCancelled(event: PositionCancelled): void {
  const position = Position.load(event.params.positionId.toString());
  if (position === null) return;
  position.isActive = false;
  position.save();
}

/**
 * MATH_SPEC section 6, per fill i with raw amount a_i, normalized price p_i,
 * and elapsed e_i:
 *
 *   actualVWAP   = sum(a_i * p_i) / sum(a_i)
 *   twapAmount_i = totalBudget * e_i / duration     (NEUTRAL at the same instant)
 *   twapVWAP     = sum(twapAmount_i * p_i) / sum(twapAmount_i)
 *   improvementBps (sell side) = (actualVWAP - twapVWAP) * 10000 / twapVWAP
 *
 * BigDecimal audit/display math, exempt from the integer contract. The
 * weighted sums accumulate on the entity so each fill is O(1).
 */
function updateBenchmark(position: Position, event: FillExecuted): void {
  const bench = loadOrCreateBenchmark(position.id);

  const amount = event.params.amountIn.toBigDecimal();
  const price = event.params.executionPrice.toBigDecimal();
  const elapsed = event.params.timestamp.minus(position.startTimestamp);
  const twapAmount = position.totalBudget
    .toBigDecimal()
    .times(elapsed.toBigDecimal())
    .div(position.duration.toBigDecimal());

  bench.fillCount = bench.fillCount + 1;
  bench.elapsedAtLastFill = elapsed;
  bench.actualPriceSum = bench.actualPriceSum.plus(amount.times(price));
  bench.actualAmountSum = bench.actualAmountSum.plus(amount);
  bench.twapPriceSum = bench.twapPriceSum.plus(twapAmount.times(price));
  bench.twapAmountSum = bench.twapAmountSum.plus(twapAmount);

  bench.actualExecuted = position.executedAmount.toBigDecimal();
  bench.plannedExecuted = position.totalBudget
    .toBigDecimal()
    .times(elapsed.toBigDecimal())
    .div(position.duration.toBigDecimal());
  bench.actualVWAP = bench.actualPriceSum.div(bench.actualAmountSum);

  // Every fill at elapsed 0 leaves the NEUTRAL reference weightless.
  if (bench.twapAmountSum.gt(BigDecimal.zero())) {
    // Local non-null: the entity field is nullable, AssemblyScript does not
    // narrow entity property accesses.
    const twapVWAP = bench.twapPriceSum.div(bench.twapAmountSum);
    bench.twapVWAP = twapVWAP;
    bench.improvementBps = bench.actualVWAP.minus(twapVWAP).times(TEN_THOUSAND).div(twapVWAP);
  } else {
    bench.twapVWAP = null;
    bench.improvementBps = null;
  }
  bench.computedAt = event.block.timestamp;
  bench.save();
}

function loadOrCreateBenchmark(positionId: string): BenchmarkComparison {
  const existing = BenchmarkComparison.load(positionId);
  if (existing !== null) return existing;
  const bench = new BenchmarkComparison(positionId);
  bench.position = positionId;
  bench.fillCount = 0;
  bench.elapsedAtLastFill = BigInt.zero();
  bench.plannedExecuted = BigDecimal.zero();
  bench.actualExecuted = BigDecimal.zero();
  bench.actualVWAP = BigDecimal.zero();
  bench.computedAt = BigInt.zero();
  bench.actualPriceSum = BigDecimal.zero();
  bench.actualAmountSum = BigDecimal.zero();
  bench.twapPriceSum = BigDecimal.zero();
  bench.twapAmountSum = BigDecimal.zero();
  return bench;
}
