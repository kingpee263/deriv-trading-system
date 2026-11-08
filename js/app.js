(() => {
  const PIP_SIZES = {
    R_10: 3,
    R_25: 3,
    R_50: 4,
    R_75: 4,
    R_100: 2,
    "1HZ10V": 2,
    "1HZ25V": 2,
    "1HZ50V": 2,
    "1HZ75V": 2,
    "1HZ100V": 2,
  };

  const PAYOUT_MULTIPLIERS = {
    DIGITEVEN: 0.95,
    DIGITODD: 0.95,
    CALL: 0.95,
    PUT: 0.95,
    DIGITDIFF: 0.09,
    DIGITMATCH: 7.9,
  };

  const state = {
    mode: "detecting", // "backend" | "direct_deriv"
    symbol: "R_100",
    appId: "1089",
    apiToken: "",
    windowSize: 100,
    barrier: 4,
    timeframeSec: 60,
    connectedToDeriv: false,
    authorized: false,
    botEnabled: false,
    chartMode: "ticks", // "ticks" | "candles"
    ticks: [],
    candles: [],
    digitStats: null,
    trades: [],
    pendingPaperTrades: [],
    account: {
      loginid: "PAPER-SIM",
      currency: "USD",
      balance: 10000.0,
      is_virtual: true,
    },
    strategyConfig: {
      enabled: false,
      strategy_type: "EVEN_ODD_STREAK",
      symbol: "R_100",
      contract_type: "DIGITEVEN",
      duration_ticks: 1,
      barrier: 4,
      streak_threshold: 4,
      window_size: 100,
      paper_trading: true,
    },
    risk: {
      base_stake: 1.0,
      take_profit: 20.0,
      stop_loss: 15.0,
      max_consecutive_losses: 5,
      use_martingale: false,
      martingale_multiplier: 2.0,
      current_stake: 1.0,
      consecutive_losses: 0,
      total_profit: 0.0,
      total_trades: 0,
      wins: 0,
      losses: 0,
      win_rate: 0.0,
      halt_reason: null,
    },
  };

  let directDerivWS = null;

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
      connBadge.textContent = "Connecting Stream...";
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
      sessionWinRate.textContent = `${Number(riskSummary.win_rate || 0).toFixed(1)}%`;
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

  // ============================================================================
  // Standalone Browser Engine (Used when hosted on GitHub Pages without FastAPI)
  // ============================================================================

  function extractLastDigitClient(quote, pipSize) {
    const formatted = Number(quote).toFixed(pipSize);
    const lastChar = formatted.charAt(formatted.length - 1);
    return { formatted, lastDigit: parseInt(lastChar, 10) || 0 };
  }

  function computeClientDigitStats() {
    const win = state.windowSize;
    const bar = state.barrier;
    const slice = state.ticks.slice(-win);
    const total = slice.length;
    const counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };

    let evenCount = 0;
    let oddCount = 0;
    let overCount = 0;
    let underCount = 0;

    slice.forEach((t) => {
      const d = t.last_digit;
      counts[d] = (counts[d] || 0) + 1;
      if (d % 2 === 0) evenCount++;
      else oddCount++;
      if (d > bar) overCount++;
      else if (d < bar) underCount++;
    });

    const percentages = {};
    for (let d = 0; d <= 9; d++) {
      percentages[d] = total > 0 ? Number(((counts[d] / total) * 100).toFixed(2)) : 0;
    }

    let evenStreak = 0;
    let oddStreak = 0;
    for (let i = slice.length - 1; i >= 0; i--) {
      if (slice[i].last_digit % 2 === 0) {
        if (oddStreak > 0) break;
        evenStreak++;
      } else {
        if (evenStreak > 0) break;
        oddStreak++;
      }
    }

    let hottest = 0;
    let coldest = 0;
    if (total > 0) {
      for (let d = 1; d <= 9; d++) {
        if (counts[d] >= counts[hottest]) hottest = d;
        if (counts[d] < counts[coldest]) coldest = d;
      }
    }

    return {
      symbol: state.symbol,
      window_size: win,
      total_ticks: total,
      counts,
      percentages,
      even_pct: total > 0 ? Number(((evenCount / total) * 100).toFixed(2)) : 0,
      odd_pct: total > 0 ? Number(((oddCount / total) * 100).toFixed(2)) : 0,
      over_pct: total > 0 ? Number(((overCount / total) * 100).toFixed(2)) : 0,
      under_pct: total > 0 ? Number(((underCount / total) * 100).toFixed(2)) : 0,
      barrier: bar,
      current_even_streak: evenStreak,
      current_odd_streak: oddStreak,
      hottest_digit: hottest,
      coldest_digit: coldest,
      recent_digits: slice.slice(-30).map((t) => t.last_digit),
    };
  }

  function estimateClientPayoutRatio(contractType, barrier) {
    if (PAYOUT_MULTIPLIERS[contractType] !== undefined) {
      return PAYOUT_MULTIPLIERS[contractType];
    }
    const b = barrier ?? 4;
    if (contractType === "DIGITOVER") {
      const winDigits = Math.max(1, 9 - b);
      return Number((0.96 / (winDigits / 10) - 1).toFixed(2));
    }
    if (contractType === "DIGITUNDER") {
      const winDigits = Math.max(1, b);
      return Number((0.96 / (winDigits / 10) - 1).toFixed(2));
    }
    return 0.95;
  }

  function evaluateClientContract(contractType, entryQuote, exitQuote, exitDigit, barrier) {
    const b = barrier ?? 4;
    if (contractType === "DIGITEVEN") return exitDigit % 2 === 0;
    if (contractType === "DIGITODD") return exitDigit % 2 === 1;
    if (contractType === "DIGITOVER") return exitDigit > b;
    if (contractType === "DIGITUNDER") return exitDigit < b;
    if (contractType === "DIGITMATCH") return exitDigit === b;
    if (contractType === "DIGITDIFF") return exitDigit !== b;
    if (contractType === "CALL") return exitQuote > entryQuote;
    if (contractType === "PUT") return exitQuote < entryQuote;
    return false;
  }

  function openClientTrade(contractType, barrier, durationTicks, reason) {
    const lastTick = state.ticks[state.ticks.length - 1];
    if (!lastTick) return;

    const stake = Number(state.risk.current_stake.toFixed(2));
    const trade = {
      id: `TRD-${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
      timestamp: Math.floor(Date.now() / 1000),
      symbol: state.symbol,
      strategy: state.strategyConfig.strategy_type,
      contract_type: contractType,
      barrier: ["DIGITOVER", "DIGITUNDER", "DIGITMATCH", "DIGITDIFF"].includes(contractType)
        ? barrier
        : null,
      duration_ticks: durationTicks,
      stake,
      entry_quote: lastTick.quote,
      entry_digit: lastTick.last_digit,
      exit_quote: null,
      exit_digit: null,
      status: "OPEN",
      payout: 0,
      profit: 0,
      is_paper: true,
      reason,
    };

    state.trades.unshift(trade);
    state.pendingPaperTrades.push({ trade, remaining: durationTicks });
    renderTradesTable();
  }

  function evaluateClientStrategy(tick, stats) {
    if (!state.strategyConfig.enabled) return;
    if (state.pendingPaperTrades.length > 0) return;
    if (stats.total_ticks < 15) return;

    // Check risk guards first
    if (state.risk.total_profit >= state.risk.take_profit) {
      state.risk.halt_reason = `Take Profit reached (+$${state.risk.total_profit.toFixed(2)})`;
      state.strategyConfig.enabled = false;
      updateRiskAndBotUI(state.risk, state.strategyConfig);
      return;
    }
    if (state.risk.total_profit <= -Math.abs(state.risk.stop_loss)) {
      state.risk.halt_reason = `Stop Loss reached (-$${Math.abs(state.risk.total_profit).toFixed(2)})`;
      state.strategyConfig.enabled = false;
      updateRiskAndBotUI(state.risk, state.strategyConfig);
      return;
    }
    if (state.risk.consecutive_losses >= state.risk.max_consecutive_losses) {
      state.risk.halt_reason = `Max consecutive losses reached (${state.risk.consecutive_losses})`;
      state.strategyConfig.enabled = false;
      updateRiskAndBotUI(state.risk, state.strategyConfig);
      return;
    }

    const st = state.strategyConfig.strategy_type;
    const threshold = state.strategyConfig.streak_threshold;
    const dur = state.strategyConfig.duration_ticks;
    const bar = state.strategyConfig.barrier;

    if (st === "EVEN_ODD_STREAK") {
      if (stats.current_odd_streak >= threshold) {
        openClientTrade(
          "DIGITEVEN",
          null,
          dur,
          `Odd streak reached ${stats.current_odd_streak} ticks -> Reversal DIGITEVEN`
        );
      } else if (stats.current_even_streak >= threshold) {
        openClientTrade(
          "DIGITODD",
          null,
          dur,
          `Even streak reached ${stats.current_even_streak} ticks -> Reversal DIGITODD`
        );
      }
    } else if (st === "OVER_UNDER_EDGE") {
      const tail = stats.recent_digits.slice(-threshold);
      if (tail.length >= threshold) {
        if (tail.every((d) => d <= bar) && stats.over_pct >= 40) {
          openClientTrade(
            "DIGITOVER",
            bar,
            dur,
            `${threshold} ticks <= ${bar} (Over ${stats.over_pct}%) -> DIGITOVER ${bar}`
          );
        } else if (tail.every((d) => d >= bar) && stats.under_pct >= 40) {
          openClientTrade(
            "DIGITUNDER",
            bar,
            dur,
            `${threshold} ticks >= ${bar} (Under ${stats.under_pct}%) -> DIGITUNDER ${bar}`
          );
        }
      }
    } else if (st === "MATCH_DIFF_COLD") {
      const coldest = stats.coldest_digit;
      const coldPct = stats.percentages[coldest] ?? 10;
      if (tick.last_digit === coldest && coldPct <= 8.0) {
        openClientTrade(
          "DIGITDIFF",
          coldest,
          dur,
          `Coldest digit ${coldest} (${coldPct}%) appeared -> DIGITDIFF ${coldest}`
        );
      }
    } else if (st === "RISE_FALL_MOMENTUM") {
      if (state.ticks.length >= threshold + 1) {
        const win = state.ticks.slice(-(threshold + 1));
        const diffs = [];
        for (let i = 0; i < win.length - 1; i++) {
          diffs.push(win[i + 1].quote - win[i].quote);
        }
        if (diffs.every((d) => d > 0)) {
          openClientTrade("CALL", null, dur, `Bullish momentum (${threshold} rising ticks) -> CALL`);
        } else if (diffs.every((d) => d < 0)) {
          openClientTrade("PUT", null, dur, `Bearish momentum (${threshold} falling ticks) -> PUT`);
        }
      }
    }
  }

  function processClientTick(quote, epoch, pipSize, isHistorical = false) {
    const { formatted, lastDigit } = extractLastDigitClient(quote, pipSize);
    const tick = {
      symbol: state.symbol,
      epoch,
      quote: Number(quote),
      formatted_quote: formatted,
      pip_size: pipSize,
      last_digit: lastDigit,
    };

    state.ticks.push(tick);
    if (state.ticks.length > 500) state.ticks.shift();

    // Update 1m candle
    const bucket = Math.floor(epoch / state.timeframeSec) * state.timeframeSec;
    const lastCandle = state.candles[state.candles.length - 1];
    if (!lastCandle || lastCandle.open_time !== bucket) {
      state.candles.push({
        symbol: state.symbol,
        timeframe_sec: state.timeframeSec,
        open_time: bucket,
        open: tick.quote,
        high: tick.quote,
        low: tick.quote,
        close: tick.quote,
        tick_count: 1,
      });
      if (state.candles.length > 120) state.candles.shift();
    } else {
      lastCandle.high = Math.max(lastCandle.high, tick.quote);
      lastCandle.low = Math.min(lastCandle.low, tick.quote);
      lastCandle.close = tick.quote;
      lastCandle.tick_count++;
    }

    if (isHistorical) return;

    // Settle pending paper trades
    if (state.pendingPaperTrades.length > 0) {
      const nextPending = [];
      state.pendingPaperTrades.forEach((item) => {
        item.remaining--;
        if (item.remaining <= 0) {
          const t = item.trade;
          const won = evaluateClientContract(
            t.contract_type,
            t.entry_quote,
            tick.quote,
            tick.last_digit,
            t.barrier
          );
          t.exit_quote = tick.quote;
          t.exit_digit = tick.last_digit;
          if (won) {
            const ratio = estimateClientPayoutRatio(t.contract_type, t.barrier);
            t.profit = Number((t.stake * ratio).toFixed(2));
            t.payout = Number((t.stake + t.profit).toFixed(2));
            t.status = "WON";
            state.risk.wins++;
            state.risk.consecutive_losses = 0;
            state.risk.current_stake = state.risk.base_stake;
          } else {
            t.profit = Number((-t.stake).toFixed(2));
            t.payout = 0;
            t.status = "LOST";
            state.risk.losses++;
            state.risk.consecutive_losses++;
            if (state.risk.use_martingale) {
              state.risk.current_stake = Number(
                (state.risk.current_stake * state.risk.martingale_multiplier).toFixed(2)
              );
            } else {
              state.risk.current_stake = state.risk.base_stake;
            }
          }
          state.risk.total_trades++;
          state.risk.total_profit = Number((state.risk.total_profit + t.profit).toFixed(2));
          state.risk.win_rate = Number(
            ((state.risk.wins / state.risk.total_trades) * 100).toFixed(1)
          );
          if (state.account.loginid === "PAPER-SIM") {
            state.account.balance = Number((10000 + state.risk.total_profit).toFixed(2));
          }
          renderTradesTable();
        } else {
          nextPending.push(item);
        }
      });
      state.pendingPaperTrades = nextPending;
    }

    const stats = computeClientDigitStats();
    evaluateClientStrategy(tick, stats);

    updateTickBanner(tick);
    updateDigitHeatmap(stats, tick.last_digit);
    updateRiskAndBotUI(state.risk, state.strategyConfig);
    updateConnectionHeader(state.connectedToDeriv, state.authorized, state.account, state.symbol);
    drawChart();
  }

  function startDirectDerivConnection() {
    state.mode = "direct_deriv";
    if (directDerivWS) {
      try {
        directDerivWS.onclose = null;
        directDerivWS.close();
      } catch (_) {}
    }

    state.ticks = [];
    state.candles = [];
    const wsUrl = `wss://ws.derivws.com/websockets/v3?app_id=${state.appId || "1089"}`;
    directDerivWS = new WebSocket(wsUrl);

    directDerivWS.onopen = () => {
      state.connectedToDeriv = true;
      updateConnectionHeader(true, state.authorized, state.account, state.symbol);

      if (state.apiToken && state.apiToken.trim()) {
        directDerivWS.send(JSON.stringify({ authorize: state.apiToken.trim() }));
      }

      directDerivWS.send(
        JSON.stringify({
          ticks_history: state.symbol,
          adjust_start_time: 1,
          count: 100,
          end: "latest",
          style: "ticks",
          subscribe: 1,
        })
      );
    };

    directDerivWS.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      const pipSize = PIP_SIZES[state.symbol] || 2;

      if (msg.msg_type === "authorize" && msg.authorize) {
        state.authorized = true;
        state.account = {
          loginid: msg.authorize.loginid || "DERIV",
          currency: msg.authorize.currency || "USD",
          balance: Number(msg.authorize.balance || 0),
          is_virtual: Boolean(msg.authorize.is_virtual),
        };
        updateConnectionHeader(true, true, state.account, state.symbol);
      } else if (msg.msg_type === "history" && msg.history) {
        const prices = msg.history.prices || [];
        const times = msg.history.times || [];
        const pSize = msg.pip_size !== undefined ? Number(msg.pip_size) : pipSize;
        for (let i = 0; i < prices.length; i++) {
          processClientTick(Number(prices[i]), Number(times[i]), pSize, i < prices.length - 1);
        }
      } else if (msg.msg_type === "tick" && msg.tick) {
        const pSize = msg.tick.pip_size !== undefined ? Number(msg.tick.pip_size) : pipSize;
        processClientTick(Number(msg.tick.quote), Number(msg.tick.epoch), pSize, false);
      }
    };

    directDerivWS.onclose = () => {
      state.connectedToDeriv = false;
      updateConnectionHeader(false, false, state.account, state.symbol);
      setTimeout(startDirectDerivConnection, 3000);
    };
  }

  // Try connecting to local FastAPI backend first; if hosted on GitHub Pages, switch to direct Deriv WS
  function connectSystem() {
    const isGitHubPages = window.location.hostname.endsWith("github.io");
    if (isGitHubPages) {
      startDirectDerivConnection();
      return;
    }

    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
    let opened = false;

    ws.onopen = () => {
      opened = true;
      state.mode = "backend";
    };

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

    ws.onerror = () => {
      if (!opened && state.mode !== "direct_deriv") {
        startDirectDerivConnection();
      }
    };

    ws.onclose = () => {
      if (state.mode === "backend") {
        setTimeout(connectSystem, 2000);
      }
    };
  }

  // Event Listeners
  symbolSelect.addEventListener("change", async () => {
    const symbol = symbolSelect.value;
    state.symbol = symbol;
    state.windowSize = Number(document.getElementById("windowSizeInput").value || 100);
    state.barrier = Number(barrierInput.value || 4);

    if (state.mode === "direct_deriv") {
      startDirectDerivConnection();
      return;
    }

    await fetch("/api/connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: document.getElementById("appIdInput").value || "1089",
        api_token: document.getElementById("apiTokenInput").value || "",
        symbol,
        window_size: state.windowSize,
        barrier: state.barrier,
        timeframe_sec: 60,
      }),
    });
  });

  toggleBotBtn.addEventListener("click", async () => {
    const nextEnabled = !state.botEnabled;
    state.barrier = Number(barrierInput.value || 4);
    state.windowSize = Number(document.getElementById("windowSizeInput").value || 100);

    if (state.mode === "direct_deriv") {
      state.strategyConfig = {
        enabled: nextEnabled,
        strategy_type: strategySelect.value,
        symbol: symbolSelect.value,
        contract_type: "DIGITEVEN",
        duration_ticks: Number(durationTicksInput.value || 1),
        barrier: state.barrier,
        streak_threshold: Number(streakThresholdInput.value || 4),
        window_size: state.windowSize,
        paper_trading: paperTradingToggle.checked,
      };
      if (nextEnabled) state.risk.halt_reason = null;
      updateRiskAndBotUI(state.risk, state.strategyConfig);
      updateDigitHeatmap(computeClientDigitStats(), -1);
      return;
    }

    await fetch("/api/strategy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: nextEnabled,
        strategy_type: strategySelect.value,
        symbol: symbolSelect.value,
        contract_type: "DIGITEVEN",
        duration_ticks: Number(durationTicksInput.value || 1),
        barrier: state.barrier,
        streak_threshold: Number(streakThresholdInput.value || 4),
        window_size: state.windowSize,
        paper_trading: paperTradingToggle.checked,
      }),
    });
  });

  document.querySelectorAll(".manual-trade-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const contractType = btn.getAttribute("data-contract");
      const dur = Number(durationTicksInput.value || 1);
      const bar = Number(barrierInput.value || 4);

      if (state.mode === "direct_deriv") {
        openClientTrade(contractType, bar, dur, "Manual 1-Click Execution");
        return;
      }

      await fetch("/api/trade/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract_type: contractType,
          duration_ticks: dur,
          barrier: bar,
        }),
      });
    });
  });

  saveRiskBtn.addEventListener("click", async () => {
    if (state.mode === "direct_deriv") {
      state.risk.base_stake = Number(baseStakeInput.value || 1.0);
      state.risk.take_profit = Number(takeProfitInput.value || 20.0);
      state.risk.stop_loss = Number(stopLossInput.value || 15.0);
      state.risk.max_consecutive_losses = Number(maxLossStreakInput.value || 5);
      state.risk.use_martingale = useMartingaleToggle.checked;
      state.risk.martingale_multiplier = Number(martingaleMultInput.value || 2.0);
      if (state.risk.consecutive_losses === 0) {
        state.risk.current_stake = state.risk.base_stake;
      }
      state.risk.halt_reason = null;
      updateRiskAndBotUI(state.risk, state.strategyConfig);
      return;
    }

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
    if (state.mode === "direct_deriv") {
      state.risk.current_stake = state.risk.base_stake;
      state.risk.consecutive_losses = 0;
      state.risk.total_profit = 0;
      state.risk.total_trades = 0;
      state.risk.wins = 0;
      state.risk.losses = 0;
      state.risk.win_rate = 0;
      state.risk.halt_reason = null;
      state.trades = [];
      if (state.account.loginid === "PAPER-SIM") {
        state.account.balance = 10000;
      }
      updateRiskAndBotUI(state.risk, state.strategyConfig);
      updateConnectionHeader(state.connectedToDeriv, state.authorized, state.account, state.symbol);
      renderTradesTable();
      return;
    }

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
    state.appId = document.getElementById("appIdInput").value || "1089";
    state.apiToken = document.getElementById("apiTokenInput").value || "";
    state.windowSize = Number(document.getElementById("windowSizeInput").value || 100);
    state.barrier = Number(barrierInput.value || 4);

    if (state.mode === "direct_deriv") {
      startDirectDerivConnection();
      closeModal();
      return;
    }

    await fetch("/api/connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: state.appId,
        api_token: state.apiToken,
        symbol: symbolSelect.value,
        window_size: state.windowSize,
        barrier: state.barrier,
        timeframe_sec: 60,
      }),
    });
    closeModal();
  });

  window.addEventListener("resize", drawChart);

  initDigitGrid();
  connectSystem();
})();
