from typing import List, Optional
from backend.models import (
    ContractType,
    DigitStats,
    StrategyConfig,
    StrategyType,
    TickData,
    TradeSignal,
)


class StrategyEngine:
    """Evaluates real-time ticks and digit distributions to generate trade signals."""

    def __init__(self, config: Optional[StrategyConfig] = None) -> None:
        self.config: StrategyConfig = config or StrategyConfig()

    def update_config(self, config: StrategyConfig) -> None:
        self.config = config

    def evaluate(
        self,
        tick: TickData,
        stats: DigitStats,
        recent_ticks: List[TickData],
    ) -> Optional[TradeSignal]:
        if not self.config.enabled:
            return None

        # Require a minimum number of ticks in buffer before generating automated signals
        min_required = min(15, self.config.window_size)
        if stats.total_ticks < min_required:
            return None

        st = self.config.strategy_type

        if st == StrategyType.EVEN_ODD_STREAK:
            return self._eval_even_odd_streak(tick, stats)
        if st == StrategyType.OVER_UNDER_EDGE:
            return self._eval_over_under_edge(tick, stats)
        if st == StrategyType.MATCH_DIFF_COLD:
            return self._eval_match_diff_cold(tick, stats)
        if st == StrategyType.RISE_FALL_MOMENTUM:
            return self._eval_rise_fall_momentum(tick, recent_ticks)

        return None

    def _eval_even_odd_streak(
        self, tick: TickData, stats: DigitStats
    ) -> Optional[TradeSignal]:
        threshold = self.config.streak_threshold
        if stats.current_odd_streak >= threshold:
            return TradeSignal(
                strategy_type=StrategyType.EVEN_ODD_STREAK,
                contract_type=ContractType.DIGITEVEN,
                symbol=tick.symbol,
                duration_ticks=self.config.duration_ticks,
                barrier=None,
                reason=f"Odd streak reached {stats.current_odd_streak} ticks (>= {threshold}) -> Reversal DIGITEVEN",
                entry_tick=tick.quote,
                entry_digit=tick.last_digit,
            )
        if stats.current_even_streak >= threshold:
            return TradeSignal(
                strategy_type=StrategyType.EVEN_ODD_STREAK,
                contract_type=ContractType.DIGITODD,
                symbol=tick.symbol,
                duration_ticks=self.config.duration_ticks,
                barrier=None,
                reason=f"Even streak reached {stats.current_even_streak} ticks (>= {threshold}) -> Reversal DIGITODD",
                entry_tick=tick.quote,
                entry_digit=tick.last_digit,
            )
        return None

    def _eval_over_under_edge(
        self, tick: TickData, stats: DigitStats
    ) -> Optional[TradeSignal]:
        barrier = self.config.barrier
        recent = stats.recent_digits
        streak = self.config.streak_threshold
        if len(recent) < streak:
            return None

        tail = recent[-streak:]
        # If last N digits were all <= barrier and overall Over % is supportive, buy DIGITOVER
        if all(d <= barrier for d in tail) and stats.over_pct >= 40.0:
            return TradeSignal(
                strategy_type=StrategyType.OVER_UNDER_EDGE,
                contract_type=ContractType.DIGITOVER,
                symbol=tick.symbol,
                duration_ticks=self.config.duration_ticks,
                barrier=barrier,
                reason=f"{streak} ticks <= {barrier} with Over% at {stats.over_pct}% -> DIGITOVER {barrier}",
                entry_tick=tick.quote,
                entry_digit=tick.last_digit,
            )

        # If last N digits were all >= barrier and overall Under % is supportive, buy DIGITUNDER
        if all(d >= barrier for d in tail) and stats.under_pct >= 40.0:
            return TradeSignal(
                strategy_type=StrategyType.OVER_UNDER_EDGE,
                contract_type=ContractType.DIGITUNDER,
                symbol=tick.symbol,
                duration_ticks=self.config.duration_ticks,
                barrier=barrier,
                reason=f"{streak} ticks >= {barrier} with Under% at {stats.under_pct}% -> DIGITUNDER {barrier}",
                entry_tick=tick.quote,
                entry_digit=tick.last_digit,
            )
        return None

    def _eval_match_diff_cold(
        self, tick: TickData, stats: DigitStats
    ) -> Optional[TradeSignal]:
        coldest = stats.coldest_digit
        cold_pct = stats.percentages.get(coldest, 10.0)
        # Trigger DIGITDIFF when current digit equals the coldest digit (mean reversion away from rare digit)
        if tick.last_digit == coldest and cold_pct <= 8.0:
            target_contract = (
                ContractType.DIGITMATCH
                if self.config.contract_type == ContractType.DIGITMATCH
                else ContractType.DIGITDIFF
            )
            return TradeSignal(
                strategy_type=StrategyType.MATCH_DIFF_COLD,
                contract_type=target_contract,
                symbol=tick.symbol,
                duration_ticks=self.config.duration_ticks,
                barrier=coldest,
                reason=f"Coldest digit {coldest} ({cold_pct}%) appeared -> {target_contract.value} {coldest}",
                entry_tick=tick.quote,
                entry_digit=tick.last_digit,
            )
        return None

    def _eval_rise_fall_momentum(
        self, tick: TickData, recent_ticks: List[TickData]
    ) -> Optional[TradeSignal]:
        streak = self.config.streak_threshold
        if len(recent_ticks) < streak + 1:
            return None

        window = recent_ticks[-(streak + 1) :]
        diffs = [window[i + 1].quote - window[i].quote for i in range(len(window) - 1)]

        if all(d > 0 for d in diffs):
            return TradeSignal(
                strategy_type=StrategyType.RISE_FALL_MOMENTUM,
                contract_type=ContractType.CALL,
                symbol=tick.symbol,
                duration_ticks=self.config.duration_ticks,
                barrier=None,
                reason=f"Bullish momentum: {streak} consecutive rising ticks -> CALL",
                entry_tick=tick.quote,
                entry_digit=tick.last_digit,
            )
        if all(d < 0 for d in diffs):
            return TradeSignal(
                strategy_type=StrategyType.RISE_FALL_MOMENTUM,
                contract_type=ContractType.PUT,
                symbol=tick.symbol,
                duration_ticks=self.config.duration_ticks,
                barrier=None,
                reason=f"Bearish momentum: {streak} consecutive falling ticks -> PUT",
                entry_tick=tick.quote,
                entry_digit=tick.last_digit,
            )
        return None
