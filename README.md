# Deriv Quant Terminal — Automated Digits & Options Trading System

A full-stack, real-time quantitative analytics and automated trading platform for **Deriv Synthetic Indices (Digits & Options)** built with **Python (FastAPI + Asyncio WebSockets)** and a responsive **Tailwind CSS Web Terminal**.

## Features

- **Real-Time WebSocket Tick Streaming & OHLC Candle Aggregation**:
  - Connects directly to `wss://ws.derivws.com/websockets/v3` for live market ticks (`R_10`, `R_25`, `R_50`, `R_75`, `R_100`, `1HZ10V`, `1HZ100V`).
  - Automatic fallback simulator if offline so you can test strategies anywhere.
  - Preserves exact trailing zeroes using symbol `pip_size` (`123.40` -> last digit `0`).
- **Last-Digit Distribution Matrix (0–9)**:
  - Rolling window frequency percentages, hottest/coldest digit badges, Even/Odd meter, Over/Under barrier meter, and recent digit tape.
- **Automated Strategy Engine**:
  - `EVEN_ODD_STREAK`: Streak reversal for `DIGITEVEN` / `DIGITODD`.
  - `OVER_UNDER_EDGE`: Statistical barrier compression for `DIGITOVER` / `DIGITUNDER`.
  - `MATCH_DIFF_COLD`: Mean-reversion triggers on coldest digit (`DIGITDIFF` / `DIGITMATCH`).
  - `RISE_FALL_MOMENTUM`: Multi-tick micro-trend breakout for `CALL` / `PUT`.
- **1-Click Manual Execution & Paper Sim Mode**:
  - Trade in **Paper Simulation Mode** using live Deriv market ticks, or connect a Deriv Demo/Real API token for live contract execution.
- **Risk & Stake Management**:
  - Configurable Base Stake, Take Profit, Stop Loss, Max Consecutive Losses, and optional Martingale multiplier.

---

## Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure Environment (Optional)

Copy `.env.example` to `.env` and set your `DERIV_APP_ID` (defaults to `1089`) and optional `DERIV_API_TOKEN`:

```bash
cp .env.example .env
```

*(You can also configure your App ID and API Token directly from the Web UI via the **API Settings** button.)*

### 3. Run the Platform

```bash
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Open **[http://127.0.0.1:8000](http://127.0.0.1:8000)** in your browser.

---

## Running Unit Tests

```bash
pytest -v
```
