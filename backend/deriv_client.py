import asyncio
import json
import logging
import math
import random
import time
import uuid
from typing import Any, Callable, Coroutine, Dict, List, Optional

import websockets

from backend.models import (
    ContractType,
    ManualOrderRequest,
    TickData,
    TradeRecord,
    TradeSignal,
)
from backend.risk_manager import (
    RiskManager,
    estimate_payout_ratio,
    evaluate_contract_outcome,
)
from backend.strategy_engine import StrategyEngine
from backend.stream_engine import StreamEngine, get_default_pip_size

logger = logging.getLogger("deriv_client")


class PendingPaperTrade:
    def __init__(self, record: TradeRecord, remaining_ticks: int) -> None:
        self.record = record
        self.remaining_ticks = remaining_ticks


class DerivTradingHub:
    """
    Manages the connection to Deriv WebSocket API (with automatic synthetic fallback
    if offline), processes ticks through StreamEngine & StrategyEngine, executes
    paper or live trades, and broadcasts state updates to connected UI clients.
    """

    def __init__(
        self,
        app_id: str,
        api_token: str,
        symbol: str,
        stream_engine: StreamEngine,
        strategy_engine: StrategyEngine,
        risk_manager: RiskManager,
        broadcast_cb: Callable[[Dict[str, Any]], Coroutine[Any, Any, None]],
    ) -> None:
        self.app_id = app_id or "1089"
        self.api_token = api_token or ""
        self.symbol = symbol
        self.stream_engine = stream_engine
        self.strategy_engine = strategy_engine
        self.risk_manager = risk_manager
        self.broadcast_cb = broadcast_cb

        self.ws: Optional[ Any ] = None
        self.connected_to_deriv: bool = False
        self.authorized: bool = False
        self.account_info: Dict[str, Any] = {
            "loginid": "PAPER-SIM",
            "currency": "USD",
            "balance": 10000.0,
            "is_virtual": True,
        }
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._reconnect_event = asyncio.Event()
        self.pending_paper_trades: List[PendingPaperTrade] = []
        self.live_open_contracts: Dict[int, TradeRecord] = {}

    @property
    def ws_url(self) -> str:
        return f"wss://ws.derivws.com/websockets/v3?app_id={self.app_id}"

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._run_loop())

    async def stop(self) -> None:
        self._running = False
        self._reconnect_event.set()
        if self.ws:
            try:
                await self.ws.close()
            except Exception:
                pass
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def reconfigure(
        self,
        app_id: str,
        api_token: str,
        symbol: str,
        window_size: int,
        barrier: int,
        timeframe_sec: int,
    ) -> None:
        symbol_changed = symbol != self.symbol
        creds_changed = (app_id != self.app_id) or (api_token != self.api_token)

        self.app_id = app_id or "1089"
        self.api_token = api_token or ""
        self.symbol = symbol
        self.stream_engine.window_size = window_size
        self.stream_engine.barrier = barrier
        self.stream_engine.timeframe_sec = timeframe_sec
        self.strategy_engine.config.symbol = symbol
        self.strategy_engine.config.window_size = window_size
        self.strategy_engine.config.barrier = barrier

        if symbol_changed:
            self.stream_engine.reset(symbol, get_default_pip_size(symbol))

        if creds_changed or symbol_changed:
            self._reconnect_event.set()
            if self.ws:
                try:
                    await self.ws.close()
                except Exception:
                    pass

    async def _run_loop(self) -> None:
        while self._running:
            self._reconnect_event.clear()
            try:
                await self._connect_and_stream()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.warning(f"Deriv WS disconnected ({exc}), switching to local tick generator...")
                self.connected_to_deriv = False
                self.authorized = False
                await self._run_fallback_simulator()

    async def _connect_and_stream(self) -> None:
        logger.info(f"Connecting to Deriv WebSocket: {self.ws_url}")
        async with websockets.connect(self.ws_url, ping_interval=20, close_timeout=5) as ws:
            self.ws = ws
            self.connected_to_deriv = True
            self.authorized = False

            if self.api_token.strip():
                await ws.send(json.dumps({"authorize": self.api_token.strip()}))
            else:
                self.account_info = {
                    "loginid": "PAPER-SIM",
                    "currency": "USD",
                    "balance": round(10000.0 + self.risk_manager.total_profit, 2),
                    "is_virtual": True,
                }

            # Request recent tick history + live stream subscription
            await ws.send(
                json.dumps(
                    {
                        "ticks_history": self.symbol,
                        "adjust_start_time": 1,
                        "count": 100,
                        "end": "latest",
                        "style": "ticks",
                        "subscribe": 1,
                    }
                )
            )

            await self._broadcast_status()

            while self._running and not self._reconnect_event.is_set():
                raw = await asyncio.wait_for(ws.recv(), timeout=35.0)
                msg = json.loads(raw)
                await self._handle_deriv_message(msg)

    async def _handle_deriv_message(self, msg: Dict[str, Any]) -> None:
        msg_type = msg.get("msg_type")

        if "error" in msg:
            err_msg = msg["error"].get("message", "Unknown Deriv API error")
            logger.error(f"Deriv API Error ({msg_type}): {err_msg}")
            await self.broadcast_cb({"type": "error", "message": err_msg})
            return

        if msg_type == "authorize":
            auth = msg.get("authorize", {})
            self.authorized = True
            self.account_info = {
                "loginid": auth.get("loginid", "DERIV"),
                "currency": auth.get("currency", "USD"),
                "balance": float(auth.get("balance", 0.0)),
                "is_virtual": bool(auth.get("is_virtual", 1)),
            }
            await self.ws.send(json.dumps({"balance": 1, "subscribe": 1}))
            await self._broadcast_status()

        elif msg_type == "balance":
            bal = msg.get("balance", {})
            self.account_info["balance"] = float(bal.get("balance", self.account_info["balance"]))
            await self._broadcast_status()

        elif msg_type == "history":
            history = msg.get("history", {})
            prices = history.get("prices", [])
            times = history.get("times", [])
            pip_size = msg.get("pip_size", get_default_pip_size(self.symbol))
            for q, t in zip(prices, times):
                self.stream_engine.process_tick(
                    float(q), int(t), symbol=self.symbol, pip_size=int(pip_size)
                )
            await self._broadcast_snapshot()

        elif msg_type == "tick":
            tick_obj = msg.get("tick", {})
            quote = float(tick_obj["quote"])
            epoch = int(tick_obj["epoch"])
            pip_size = int(tick_obj.get("pip_size", get_default_pip_size(self.symbol)))
            await self._on_new_tick(quote, epoch, pip_size)

        elif msg_type == "buy":
            buy_info = msg.get("buy", {})
            contract_id = buy_info.get("contract_id")
            req_id = msg.get(" passthrough", {}).get("trade_id") or msg.get("passthrough", {}).get("trade_id")
            if contract_id and self.ws:
                await self.ws.send(
                    json.dumps(
                        {
                            "proposal_open_contract": 1,
                            "contract_id": contract_id,
                            "subscribe": 1,
                            "passthrough": {"trade_id": req_id},
                        }
                    )
                )

        elif msg_type == "proposal_open_contract":
            poc = msg.get("proposal_open_contract", {})
            if poc.get("is_sold"):
                trade_id = msg.get("passthrough", {}).get("trade_id")
                await self._settle_live_contract(poc, trade_id)

    async def _run_fallback_simulator(self) -> None:
        """Generates realistic synthetic ticks if offline or Deriv WS is unreachable."""
        pip_size = get_default_pip_size(self.symbol)
        step_scale = 10 ** (-pip_size)
        price = 1000.00

        # Seed initial 60 ticks if empty
        now = int(time.time())
        if len(self.stream_engine.ticks) == 0:
            for i in range(60, 0, -1):
                delta = random.gauss(0, 8) * step_scale
                price = max(100.0, round(price + delta, pip_size))
                self.stream_engine.process_tick(price, now - i, self.symbol, pip_size)

        await self._broadcast_status()
        await self._broadcast_snapshot()

        while self._running and not self._reconnect_event.is_set():
            await asyncio.sleep(1.0)
            delta = random.gauss(0, 9) * step_scale
            price = max(100.0, round(price + delta, pip_size))
            await self._on_new_tick(price, int(time.time()), pip_size)

    async def _on_new_tick(self, quote: float, epoch: int, pip_size: int) -> None:
        tick = self.stream_engine.process_tick(quote, epoch, self.symbol, pip_size)

        # 1. Settle any pending paper trades whose tick duration has elapsed
        await self._process_pending_paper_trades(tick)

        # 2. Compute updated digit statistics
        stats = self.stream_engine.get_digit_stats()

        # 3. Check if automated Strategy Engine wants to fire a trade
        has_open_trade = len(self.pending_paper_trades) > 0 or len(self.live_open_contracts) > 0
        if self.strategy_engine.config.enabled and not has_open_trade:
            can_trade, _ = self.risk_manager.can_open_trade()
            if can_trade:
                signal = self.strategy_engine.evaluate(
                    tick, stats, list(self.stream_engine.ticks)
                )
                if signal:
                    await self.execute_signal(signal)
            else:
                # Auto-pause bot when risk limit is hit
                self.strategy_engine.config.enabled = False

        # 4. Broadcast live update to all connected Web UI clients
        await self.broadcast_cb(
            {
                "type": "tick_update",
                "tick": tick.model_dump(),
                "digit_stats": stats.model_dump(),
                "latest_candle": (
                    self.stream_engine.candles[-1].model_dump()
                    if self.stream_engine.candles
                    else None
                ),
                "risk_summary": self.risk_manager.get_summary(),
                "strategy_config": self.strategy_engine.config.model_dump(),
                "account": self.account_info,
            }
        )

    async def execute_manual_order(self, order: ManualOrderRequest) -> TradeRecord:
        last_tick = (
            self.stream_engine.ticks[-1]
            if self.stream_engine.ticks
            else self.stream_engine.process_tick(
                1000.0, int(time.time()), self.symbol, get_default_pip_size(self.symbol)
            )
        )
        signal = TradeSignal(
            strategy_type=self.strategy_engine.config.strategy_type,
            contract_type=order.contract_type,
            symbol=self.symbol,
            duration_ticks=order.duration_ticks,
            barrier=order.barrier,
            reason="Manual 1-Click Execution",
            entry_tick=last_tick.quote,
            entry_digit=last_tick.last_digit,
        )
        return await self.execute_signal(signal, custom_stake=order.stake)

    async def execute_signal(
        self, signal: TradeSignal, custom_stake: Optional[float] = None
    ) -> TradeRecord:
        stake = custom_stake if custom_stake is not None else self.risk_manager.get_next_stake()
        is_paper = (
            self.strategy_engine.config.paper_trading
            or not self.authorized
            or not self.connected_to_deriv
        )

        trade_id = f"TRD-{uuid.uuid4().hex[:6].upper()}"
        record = TradeRecord(
            id=trade_id,
            timestamp=int(time.time()),
            symbol=signal.symbol,
            strategy=signal.strategy_type.value,
            contract_type=signal.contract_type.value,
            barrier=signal.barrier,
            duration_ticks=signal.duration_ticks,
            stake=stake,
            entry_quote=signal.entry_tick,
            entry_digit=signal.entry_digit,
            status="OPEN",
            is_paper=is_paper,
            reason=signal.reason,
        )

        if is_paper:
            self.pending_paper_trades.append(
                PendingPaperTrade(record=record, remaining_ticks=signal.duration_ticks)
            )
        else:
            await self._send_live_buy(record)

        await self.broadcast_cb(
            {
                "type": "trade_opened",
                "trade": record.model_dump(),
            }
        )
        return record

    async def _send_live_buy(self, record: TradeRecord) -> None:
        if not self.ws or not self.authorized:
            self.pending_paper_trades.append(
                PendingPaperTrade(record=record, remaining_ticks=record.duration_ticks)
            )
            return

        parameters: Dict[str, Any] = {
            "amount": record.stake,
            "basis": "stake",
            "contract_type": record.contract_type,
            "currency": self.account_info.get("currency", "USD"),
            "duration": record.duration_ticks,
            "duration_unit": "t",
            "symbol": record.symbol,
        }
        if record.contract_type in (
            ContractType.DIGITOVER.value,
            ContractType.DIGITUNDER.value,
            ContractType.DIGITMATCH.value,
            ContractType.DIGITDIFF.value,
        ):
            parameters["barrier"] = str(record.barrier if record.barrier is not None else 4)

        self.live_open_contracts[hash(record.id)] = record
        await self.ws.send(
            json.dumps(
                {
                    "buy": 1,
                    "price": record.stake,
                    "parameters": parameters,
                    "passthrough": {"trade_id": record.id},
                }
            )
        )

    async def _settle_live_contract(
        self, poc: Dict[str, Any], trade_id: Optional[str]
    ) -> None:
        record = None
        for k, v in list(self.live_open_contracts.items()):
            if v.id == trade_id:
                record = self.live_open_contracts.pop(k)
                break
        if not record:
            return

        profit = float(poc.get("profit", 0.0))
        sell_price = float(poc.get("sell_price", 0.0))
        exit_tick = float(poc.get("exit_tick", record.entry_quote))
        _, exit_digit = (
            self.stream_engine.ticks[-1].formatted_quote,
            self.stream_engine.ticks[-1].last_digit,
        ) if self.stream_engine.ticks else ("", 0)

        record.exit_quote = exit_tick
        record.exit_digit = exit_digit
        record.payout = round(sell_price, 2)
        record.profit = round(profit, 2)
        record.status = "WON" if profit > 0 else "LOST"

        self.risk_manager.record_completed_trade(record)
        await self.broadcast_cb(
            {
                "type": "trade_settled",
                "trade": record.model_dump(),
                "risk_summary": self.risk_manager.get_summary(),
                "account": self.account_info,
            }
        )

    async def _process_pending_paper_trades(self, tick: TickData) -> None:
        if not self.pending_paper_trades:
            return

        remaining: List[PendingPaperTrade] = []
        for item in self.pending_paper_trades:
            item.remaining_ticks -= 1
            if item.remaining_ticks <= 0:
                rec = item.record
                won = evaluate_contract_outcome(
                    contract_type=rec.contract_type,
                    entry_quote=rec.entry_quote,
                    exit_quote=tick.quote,
                    exit_digit=tick.last_digit,
                    barrier=rec.barrier,
                )
                rec.exit_quote = tick.quote
                rec.exit_digit = tick.last_digit
                if won:
                    ratio = estimate_payout_ratio(rec.contract_type, rec.barrier)
                    rec.profit = round(rec.stake * ratio, 2)
                    rec.payout = round(rec.stake + rec.profit, 2)
                    rec.status = "WON"
                else:
                    rec.profit = round(-rec.stake, 2)
                    rec.payout = 0.0
                    rec.status = "LOST"

                self.risk_manager.record_completed_trade(rec)
                if self.account_info.get("loginid") == "PAPER-SIM":
                    self.account_info["balance"] = round(
                        10000.0 + self.risk_manager.total_profit, 2
                    )

                await self.broadcast_cb(
                    {
                        "type": "trade_settled",
                        "trade": rec.model_dump(),
                        "risk_summary": self.risk_manager.get_summary(),
                        "account": self.account_info,
                    }
                )
            else:
                remaining.append(item)

        self.pending_paper_trades = remaining

    async def _broadcast_status(self) -> None:
        await self.broadcast_cb(
            {
                "type": "connection_status",
                "connected_to_deriv": self.connected_to_deriv,
                "authorized": self.authorized,
                "symbol": self.symbol,
                "account": self.account_info,
            }
        )

    async def _broadcast_snapshot(self) -> None:
        await self.broadcast_cb(self.get_full_snapshot())

    def get_full_snapshot(self) -> Dict[str, Any]:
        return {
            "type": "snapshot",
            "connected_to_deriv": self.connected_to_deriv,
            "authorized": self.authorized,
            "symbol": self.symbol,
            "account": self.account_info,
            "digit_stats": self.stream_engine.get_digit_stats().model_dump(),
            "candles": [c.model_dump() for c in self.stream_engine.get_candles(60)],
            "recent_ticks": [t.model_dump() for t in list(self.stream_engine.ticks)[-40:]],
            "strategy_config": self.strategy_engine.config.model_dump(),
            "risk_summary": self.risk_manager.get_summary(),
            "trades": [t.model_dump() for t in self.risk_manager.trade_history[:50]],
        }
