import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, Set

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.config import SUPPORTED_SYMBOLS, settings
from backend.deriv_client import DerivTradingHub
from backend.models import (
    ConnectionConfigRequest,
    ManualOrderRequest,
    RiskConfig,
    StrategyConfig,
)
from backend.risk_manager import RiskManager
from backend.strategy_engine import StrategyEngine
from backend.stream_engine import StreamEngine

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


class ClientBroadcaster:
    def __init__(self) -> None:
        self.clients: Set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self.clients.discard(ws)

    async def broadcast(self, payload: Dict[str, Any]) -> None:
        if not self.clients:
            return
        stale: list[WebSocket] = []
        for ws in list(self.clients):
            try:
                await ws.send_json(payload)
            except Exception:
                stale.append(ws)
        for ws in stale:
            self.clients.discard(ws)


broadcaster = ClientBroadcaster()
stream_engine = StreamEngine(symbol=settings.default_symbol)
strategy_engine = StrategyEngine()
risk_manager = RiskManager()
trading_hub = DerivTradingHub(
    app_id=settings.deriv_app_id,
    api_token=settings.deriv_api_token,
    symbol=settings.default_symbol,
    stream_engine=stream_engine,
    strategy_engine=strategy_engine,
    risk_manager=risk_manager,
    broadcast_cb=broadcaster.broadcast,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await trading_hub.start()
    yield
    await trading_hub.stop()


app = FastAPI(
    title="Deriv Digits & Options Automated Trading System",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/symbols")
async def get_symbols():
    return {"symbols": SUPPORTED_SYMBOLS}


@app.get("/api/snapshot")
async def get_snapshot():
    return trading_hub.get_full_snapshot()


@app.post("/api/connection")
async def update_connection(req: ConnectionConfigRequest):
    await trading_hub.reconfigure(
        app_id=req.app_id,
        api_token=req.api_token,
        symbol=req.symbol,
        window_size=req.window_size,
        barrier=req.barrier,
        timeframe_sec=req.timeframe_sec,
    )
    return {"status": "ok", "snapshot": trading_hub.get_full_snapshot()}


@app.post("/api/strategy")
async def update_strategy(config: StrategyConfig):
    config.symbol = trading_hub.symbol
    strategy_engine.update_config(config)
    stream_engine.window_size = config.window_size
    stream_engine.barrier = config.barrier
    if config.enabled:
        risk_manager.halt_reason = None
    await broadcaster.broadcast(
        {
            "type": "strategy_updated",
            "strategy_config": strategy_engine.config.model_dump(),
            "digit_stats": stream_engine.get_digit_stats().model_dump(),
        }
    )
    return {"status": "ok", "strategy_config": strategy_engine.config.model_dump()}


@app.post("/api/risk")
async def update_risk(config: RiskConfig):
    risk_manager.update_config(config)
    await broadcaster.broadcast(
        {
            "type": "risk_updated",
            "risk_summary": risk_manager.get_summary(),
        }
    )
    return {"status": "ok", "risk_summary": risk_manager.get_summary()}


@app.post("/api/risk/reset")
async def reset_risk_session():
    risk_manager.reset_session()
    if trading_hub.account_info.get("loginid") == "PAPER-SIM":
        trading_hub.account_info["balance"] = 10000.0
    await broadcaster.broadcast(
        {
            "type": "session_reset",
            "risk_summary": risk_manager.get_summary(),
            "account": trading_hub.account_info,
            "trades": [],
        }
    )
    return {"status": "ok", "risk_summary": risk_manager.get_summary()}


@app.post("/api/trade/manual")
async def place_manual_trade(order: ManualOrderRequest):
    trade = await trading_hub.execute_manual_order(order)
    return {"status": "ok", "trade": trade.model_dump()}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await broadcaster.connect(ws)
    try:
        await ws.send_json(trading_hub.get_full_snapshot())
        while True:
            data = await ws.receive_text()
            if data == "ping":
                await ws.send_json({"type": "pong"})
    except WebSocketDisconnect:
        broadcaster.disconnect(ws)
    except Exception:
        broadcaster.disconnect(ws)


app.mount("/css", StaticFiles(directory=str(FRONTEND_DIR / "css")), name="css")
app.mount("/js", StaticFiles(directory=str(FRONTEND_DIR / "js")), name="js")


@app.get("/")
async def serve_index():
    return FileResponse(str(FRONTEND_DIR / "index.html"))
