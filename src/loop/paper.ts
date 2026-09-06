import { sellTarget } from "../credits/pricing.js";
import { checkKills, freshRisk, type RiskState } from "../risk/kills.js";
import { ThompsonSampler, signalVote, type ArmName } from "../signals/index.js";

/**
 * Paper loop surface from Origin spec.
 * No invented fills. No guaranteed PnL.
 */
export interface PaperTick {
  prices: number[];
  fairExit: number;
  injectCost: number;
  mark: number;
  realizedPnl?: number;
  fees?: number;
}

export interface PaperDecision {
  arm: ArmName;
  votes: Record<ArmName, number>;
  sellTarget: number;
  risk: RiskState;
  wouldTrade: boolean;
  note: string;
}

export class PaperLoop {
  readonly sampler = new ThompsonSampler();
  risk: RiskState;

  constructor(equity = 1000) {
    this.risk = freshRisk(equity);
  }

  tick(input: PaperTick): PaperDecision {
    this.risk = {
      ...this.risk,
      equity: input.mark,
      peak: Math.max(this.risk.peak, input.mark),
      realizedPnl: input.realizedPnl ?? this.risk.realizedPnl,
      fees: input.fees ?? this.risk.fees,
    };
    this.risk = checkKills(this.risk);
    const votes = signalVote(input.prices);
    const arm = this.sampler.sample();
    const target = sellTarget(input.fairExit, input.injectCost);
    const wouldTrade = !this.risk.killed && votes[arm] > 0 && input.mark < target;
    return {
      arm,
      votes,
      sellTarget: target,
      risk: this.risk,
      wouldTrade,
      note: this.risk.killed
        ? this.risk.reason || "killed"
        : "No guaranteed PnL. Paper does not invent fills.",
    };
  }
}
