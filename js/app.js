(() => {
  const state = {
    symbol: "R_100",
    connectedToDeriv: false,
    authorized: false,
    botEnabled: false,
    chartMode: "ticks", // "ticks" | "candles"
    ticks: [],
    candles: [],
    digitStats: null,
    trades: [],
  };

  // DOM Elements
  const connBadge = document.getElementById("connBadge");
  const symbolSelect = document.getElementById("symbolSelect");
  const accountLoginId = document.getElementById("accountLoginId");
  const accountBalance = document.getElementById("accountBalance");
  const liveQuote = document.getElementById("liveQuote");
  const liveEpoch = document.getElementById("liveEpoch");
  const liveLastDigit = document.getElementById("liveLastDigit");
  const liveParityBadge = document.getElementById("liveParityBadge");
  const streakSummary = document.getElementById("streakSummary");
  const evenPctLabel = document.getElementById("evenPctLabel");
  const oddPctLabel = document.getElementById("oddPctLabel");
  const evenBar = document.getElementById("evenBar");
  const oddBar = document.getElementById("oddBar");
  const barrierLabelMetric = document.getElementById("barrierLabelMetric");
  const overPctLabel = document.getElementById("overPctLabel");
  const underPctLabel = document.getElementById("underPctLabel");
  const overBar = document.getElementById("overBar");
  const underBar = document.getElementById("underBar");
  const digitGrid = document.getElementById("digitGrid");
  const recentDigitsTape = document.getElementById("recentDigitsTape");
  const hottestDigitLabel = document.getElementById("hottestDigitLabel");
  const coldestDigitLabel = document.getElementById("coldestDigitLabel");
  const windowCountBadge = document.getElementById("windowCountBadge");
  const tradeHistoryBody = document.getElementById("tradeHistoryBody");

  // Strategy & Risk Controls
  const botStateBadge = document.getElementById("botStateBadge");
  const sessionPnl = document.getElementById("sessionPnl");
  const sessionWinRate = document.getElementById("sessionWinRate");
  const sessionWL = document.getElementById("sessionWL");
  const haltAlertBox = document.getElementById("haltAlertBox");
  const paperTradingToggle = document.getElementById("paperTradingToggle");
  const strategySelect = document.getElementById("strategySelect");
  const streakThresholdInput = document.getElementById("streakThresholdInput");
  const barrierInput = document.getElementById("barrierInput");
  const durationTicksInput = document.getElementById("durationTicksInput");
  const toggleBotBtn = document.getElementById("toggleBotBtn");

  const nextStakeLabel = document.getElementById("nextStakeLabel");
  const baseStakeInput = document.getElementById("baseStakeInput");
  const maxLossStreakInput = document.getElementById("maxLossStreakInput");
  const takeProfitInput = document.getElementById("takeProfitInput");
  const stopLossInput = document.getElementById("stopLossInput");
  const useMartingaleToggle = document.getElementById("useMartingaleToggle");
  const martingaleMultInput = document.getElementById("martingaleMultInput");
  const saveRiskBtn = document.getElementById("saveRiskBtn");
  const resetSessionBtn = document.getElementById("resetSessionBtn");

  // Chart Canvas
  const canvas = document.getElementById("marketCanvas");
  const ctx = canvas.getContext("2d");
  const chartModeTicksBtn = document.getElementById("chartModeTicks");
  const chartModeCandlesBtn = document.getElementById("chartModeCandles");

  // Initialize 0-9 digit cells
  function initDigitGrid() {
    digitGrid.innerHTML = "";
    for (let d = 0; d <= 9; d++) {
      const cell = document.createElement("div");
      cell.id = `digit-cell-${d}`;
      cell.className =
        "digit-cell bg-slate-950 border border-slate-800 rounded-lg p-2.5 flex flex-col items-center justify-between relative overflow-hidden";
      cell.innerHTML = `
        <span class="text-xs text-slate-400 font-mono">Digit</span>
        <span class="text-xl font-mono font-extrabold text-white my-0.5">${d}</span>
        <span id="digit-pct-${d}" class="text-xs font-mono font-semibold text-slate-300">10.0%</span>
        <div class="w-full h-1.5 bg-slate-800 rounded-full mt-2 overflow-hidden">
          <div id="digit-bar-${d}" class="h-full bg-slate-500 transition-all duration-300" style="width: 10%"></div>
        </div>
      `;
      digitGrid.appendChild(cell);
    }
  }

  function updateDigitHeatmap(stats, activeDigit) {
    if (!stats) return;
    state.digitStats = stats;

    windowCountBadge.textContent = `(${stats.total_ticks} / ${stats.window_size} ticks)`;
    hottestDigitLabel.textContent = `${stats.hottest_digit} (${stats.percentages[stats.hottest_digit] || 0}%)`;
    coldestDigitLabel.textContent = `${stats.coldest_digit} (${stats.percentages[stats.coldest_digit] || 0}%)`;

    evenPctLabel.textContent = `E: ${stats.even_pct}%`;
    oddPctLabel.textContent = `O: ${stats.odd_pct}%`;
    evenBar.style.width = `${stats.even_pct}%`;
    oddBar.style.width = `${stats.odd_pct}%`;

    barrierLabelMetric.textContent = stats.barrier;
    overPctLabel.textContent = `Over: ${stats.over_pct}%`;
    underPctLabel.textContent = `Under: ${stats.under_pct}%`;
    overBar.style.width = `${stats.over_pct}%`;
    underBar.style.width = `${stats.under_pct}%`;

    if (stats.current_even_streak > 0) {
      streakSummary.textContent = `Streak: ${stats.current_even_streak}x EVEN`;
    } else if (stats.current_odd_streak > 0) {
      streakSummary.textContent = `Streak: ${stats.current_odd_streak}x ODD`;
    } else {
      streakSummary.textContent = "Streak: --";
    }

    for (let d = 0; d <= 9; d++) {
      const cell = document.getElementById(`digit-cell-${d}`);
      const pctEl = document.getElementById(`digit-pct-${d}`);
      const barEl = document.getElementById(`digit-bar-${d}`);
      const pct = stats.percentages[d] ?? 0;

      pctEl.textContent = `${pct.toFixed(1)}%`;
      barEl.style.width = `${Math.min(100, pct * 4)}%`;

      cell.classList.toggle("active-digit", d === activeDigit);

      if (d === stats.hottest_digit) {
        barEl.className = "h-full bg-emerald-500 transition-all duration-300";
        pctEl.className = "text-xs font-mono font-bold text-emerald-400";
      } else if (d === stats.coldest_digit) {
        barEl.className = "h-full bg-sky-500 transition-all duration-300";
        pctEl.className = "text-xs font-mono font-bold text-sky-400";
      } else {
        barEl.className = "h-full bg-slate-500 transition-all duration-300";
        pctEl.className = "text-xs font-mono font-semibold text-slate-300";
      }
    }

    // Render recent digits tape
    recentDigitsTape.innerHTML = "";
    (stats.recent_digits || []).slice(-22).forEach((d, idx, arr) => {
      const badge = document.createElement("span");
      const isEven = d % 2 === 0;
      const isLatest = idx === arr.length - 1;
      badge.className = `w-6 h-6 rounded flex items-center justify-center text-xs font-mono font-bold shrink-0 ${
        isLatest
          ? "ring-2 ring-emerald-400 bg-emerald-500/20 text-white"
          : isEven
          ? "bg-sky-500/15 text-sky-300 border border-sky-500/30"
          : "bg-purple-500/15 text-purple-300 border border-purple-500/30"
      }`;
      badge.textContent = d;
      recentDigitsTape.appendChild(badge);
    });
  }

  function updateTickBanner(tick) {
    if (!tick) return;
    liveQuote.textContent = tick.formatted_quote;
    const dt = new Date(tick.epoch * 1000);
    liveEpoch.textContent = dt.toLocaleTimeString();
    liveLastDigit.textContent = tick.last_digit;

    const isEven = tick.last_digit % 2 === 0;
    liveParityBadge.textContent = isEven ? "EVEN" : "ODD";
    liveParityBadge.className = isEven
      ? "text-xs px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30 font-semibold"
      : "text-xs px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 font-semibold";
  }

  function updateConnectionHeader(connected, authorized, account, symbol) {
    state.connectedToDeriv = connected;
    state.authorized = authorized;
    if (symbol && symbolSelect.value !== symbol) {
      symbolSelect.value = symbol;
    }
    if (connected) {
      connBadge.textContent = authorized ? "Deriv Live Auth" : "Deriv Live Stream";
      connBadge.className =
        "text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30";
    } else {
      connBadge.textContent = "Local Sim Stream";
      connBadge.className =
        "text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30";
    }

    if (account) {
      accountLoginId.textContent = account.loginid || "PAPER-SIM";
      const bal = Number(account.balance || 0);
      accountBalance.textContent = `$${bal.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    }
  }

  function updateRiskAndBotUI(riskSummary, strategyConfig) {
    if (riskSummary) {
      const pnl = Number(riskSummary.total_profit || 0);
      sessionPnl.textContent = `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`;
      sessionPnl.className = `text-base font-mono font-bold ${
        pnl > 0 ? "text-emerald-400" : pnl < 0 ? "text-rose-400" : "text-white"
      }`;
      sessionWinRate.textContent = `${riskSummary.win_rate.toFixed(1)}%`;
      sessionWL.textContent = `${riskSummary.wins} / ${riskSummary.losses}`;
      nextStakeLabel.textContent = `$${Number(riskSummary.current_stake || 1).toFixed(2)}`;

      if (riskSummary.halt_reason) {
        haltAlertBox.textContent = `Bot Halted: ${riskSummary.halt_reason}`;
        haltAlertBox.classList.remove("hidden");
      } else {
        haltAlertBox.classList.add("hidden");
      }
    }

    if (strategyConfig) {
      state.botEnabled = Boolean(strategyConfig.enabled);
      if (state.botEnabled) {
        botStateBadge.textContent = "BOT RUNNING";
        botStateBadge.className =
          "text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold animate-pulse";
        toggleBotBtn.textContent = "Stop Automated Bot";
        toggleBotBtn.className =
          "w-full py-2.5 px-4 rounded-lg font-bold text-xs uppercase tracking-wider bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/20 transition";
      } else {
        botStateBadge.textContent = "BOT IDLE";
        botStateBadge.className =
          "text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-400 font-medium";
        toggleBotBtn.textContent = "Start Automated Bot";
        toggleBotBtn.className =
          "w-full py-2.5 px-4 rounded-lg font-bold text-xs uppercase tracking-wider bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 transition";
      }
    }
  }

  function renderTradesTable() {
    if (!state.trades.length) {
      tradeHistoryBody.innerHTML = `
        <tr>
          <td colspan="7" class="py-6 text-center text-slate-500 font-sans">
            No trades executed yet. Start the automated bot or fire a manual 1-click contract.
          </td>
        </tr>
      `;
      return;
    }

    tradeHistoryBody.innerHTML = state.trades
      .slice(0, 30)
      .map((t) => {
        const badgeColor =
          t.status === "WON"
            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
            : t.status === "LOST"
            ? "bg-rose-500/20 text-rose-300 border-rose-500/30"
            : "bg-amber-500/20 text-amber-300 border-amber-500/30";
        const profitStr =
          t.status === "OPEN"
            ? "..."
            : `${t.profit >= 0 ? "+" : ""}$${Number(t.profit).toFixed(2)}`;
        const profitColor =
          t.profit > 0
            ? "text-emerald-400"
            : t.profit < 0
            ? "text-rose-400"
            : "text-slate-400";
        const barrierText = t.barrier !== null && t.barrier !== undefined ? ` (${t.barrier})` : "";

        return `
          <tr class="hover:bg-slate-800/40">
            <td class="py-2 px-2 text-slate-400">${t.id}</td>
            <td class="py-2 px-2 font-semibold text-white">${t.contract_type}${barrierText}</td>
            <td class="py-2 px-2">${t.entry_digit} &rarr; ${t.exit_digit ?? "-"}</td>
            <td class="py-2 px-2">$${Number(t.stake).toFixed(2)}</td>
            <td class="py-2 px-2">
              <span class="px-2 py-0.5 rounded border text-[10px] ${badgeColor}">${t.status}</span>
            </td>
            <td class="py-2 px-2 font-bold ${profitColor}">${profitStr}</td>
            <td class="py-2 px-2 font-sans text-slate-400 truncate max-w-[200px]" title="${t.reason}">${t.reason}</td>
          </tr>
        `;
      })
      .join("");
  }

  function drawChart() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    if (state.chartMode === "ticks") {
      const pts = state.ticks.slice(-50);
      if (pts.length < 2) return;

      const quotes = pts.map((p) => p.quote);
      const minQ = Math.min(...quotes);
      const maxQ = Math.max(...quotes);
      const range = maxQ - minQ || 1;

      ctx.strokeStyle = "#10b981";
      ctx.lineWidth = 2;
      ctx.beginPath();

      pts.forEach((pt, i) => {
        const x = (i / (pts.length - 1)) * (w - 20) + 10;
        const y = h - 15 - ((pt.quote - minQ) / range) * (h - 30);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Draw latest tick point
      const last = pts[pts.length - 1];
      const lx = w - 10;
      const ly = h - 15 - ((last.quote - minQ) / range) * (h - 30);
      ctx.fillStyle = "#34d399";
      ctx.beginPath();
      ctx.arc(lx, ly, 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const candles = state.candles.slice(-30);
      if (!candles.length) return;

      const highs = candles.map((c) => c.high);
      const lows = candles.map((c) => c.low);
      const minP = Math.min(...lows);
      const maxP = Math.max(...highs);
      const range = maxP - minP || 1;

      const slotWidth = (w - 20) / candles.length;
      const bodyWidth = Math.max(4, slotWidth * 0.6);

      candles.forEach((c, idx) => {
        const xCenter = 10 + idx * slotWidth + slotWidth / 2;
        const yHigh = h - 15 - ((c.high - minP) / range) * (h - 30);
        const yLow = h - 15 - ((c.low - minP) / range) * (h - 30);
        const yOpen = h - 15 - ((c.open - minP) / range) * (h - 30);
        const yClose = h - 15 - ((c.close - minP) / range) * (h - 30);

        const bullish = c.close >= c.open;
        ctx.strokeStyle = bullish ? "#10b981" : "#f43f5e";
        ctx.fillStyle = bullish ? "#10b981" : "#f43f5e";

        ctx.beginPath();
        ctx.moveTo(xCenter, yHigh);
        ctx.lineTo(xCenter, yLow);
        ctx.stroke();

        const top = Math.min(yOpen, yClose);
        const boxHeight = Math.max(2, Math.abs(yClose - yOpen));
        ctx.fillRect(xCenter - bodyWidth / 2, top, bodyWidth, boxHeight);
      });
    }
  }

  // Connect to Backend WebSocket
  function connectWS() {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === "snapshot") {
        state.symbol = msg.symbol;
        state.ticks = msg.recent_ticks || [];
        state.candles = msg.candles || [];
        state.trades = msg.trades || [];
        updateConnectionHeader(msg.connected_to_deriv, msg.authorized, msg.account, msg.symbol);
        const lastTick = state.ticks[state.ticks.length - 1];
        if (lastTick) updateTickBanner(lastTick);
        updateDigitHeatmap(msg.digit_stats, lastTick ? lastTick.last_digit : -1);
        updateRiskAndBotUI(msg.risk_summary, msg.strategy_config);
        renderTradesTable();
        drawChart();
      } else if (msg.type === "tick_update") {
        state.ticks.push(msg.tick);
        if (state.ticks.length > 100) state.ticks.shift();
        if (msg.latest_candle) {
          const existingIdx = state.candles.findIndex(
            (c) => c.open_time === msg.latest_candle.open_time
          );
          if (existingIdx >= 0) state.candles[existingIdx] = msg.latest_candle;
          else state.candles.push(msg.latest_candle);
        }
        updateTickBanner(msg.tick);
        updateDigitHeatmap(msg.digit_stats, msg.tick.last_digit);
        updateRiskAndBotUI(msg.risk_summary, msg.strategy_config);
        if (msg.account) {
          updateConnectionHeader(state.connectedToDeriv, state.authorized, msg.account, state.symbol);
        }
        drawChart();
      } else if (msg.type === "trade_opened") {
        state.trades.unshift(msg.trade);
        renderTradesTable();
      } else if (msg.type === "trade_settled") {
        const idx = state.trades.findIndex((t) => t.id === msg.trade.id);
        if (idx >= 0) state.trades[idx] = msg.trade;
        else state.trades.unshift(msg.trade);
        updateRiskAndBotUI(msg.risk_summary, null);
        if (msg.account) {
          updateConnectionHeader(state.connectedToDeriv, state.authorized, msg.account, state.symbol);
        }
        renderTradesTable();
      } else if (msg.type === "strategy_updated") {
        updateRiskAndBotUI(null, msg.strategy_config);
        if (msg.digit_stats) updateDigitHeatmap(msg.digit_stats, -1);
      } else if (msg.type === "risk_updated" || msg.type === "session_reset") {
        if (msg.trades) state.trades = msg.trades;
        updateRiskAndBotUI(msg.risk_summary, null);
        if (msg.account) {
          updateConnectionHeader(state.connectedToDeriv, state.authorized, msg.account, state.symbol);
        }
        renderTradesTable();
      } else if (msg.type === "connection_status") {
        updateConnectionHeader(msg.connected_to_deriv, msg.authorized, msg.account, msg.symbol);
      }
    };

    ws.onclose = () => {
      setTimeout(connectWS, 2000);
    };
  }

  // Event Listeners
  symbolSelect.addEventListener("change", async () => {
    const symbol = symbolSelect.value;
    await fetch("/api/connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: document.getElementById("appIdInput").value || "1089",
        api_token: document.getElementById("apiTokenInput").value || "",
        symbol,
        window_size: Number(document.getElementById("windowSizeInput").value || 100),
        barrier: Number(barrierInput.value || 4),
        timeframe_sec: 60,
      }),
    });
  });

  toggleBotBtn.addEventListener("click", async () => {
    const nextEnabled = !state.botEnabled;
    await fetch("/api/strategy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: nextEnabled,
        strategy_type: strategySelect.value,
        symbol: symbolSelect.value,
        contract_type: "DIGITEVEN",
        duration_ticks: Number(durationTicksInput.value || 1),
        barrier: Number(barrierInput.value || 4),
        streak_threshold: Number(streakThresholdInput.value || 4),
        window_size: Number(document.getElementById("windowSizeInput").value || 100),
        paper_trading: paperTradingToggle.checked,
      }),
    });
  });

  document.querySelectorAll(".manual-trade-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const contractType = btn.getAttribute("data-contract");
      await fetch("/api/trade/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract_type: contractType,
          duration_ticks: Number(durationTicksInput.value || 1),
          barrier: Number(barrierInput.value || 4),
        }),
      });
    });
  });

  saveRiskBtn.addEventListener("click", async () => {
    await fetch("/api/risk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base_stake: Number(baseStakeInput.value || 1.0),
        currency: "USD",
        take_profit: Number(takeProfitInput.value || 20.0),
        stop_loss: Number(stopLossInput.value || 15.0),
        max_consecutive_losses: Number(maxLossStreakInput.value || 5),
        use_martingale: useMartingaleToggle.checked,
        martingale_multiplier: Number(martingaleMultInput.value || 2.0),
      }),
    });
  });

  resetSessionBtn.addEventListener("click", async () => {
    await fetch("/api/risk/reset", { method: "POST" });
  });

  chartModeTicksBtn.addEventListener("click", () => {
    state.chartMode = "ticks";
    chartModeTicksBtn.className =
      "text-xs px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-medium";
    chartModeCandlesBtn.className =
      "text-xs px-2.5 py-1 rounded bg-slate-800 text-slate-400 hover:text-white";
    drawChart();
  });

  chartModeCandlesBtn.addEventListener("click", () => {
    state.chartMode = "candles";
    chartModeCandlesBtn.className =
      "text-xs px-2.5 py-1 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-medium";
    chartModeTicksBtn.className =
      "text-xs px-2.5 py-1 rounded bg-slate-800 text-slate-400 hover:text-white";
    drawChart();
  });

  // Modal handlers
  const apiModal = document.getElementById("apiModal");
  document.getElementById("openApiModalBtn").addEventListener("click", () => {
    apiModal.classList.remove("hidden");
    apiModal.classList.add("flex");
  });
  const closeModal = () => {
    apiModal.classList.add("hidden");
    apiModal.classList.remove("flex");
  };
  document.getElementById("closeApiModalBtn").addEventListener("click", closeModal);
  document.getElementById("cancelApiModalBtn").addEventListener("click", closeModal);
  document.getElementById("saveApiModalBtn").addEventListener("click", async () => {
    await fetch("/api/connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: document.getElementById("appIdInput").value || "1089",
        api_token: document.getElementById("apiTokenInput").value || "",
        symbol: symbolSelect.value,
        window_size: Number(document.getElementById("windowSizeInput").value || 100),
        barrier: Number(barrierInput.value || 4),
        timeframe_sec: 60,
      }),
    });
    closeModal();
  });

  window.addEventListener("resize", drawChart);

  initDigitGrid();
  connectWS();
})();
