/**
 * Re-exports the shared curve reference model — the single source of truth
 * for the schedule outside Solidity (MATH_SPEC section 7 parity). The UI
 * preview and the keeper both run this exact code.
 */
export {Shape, progress, WAD} from "../../../shared/src/curve";
