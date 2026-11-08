from collections import deque
from typing import Deque, Dict, List, Optional
from backend.config import SUPPORTED_SYMBOLS
from backend.models import CandleData, DigitStats, TickData


def get_default_pip_size(symbol: str) -> int:
    for item in SUPPORTED_SYMBOLS:
        if item["symbol"] == symbol:
            return int(item["pip_size"])
    return 2


def extract_last_digit(quote: float, pip_size: int) -> tuple[str, int]:
    """Format quote with exact pip_size decimals so trailing zeroes are preserved."""
    formatted = f"{quote:.{pip_size}f}"
    # Extract the very last numeric character
    for ch in reversed(formatted):
        if ch.isdigit():
            return formatted, int(ch)
    return formatted, 0


class StreamEngine:
    """Maintains rolling tick buffers, exact last-digit statistics, and OHLC candles."""

    def __init__(
        self,
        symbol: str = "R_100",
        max_ticks: int = 1000,
        window_size: int = 100,
        barrier: int = 4,
        timeframe_sec: int = 60,
    ) -> None:
        self.symbol = symbol
        self.max_ticks = max_ticks
        self.window_size = window_size
        self.barrier = barrier
        self.timeframe_sec = timeframe_sec
        self.pip_size = get_default_pip_size(symbol)

        self.ticks: Deque[TickData] = deque(maxlen=max_ticks)
        self.candles: Deque[CandleData] = deque(maxlen=200)

    def reset(self, symbol: str, pip_size: Optional[int] = None) -> None:
        self.symbol = symbol
        self.pip_size = pip_size if pip_size is not None else get_default_pip_size(symbol)
        self.ticks.clear()
        self.candles.clear()

    def process_tick(
        self, quote: float, epoch: int, symbol: Optional[str] = None, pip_size: Optional[int] = None
    ) -> TickData:
        sym = symbol or self.symbol
        if sym != self.symbol:
            self.reset(sym, pip_size)
        elif pip_size is not None and pip_size != self.pip_size:
            self.pip_size = pip_size

        formatted, last_digit = extract_last_digit(quote, self.pip_size)
        tick = TickData(
            symbol=self.symbol,
            epoch=epoch,
            quote=quote,
            formatted_quote=formatted,
            pip_size=self.pip_size,
            last_digit=last_digit,
        )
        self.ticks.append(tick)
        self._update_candle(tick)
        return tick

    def _update_candle(self, tick: TickData) -> CandleData:
        bucket_time = (tick.epoch // self.timeframe_sec) * self.timeframe_sec
        if not self.candles or self.candles[-1].open_time != bucket_time:
            candle = CandleData(
                symbol=tick.symbol,
                timeframe_sec=self.timeframe_sec,
                open_time=bucket_time,
                open=tick.quote,
                high=tick.quote,
                low=tick.quote,
                close=tick.quote,
                tick_count=1,
            )
            self.candles.append(candle)
            return candle

        current = self.candles[-1]
        current.high = max(current.high, tick.quote)
        current.low = min(current.low, tick.quote)
        current.close = tick.quote
        current.tick_count += 1
        return current

    def get_digit_stats(
        self, window_size: Optional[int] = None, barrier: Optional[int] = None
    ) -> DigitStats:
        win = window_size or self.window_size
        bar = barrier if barrier is not None else self.barrier

        recent_slice = list(self.ticks)[-win:]
        total = len(recent_slice)
        counts: Dict[int, int] = {d: 0 for d in range(10)}

        even_count = 0
        odd_count = 0
        over_count = 0
        under_count = 0

        for t in recent_slice:
            d = t.last_digit
            counts[d] += 1
            if d % 2 == 0:
                even_count += 1
            else:
                odd_count += 1
            if d > bar:
                over_count += 1
            elif d < bar:
                under_count += 1

        percentages: Dict[int, float] = {
            d: round((counts[d] / total) * 100.0, 2) if total > 0 else 0.0
            for d in range(10)
        }

        even_pct = round((even_count / total) * 100.0, 2) if total > 0 else 0.0
        odd_pct = round((odd_count / total) * 100.0, 2) if total > 0 else 0.0
        over_pct = round((over_count / total) * 100.0, 2) if total > 0 else 0.0
        under_pct = round((under_count / total) * 100.0, 2) if total > 0 else 0.0

        even_streak = 0
        odd_streak = 0
        for t in reversed(recent_slice):
            if t.last_digit % 2 == 0:
                if odd_streak > 0:
                    break
                even_streak += 1
            else:
                if even_streak > 0:
                    break
                odd_streak += 1

        if total > 0:
            hottest_digit = max(range(10), key=lambda d: (counts[d], d))
            coldest_digit = min(range(10), key=lambda d: (counts[d], -d))
        else:
            hottest_digit = 0
            coldest_digit = 0

        recent_digits = [t.last_digit for t in recent_slice[-30:]]

        return DigitStats(
            symbol=self.symbol,
            window_size=win,
            total_ticks=total,
            counts=counts,
            percentages=percentages,
            even_pct=even_pct,
            odd_pct=odd_pct,
            over_pct=over_pct,
            under_pct=under_pct,
            barrier=bar,
            current_even_streak=even_streak,
            current_odd_streak=odd_streak,
            hottest_digit=hottest_digit,
            coldest_digit=coldest_digit,
            recent_digits=recent_digits,
        )

    def get_candles(self, limit: int = 60) -> List[CandleData]:
        return list(self.candles)[-limit:]
