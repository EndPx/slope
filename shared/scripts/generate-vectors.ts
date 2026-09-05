/**
 * Generates the committed cross-validation vectors that the Foundry suite
 * replays against the Solidity kernel (contracts/test/vectors/).
 * Deterministic: no randomness, every vector is reproducible from this file.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WAD, Shape, progress, normalizePrice } from "../src/index.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outPath = join(scriptDir, "../../contracts/test/vectors/curve-vectors.json");

const elapsed: bigint[] = [];
const duration: bigint[] = [];
const shape: number[] = [];
const expectedProgress: bigint[] = [];
const shapeCases: Array<{ id: number; label: string }> = [
  { id: 0, label: "aggressive" },
  { id: 1, label: "neutral" },
  { id: 2, label: "conservative" },
];
for (const d of [1000n, 86400n, 604800n, 2592000n]) {
  for (const e of [0n, 1n, 7n, d / 4n, d / 2n, (3n * d) / 4n, d - 1n, d]) {
    for (const s of shapeCases) {
      elapsed.push(e);
      duration.push(d);
      shape.push(s.id);
      expectedProgress.push(progress(e, d, s.id as 0 | 1 | 2));
    }
  }
}

const priceCases: Array<{ amountOut: bigint; decimalsOut: number; amountIn: bigint; decimalsIn: number }> = [
  { amountOut: 2500123456n, decimalsOut: 6, amountIn: 10n ** 18n, decimalsIn: 18 }, // 1 WETH -> 2500.123456 USDC
  { amountOut: 10n ** 18n, decimalsOut: 18, amountIn: 3000000000n, decimalsIn: 6 }, // 3000 USDC -> 1 WETH
  { amountOut: 3n * 10n ** 9n, decimalsOut: 6, amountIn: 10n ** 18n, decimalsIn: 18 }, // 1 WETH -> 3000 USDC
  { amountOut: 1n, decimalsOut: 18, amountIn: 3n, decimalsIn: 18 }, // rounding-sensitive floor
];

const payload = {
  elapsed: elapsed.map(String),
  duration: duration.map(String),
  shape,
  expectedProgress: expectedProgress.map(String),
  pAmountOut: priceCases.map((c) => String(c.amountOut)),
  pDecimalsOut: priceCases.map((c) => c.decimalsOut),
  pAmountIn: priceCases.map((c) => String(c.amountIn)),
  pDecimalsIn: priceCases.map((c) => c.decimalsIn),
  pExpected: priceCases.map((c) => String(normalizePrice(c.amountOut, c.decimalsOut, c.amountIn, c.decimalsIn).price)),
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n");
console.log(`wrote ${payload.expectedProgress.length} progress vectors and ${payload.pExpected.length} price vectors to ${outPath}`);
console.log(`sanity: progress(duration) === ${WAD} for all vectors: ${expectedProgress.at(-1) === WAD}`);
