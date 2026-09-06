/**
 * Net-margin / drawdown kills. Vault never spends save.
 * No guaranteed PnL.
 */
export interface RiskState {
  equity: number;
  peak: number;
  realizedPnl: number;
  fees: number;
  killed: boolean;
  reason?: string;
}

export interface RiskLimits {
  maxDrawdownPct: number;
  minNetMargin: number;
}

export const DEFAULT_LIMITS: RiskLimits = {
  maxDrawdownPct: 0.15,
  minNetMargin: 0,
};

export function netMargin(realizedPnl: number, fees: number): number {
  return realizedPnl - fees;
}

export function drawdownPct(equity: number, peak: number): number {
  if (peak <= 0) return 0;
  return Math.max(0, (peak - equity) / peak);
}

export function applyFill(state: RiskState, markToMarket: number): RiskState {
  const equity = markToMarket;
  const peak = Math.max(state.peak, equity);
  return { ...state, equity, peak };
}

export function checkKills(state: RiskState, limits: RiskLimits = DEFAULT_LIMITS): RiskState {
  const margin = netMargin(state.realizedPnl, state.fees);
  if (margin < limits.minNetMargin) {
    return {
      ...state,
      killed: true,
      reason: `net-margin kill: ${margin} < ${limits.minNetMargin}`,
    };
  }
  const dd = drawdownPct(state.equity, state.peak);
  if (dd > limits.maxDrawdownPct) {
    return {
      ...state,
      killed: true,
      reason: `drawdown kill: ${(dd * 100).toFixed(2)}% > ${limits.maxDrawdownPct * 100}%`,
    };
  }
  return { ...state, killed: false, reason: undefined };
}

export function freshRisk(equity = 0): RiskState {
  return {
    equity,
    peak: equity,
    realizedPnl: 0,
    fees: 0,
    killed: false,
  };
}
