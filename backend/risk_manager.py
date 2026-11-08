from typing import List, Optional, Tuple
from backend.models import ContractType, RiskConfig, TradeRecord


# Approximate realistic Deriv payout profit ratios (net profit / stake)
PAYOUT_MULTIPLIERS = {
    ContractType.DIGITEVEN.value: 0.95,
    ContractType.DIGITODD.value: 0.95,
    ContractType.CALL.value: 0.95,
    ContractType.PUT.value: 0.95,
    ContractType.DIGITDIFF.value: 0.09,
    ContractType.DIGITMATCH.value: 7.90,
}


def estimate_payout_ratio(contract_type: str, barrier: Optional[int] = None) -> float:
    if contract_type in PAYOUT_MULTIPLIERS:
        return PAYOUT_MULTIPLIERS[contract_type]

    b = barrier if barrier is not None else 4
    if contract_type == ContractType.DIGITOVER.value:
        win_digits = max(1, 9 - b)
        prob = win_digits / 10.0
        return round((0.96 / prob) - 1.0, 2)
    if contract_type == ContractType.DIGITUNDER.value:
        win_digits = max(1, b)
        prob = win_digits / 10.0
        return round((0.96 / prob) - 1.0, 2)
    return 0.95


def evaluate_contract_outcome(
    contract_type: str,
    entry_quote: float,
    exit_quote: float,
    exit_digit: int,
    barrier: Optional[int] = None,
) -> bool:
    """Evaluate if a Digits or Rise/Fall option won on exit tick."""
    b = barrier if barrier is not None else 4
    if contract_type == ContractType.DIGITEVEN.value:
        return exit_digit % 2 == 0
    if contract_type == ContractType.DIGITODD.value:
        return exit_digit % 2 == 1
    if contract_type == ContractType.DIGITOVER.value:
        return exit_digit > b
    if contract_type == ContractType.DIGITUNDER.value:
        return exit_digit < b
    if contract_type == ContractType.DIGITMATCH.value:
        return exit_digit == b
    if contract_type == ContractType.DIGITDIFF.value:
        return exit_digit != b
    if contract_type == ContractType.CALL.value:
        return exit_quote > entry_quote
    if contract_type == ContractType.PUT.value:
        return exit_quote < entry_quote
    return False


class RiskManager:
    """Manages stake sizing, Martingale progression, Stop-Loss, and Take-Profit limits."""

    def __init__(self, config: Optional[RiskConfig] = None) -> None:
        self.config: RiskConfig = config or RiskConfig()
        self.current_stake: float = self.config.base_stake
        self.consecutive_losses: int = 0
        self.total_profit: float = 0.0
        self.total_trades: int = 0
        self.wins: int = 0
        self.losses: int = 0
        self.halt_reason: Optional[str] = None
        self.trade_history: List[TradeRecord] = []

    def update_config(self, config: RiskConfig) -> None:
        self.config = config
        if self.consecutive_losses == 0:
            self.current_stake = config.base_stake
        self.halt_reason = None

    def reset_session(self) -> None:
        self.current_stake = self.config.base_stake
        self.consecutive_losses = 0
        self.total_profit = 0.0
        self.total_trades = 0
        self.wins = 0
        self.losses = 0
        self.halt_reason = None
        self.trade_history.clear()

    def can_open_trade(self) -> Tuple[bool, str]:
        if self.total_profit >= self.config.take_profit:
            self.halt_reason = f"Take Profit reached (+${self.total_profit:.2f})"
            return False, self.halt_reason
        if self.total_profit <= -abs(self.config.stop_loss):
            self.halt_reason = f"Stop Loss reached (-${abs(self.total_profit):.2f})"
            return False, self.halt_reason
        if self.consecutive_losses >= self.config.max_consecutive_losses:
            self.halt_reason = (
                f"Max consecutive losses reached ({self.consecutive_losses})"
            )
            return False, self.halt_reason
        return True, "OK"

    def get_next_stake(self) -> float:
        return round(self.current_stake, 2)

    def record_completed_trade(self, trade: TradeRecord) -> None:
        self.total_trades += 1
        self.total_profit = round(self.total_profit + trade.profit, 2)

        if trade.status == "WON":
            self.wins += 1
            self.consecutive_losses = 0
            self.current_stake = self.config.base_stake
        elif trade.status == "LOST":
            self.losses += 1
            self.consecutive_losses += 1
            if self.config.use_martingale:
                self.current_stake = round(
                    self.current_stake * self.config.martingale_multiplier, 2
                )
            else:
                self.current_stake = self.config.base_stake

        self.trade_history.insert(0, trade)
        if len(self.trade_history) > 200:
            self.trade_history.pop()

        # Re-check limits after settlement
        self.can_open_trade()

    def get_summary(self) -> dict:
        win_rate = (
            round((self.wins / self.total_trades) * 100.0, 1)
            if self.total_trades > 0
            else 0.0
        )
        return {
            "total_profit": self.total_profit,
            "total_trades": self.total_trades,
            "wins": self.wins,
            "losses": self.losses,
            "win_rate": win_rate,
            "current_stake": round(self.current_stake, 2),
            "consecutive_losses": self.consecutive_losses,
            "halt_reason": self.halt_reason,
            "config": self.config.model_dump(),
        }
