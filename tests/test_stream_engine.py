from backend.stream_engine import StreamEngine, extract_last_digit


def test_extract_last_digit_preserves_trailing_zeroes():
    formatted, digit = extract_last_digit(1234.50, pip_size=2)
    assert formatted == "1234.50"
    assert digit == 0

    formatted_3, digit_3 = extract_last_digit(98.120, pip_size=3)
    assert formatted_3 == "98.120"
    assert digit_3 == 0

    formatted_7, digit_7 = extract_last_digit(450.27, pip_size=2)
    assert formatted_7 == "450.27"
    assert digit_7 == 7


def test_stream_engine_digit_stats_and_streaks():
    engine = StreamEngine(symbol="R_100", window_size=10, barrier=4, timeframe_sec=60)

    # Feed 6 even-ending ticks followed by 4 odd-ending ticks
    quotes = [100.00, 100.02, 100.04, 100.06, 100.08, 100.12, 100.11, 100.13, 100.15, 100.17]
    for idx, q in enumerate(quotes):
        engine.process_tick(q, epoch=1700000000 + idx, symbol="R_100", pip_size=2)

    stats = engine.get_digit_stats()
    assert stats.total_ticks == 10
    assert stats.even_pct == 60.0
    assert stats.odd_pct == 40.0
    assert stats.current_odd_streak == 4
    assert stats.current_even_streak == 0
    assert stats.counts[2] == 2
    assert stats.hottest_digit == 2


def test_stream_engine_candle_aggregation():
    engine = StreamEngine(symbol="R_100", timeframe_sec=60)

    # Same 60s bucket: 1700000040 .. 1700000055
    engine.process_tick(100.50, epoch=1700000040, pip_size=2)
    engine.process_tick(102.00, epoch=1700000045, pip_size=2)
    engine.process_tick(99.25, epoch=1700000050, pip_size=2)
    engine.process_tick(101.10, epoch=1700000055, pip_size=2)

    # Next 60s bucket (starts at 1700000100)
    engine.process_tick(101.80, epoch=1700000105, pip_size=2)

    candles = engine.get_candles()
    assert len(candles) == 2
    first = candles[0]
    assert first.open == 100.50
    assert first.high == 102.00
    assert first.low == 99.25
    assert first.close == 101.10
    assert first.tick_count == 4
