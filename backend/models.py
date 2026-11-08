from enum import Enum
from typing import Dict, List, Optional
from pydantic import BaseModel, Field


class ContractType(str, Enum):
    DIGITEVEN = "DIGITEVEN"
    DIGITODD = "DIGITODD"
    DIGITOVER = "DIGITOVER"
    DIGITUNDER = "DIGITUNDER"
    DIGITMATCH = "DIGITMATCH"
    DIGITDIFF = "DIGITDIFF"
    CALL = "CALL"
    PUT = "PUT"


class StrategyType(str, Enum):
    EVEN_ODD_STREAK = "EVEN_ODD_STREAK"
    OVER_UNDER_EDGE = "OVER_UNDER_EDGE"
    MATCH_DIFF_COLD = "MATCH_DIFF_COLD"
    RISE_FALL_MOMENTUM = "RISE_FALL_MOMENTUM"


class TickData(BaseModel):
    symbol: str
    epoch: int
    quote: float
    formatted_quote: str
    pip_size: int
    last_digit: int


class CandleData(BaseModel):
    symbol: str
    timeframe_sec: int
    open_time: int
    open: float
    high: float
    low: float
    close: float
    tick_count: int = 1


class DigitStats(BaseModel):
    symbol: str
    window_size: int
    total_ticks: int
    counts: Dict[int, int]
    percentages: Dict[int, float]
    even_pct: float
    odd_pct: float
    over_pct: float
    under_pct: float
    barrier: int = 4
    current_even_streak: int = 0
    current_odd_streak: int = 0
    hottest_digit: int = 0
    coldest_digit: int = 0
    recent_digits: List[int] = Field(default_factory=list)


class StrategyConfig(BaseModel):
    enabled: bool = False
    strategy_type: StrategyType = StrategyType.EVEN_ODD_STREAK
    symbol: str = "R_100"
    contract_type: ContractType = ContractType.DIGITEVEN
    duration_ticks: int = Field(default=1, ge=1, le=10)
    barrier: int = Field(default=4, ge=0, le=9)
    streak_threshold: int = Field(default=4, ge=2, le=20)
    window_size: int = Field(default=100, ge=10, le=1000)
    paper_trading: bool = True


class RiskConfig(BaseModel):
    base_stake: float = Field(default=1.0, ge=0.35)
    currency: str = "USD"
    take_profit: float = Field(default=20.0, gt=0)
    stop_loss: float = Field(default=15.0, gt=0)
    max_consecutive_losses: int = Field(default=5, ge=1, le=25)
    use_martingale: bool = False
    martingale_multiplier: float = Field(default=2.0, ge=1.1, le=10.0)


class TradeSignal(BaseModel):
    strategy_type: StrategyType
    contract_type: ContractType
    symbol: str
    duration_ticks: int
    barrier: Optional[int] = None
    reason: str
    entry_tick: float
    entry_digit: int


class TradeRecord(BaseModel):
    id: str
    timestamp: int
    symbol: str
    strategy: str
    contract_type: str
    barrier: Optional[int] = None
    duration_ticks: int
    stake: float
    entry_quote: float
    entry_digit: int
    exit_quote: Optional[float] = None
    exit_digit: Optional[int] = None
    status: str = "OPEN"  # OPEN, WON, LOST
    payout: float = 0.0
    profit: float = 0.0
    is_paper: bool = True
    reason: str = ""


class ManualOrderRequest(BaseModel):
    contract_type: ContractType
    duration_ticks: int = Field(default=1, ge=1, le=10)
    barrier: Optional[int] = Field(default=4, ge=0, le=9)
    stake: Optional[float] = Field(default=None, ge=0.35)


class ConnectionConfigRequest(BaseModel):
    app_id: str = "1089"
    api_token: str = ""
    symbol: str = "R_100"
    window_size: int = 100
    barrier: int = 4
    timeframe_sec: int = 60
