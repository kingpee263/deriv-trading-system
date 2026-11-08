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

        if st == StrategyType.ML_ADAPTIVE_EDGE:
            return self._eval_ml_adaptive_edge(tick, stats, recent_ticks)
        if st == StrategyType.SMALL_ACCT_SURVIVAL:
            return self._eval_small_acct_survival(tick, stats)
        if st == StrategyType.EVEN_ODD_STREAK:
            return self._eval_even_odd_streak(tick, stats)
        if st == StrategyType.OVER_UNDER_EDGE:
            return self._eval_over_under_edge(tick, stats)
        if st == StrategyType.MATCH_DIFF_COLD:
            return self._eval_match_diff_cold(tick, stats)
        if st == StrategyType.RISE_FALL_MOMENTUM:
            return self._eval_rise_fall_momentum(tick, recent_ticks)

        return None

    def _eval_ml_adaptive_edge(
        self, tick: TickData, stats: DigitStats, recent_ticks: List[TickData]
    ) -> Optional[TradeSignal]:
        """Markov 1st-Order Transition + Chi-Square Regime Ensemble."""
        matrix = [[0] * 10 for _ in range(10)]
        row_sums = [0] * 10
        for i in range(len(recent_ticks) - 1):
            d_from = recent_ticks[i].last_digit
            d_to = recent_ticks[i + 1].last_digit
            matrix[d_from][d_to] += 1
            row_sums[d_from] += 1

        cur = tick.last_digit
        total_from = row_sums[cur]
        cond_probs = {
            d: ((matrix[cur][d] + 0.5) / (total_from + 5.0)) * 100.0
            for d in range(10)
        }

        lowest_digit = min(
            range(10),
            key=lambda d: 0.6 * cond_probs[d] + 0.4 * stats.percentages.get(d, 10.0),
        )
        best_digit = max(
            range(10),
            key=lambda d: 0.6 * cond_probs[d] + 0.4 * stats.percentages.get(d, 10.0),
        )
        lowest_score = 0.6 * cond_probs[lowest_digit] + 0.4 * stats.percentages.get(
            lowest_digit, 10.0
        )
        best_score = 0.6 * cond_probs[best_digit] + 0.4 * stats.percentages.get(
            best_digit, 10.0
        )

        expected = max(1.0, stats.total_ticks / 10.0)
        chi_sq = sum(
            ((stats.counts.get(d, 0) - expected) ** 2) / expected for d in range(10)
        )
        max_streak = max(stats.current_even_streak, stats.current_odd_streak)
        confidence = min(
            96.0,
            38.0
            + min(22.0, chi_sq * 1.15)
            + min(18.0, (best_score - lowest_score) * 0.9)
            + min(14.0, max_streak * 2.8),
        )

        if confidence < 65.0:
            return None

        if max_streak >= self.config.streak_threshold:
            return self._eval_even_odd_streak(tick, stats)

        return TradeSignal(
            strategy_type=StrategyType.ML_ADAPTIVE_EDGE,
            contract_type=ContractType.DIGITDIFF,
            symbol=tick.symbol,
            duration_ticks=self.config.duration_ticks,
            barrier=lowest_digit,
            reason=f"ML Conf {confidence:.1f}% // Markov Min-Prob Digit {lowest_digit} ({lowest_score:.1f}%)",
            entry_tick=tick.quote,
            entry_digit=tick.last_digit,
        )

    def _eval_small_acct_survival(
        self, tick: TickData, stats: DigitStats
    ) -> Optional[TradeSignal]:
        recent2 = stats.recent_digits[-2:]
        if len(recent2) == 2 and all(d <= 1 for d in recent2):
            return TradeSignal(
                strategy_type=StrategyType.SMALL_ACCT_SURVIVAL,
                contract_type=ContractType.DIGITOVER,
                symbol=tick.symbol,
                duration_ticks=self.config.duration_ticks,
                barrier=1,
                reason="Small-Acct Compounder: 2x Low Digits [0-1] -> DIGITOVER 1",
                entry_tick=tick.quote,
                entry_digit=tick.last_digit,
            )
        if len(recent2) == 2 and all(d >= 8 for d in recent2):
            return TradeSignal(
                strategy_type=StrategyType.SMALL_ACCT_SURVIVAL,
                contract_type=ContractType.DIGITUNDER,
                symbol=tick.symbol,
                duration_ticks=self.config.duration_ticks,
                barrier=8,
                reason="Small-Acct Compounder: 2x High Digits [8-9] -> DIGITUNDER 8",
                entry_tick=tick.quote,
                entry_digit=tick.last_digit,
            )
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
