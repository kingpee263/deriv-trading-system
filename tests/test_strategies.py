from backend.models import (
    ContractType,
    RiskConfig,
    StrategyConfig,
    StrategyType,
    TradeRecord,
)
from backend.risk_manager import RiskManager, evaluate_contract_outcome
from backend.strategy_engine import StrategyEngine
from backend.stream_engine import StreamEngine


def test_even_odd_streak_strategy_triggers_reversal():
    stream = StreamEngine(symbol="R_100", window_size=20)
    strat = StrategyEngine(
        StrategyConfig(
            enabled=True,
            strategy_type=StrategyType.EVEN_ODD_STREAK,
            streak_threshold=3,
            duration_ticks=1,
        )
    )

    # Feed 15 mixed ticks, ending with 3 consecutive odd digits
    base_quotes = [
        100.00, 100.02, 100.04, 100.01, 100.06,
        100.08, 100.03, 100.02, 100.04, 100.06,
        100.08, 100.00, 100.01, 100.03, 100.05,
    ]
    last_tick = None
    for idx, q in enumerate(base_quotes):
        last_tick = stream.process_tick(q, epoch=1700000100 + idx, pip_size=2)

    stats = stream.get_digit_stats()
    signal = strat.evaluate(last_tick, stats, list(stream.ticks))
    assert signal is not None
    assert signal.contract_type == ContractType.DIGITEVEN


def test_risk_manager_martingale_and_stop_loss():
    risk = RiskManager(
        RiskConfig(
            base_stake=1.0,
            take_profit=10.0,
            stop_loss=5.0,
            max_consecutive_losses=3,
            use_martingale=True,
            martingale_multiplier=2.0,
        )
    )

    assert risk.get_next_stake() == 1.0

    # Record a loss
    loss_trade = TradeRecord(
        id="T1",
        timestamp=1,
        symbol="R_100",
        strategy="EVEN_ODD_STREAK",
        contract_type="DIGITEVEN",
        duration_ticks=1,
        stake=1.0,
        entry_quote=100.01,
        entry_digit=1,
        exit_quote=100.03,
        exit_digit=3,
        status="LOST",
        profit=-1.0,
    )
    risk.record_completed_trade(loss_trade)
    assert risk.get_next_stake() == 2.0
    assert risk.consecutive_losses == 1

    # Record a win -> stake resets to base_stake
    win_trade = TradeRecord(
        id="T2",
        timestamp=2,
        symbol="R_100",
        strategy="EVEN_ODD_STREAK",
        contract_type="DIGITEVEN",
        duration_ticks=1,
        stake=2.0,
        entry_quote=100.03,
        entry_digit=3,
        exit_quote=100.04,
        exit_digit=4,
        status="WON",
        profit=1.9,
    )
    risk.record_completed_trade(win_trade)
    assert risk.get_next_stake() == 1.0
    assert risk.consecutive_losses == 0
    assert risk.total_profit == 0.9


def test_evaluate_contract_outcomes():
    assert evaluate_contract_outcome("DIGITEVEN", 100.0, 100.2, exit_digit=2) is True
    assert evaluate_contract_outcome("DIGITODD", 100.0, 100.2, exit_digit=2) is False
    assert evaluate_contract_outcome("DIGITOVER", 100.0, 100.7, exit_digit=7, barrier=4) is True
    assert evaluate_contract_outcome("DIGITUNDER", 100.0, 100.2, exit_digit=2, barrier=4) is True
    assert evaluate_contract_outcome("DIGITDIFF", 100.0, 100.5, exit_digit=5, barrier=3) is True
    assert evaluate_contract_outcome("DIGITMATCH", 100.0, 100.3, exit_digit=3, barrier=3) is True
    assert evaluate_contract_outcome("CALL", 100.0, 100.5, exit_digit=5) is True
    assert evaluate_contract_outcome("PUT", 100.0, 99.5, exit_digit=5) is True
