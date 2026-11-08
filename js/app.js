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

  const STORAGE_KEYS = {
    ACCOUNTS: "deriv_prodesk_accounts_v1",
    ACTIVE_TOKEN: "deriv_prodesk_active_token_v1",
    APP_ID: "deriv_prodesk_app_id_v1",
  };

  const state = {
    mode: "direct_deriv",
    symbol: "R_100",
    appId: localStorage.getItem(STORAGE_KEYS.APP_ID) || "1089",
    apiToken: localStorage.getItem(STORAGE_KEYS.ACTIVE_TOKEN) || "",
    savedAccounts: [], // [{ acct, token, cur }]
    windowSize: 100,
    barrier: 4,
    timeframeSec: 60,
    connectedToDeriv: false,
    authorized: false,
    botEnabled: false,
    chartMode: "ticks",
    ticks: [],
    candles: [],
    digitStats: null,
    mlTelemetry: {
      confidence: 0,
      regime: "CALIBRATING",
      predictedDigit: 0,
      predictedProb: 10.0,
      safestDiffDigit: 0,
      safestDiffProb: 10.0,
      chiSquare: 0.0,
      entropy: 3.32,
      optimalContract: "DIGITDIFF",
      optimalBarrier: 0,
      optimalReason: "Warming up tick buffer...",
      transitionMatrix: Array.from({ length: 10 }, () => Array(10).fill(0)),
    },
    trades: [],
    pendingPaperTrades: [],
    liveOpenContracts: {}, // proposal_open_contract tracking
    cooldownTicks: 0,
    account: {
      loginid: "PAPER-SIM",
      currency: "USD",
      balance: 10000.0,
      is_virtual: true,
    },
    strategyConfig: {
      enabled: false,
      strategy_type: "ML_ADAPTIVE_EDGE",
      symbol: "R_100",
      contract_type: "DIGITEVEN",
      duration_ticks: 1,
      barrier: 4,
      streak_threshold: 4,
      ml_threshold: 68,
      window_size: 100,
      paper_trading: false,
    },
    risk: {
      base_stake: 0.35,
      take_profit: 3.0,
      stop_loss: 2.5,
      max_consecutive_losses: 4,
      use_martingale: true,
      martingale_multiplier: 1.65,
      use_profit_lock: true,
      peak_profit: 0.0,
      profit_floor: 0.0,
      current_stake: 0.35,
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
  let pingTimer = null;

  // DOM Elements
  const wsDot = document.getElementById("wsDot");
  const connBadge = document.getElementById("connBadge");
  const symbolSelect = document.getElementById("symbolSelect");
  const accountTypeTag = document.getElementById("accountTypeTag");
  const accountSwitcherSelect = document.getElementById("accountSwitcherSelect");
  const accountLoginId = document.getElementById("accountLoginId");
  const accountBalance = document.getElementById("accountBalance");
  const derivOAuthBtn = document.getElementById("derivOAuthBtn");
  const logoutDerivBtn = document.getElementById("logoutDerivBtn");

  const liveQuote = document.getElementById("liveQuote");
  const liveEpoch = document.getElementById("liveEpoch");
  const liveLastDigit = document.getElementById("liveLastDigit");
  const liveParityBadge = document.getElementById("liveParityBadge");
  const streakSummary = document.getElementById("streakSummary");

  // ML DOM
  const mlRegimeBadge = document.getElementById("mlRegimeBadge");
  const mlConfidenceValue = document.getElementById("mlConfidenceValue");
  const mlEdgeState = document.getElementById("mlEdgeState");
  const mlConfidenceBar = document.getElementById("mlConfidenceBar");
  const mlPredictedDigit = document.getElementById("mlPredictedDigit");
  const mlTransitionProb = document.getElementById("mlTransitionProb");
  const mlLeastLikelyDigit = document.getElementById("mlLeastLikelyDigit");
  const mlOptimalContract = document.getElementById("mlOptimalContract");
  const mlOptimalReason = document.getElementById("mlOptimalReason");
  const chiSquareLabel = document.getElementById("chiSquareLabel");

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
  const profitLockValue = document.getElementById("profitLockValue");
  const haltAlertBox = document.getElementById("haltAlertBox");
  const paperTradingToggle = document.getElementById("paperTradingToggle");
  const strategySelect = document.getElementById("strategySelect");
  const mlThresholdInput = document.getElementById("mlThresholdInput");
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
  const useProfitLockToggle = document.getElementById("useProfitLockToggle");
  const saveRiskBtn = document.getElementById("saveRiskBtn");
  const resetSessionBtn = document.getElementById("resetSessionBtn");

  const canvas = document.getElementById("marketCanvas");
  const ctx = canvas.getContext("2d");
  const chartModeTicksBtn = document.getElementById("chartModeTicks");
  const chartModeCandlesBtn = document.getElementById("chartModeCandles");

  // ============================================================================
  // 1. DERIV OAUTH CALLBACK PARSER & MULTI-USER BROWSER SESSION MANAGER
  // ============================================================================

  function parseDerivOAuthRedirect() {
    const params = new URLSearchParams(window.location.search);
    const accounts = [];
    for (let i = 1; i <= 10; i++) {
      const acct = params.get(`acct${i}`);
      const token = params.get(`token${i}`);
      const cur = params.get(`cur${i}`) || "USD";
      if (acct && token) {
        accounts.push({ acct, token, cur });
      }
    }

    if (accounts.length > 0) {
      localStorage.setItem(STORAGE_KEYS.ACCOUNTS, JSON.stringify(accounts));
      localStorage.setItem(STORAGE_KEYS.ACTIVE_TOKEN, accounts[0].token);
      state.savedAccounts = accounts;
      state.apiToken = accounts[0].token;
      // Clean OAuth tokens from address bar URL for security
      const cleanUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
    } else {
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.ACCOUNTS);
        if (raw) state.savedAccounts = JSON.parse(raw);
      } catch (_) {
        state.savedAccounts = [];
      }
    }

    renderAccountSwitcher();
  }

  function renderAccountSwitcher() {
    accountSwitcherSelect.innerHTML = "";

    // Add all authenticated user Deriv accounts (Real CR & Demo VRTC)
    state.savedAccounts.forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item.token;
      const isDemo = item.acct.startsWith("VRTC") || item.acct.startsWith("VRT");
      opt.textContent = `${item.acct} (${isDemo ? "DEMO" : "REAL"} ${item.cur})`;
      if (item.token === state.apiToken) opt.selected = true;
      accountSwitcherSelect.appendChild(opt);
    });

    // If user pasted a single API token not in OAuth list
    if (
      state.apiToken &&
      !state.savedAccounts.some((a) => a.token === state.apiToken)
    ) {
      const opt = document.createElement("option");
      opt.value = state.apiToken;
      opt.textContent =
        state.account.loginid !== "PAPER-SIM"
          ? `${state.account.loginid} (${state.account.currency})`
          : "API TOKEN ACCOUNT";
      opt.selected = true;
      accountSwitcherSelect.appendChild(opt);
    }

    // Always provide Paper Sim option
    const simOpt = document.createElement("option");
    simOpt.value = "PAPER-SIM";
    simOpt.textContent = "PAPER-SIM (PRACTICE)";
    if (!state.apiToken) simOpt.selected = true;
    accountSwitcherSelect.appendChild(simOpt);

    if (state.apiToken) {
      logoutDerivBtn.classList.remove("hidden");
      derivOAuthBtn.textContent = "Switch Deriv Login";
    } else {
      logoutDerivBtn.classList.add("hidden");
      derivOAuthBtn.textContent = "Log in with Deriv";
    }
  }

  function triggerDerivOAuthLogin() {
    const appId = (document.getElementById("appIdInput").value || state.appId || "1089").trim();
    localStorage.setItem(STORAGE_KEYS.APP_ID, appId);
    const redirectUri = encodeURIComponent(window.location.origin + window.location.pathname);
    const oauthUrl = `https://oauth.deriv.com/oauth2/authorize?app_id=${encodeURIComponent(
      appId
    )}&l=EN&brand=deriv&redirect_uri=${redirectUri}`;
    window.location.href = oauthUrl;
  }

  // ============================================================================
  // 2. ONLINE MACHINE LEARNING & MARKOV-ENTROPY QUANT ENGINE
  // ============================================================================

  function updateOnlineMLModel(stats) {
    const ticks = state.ticks;
    const n = ticks.length;
    if (n < 15 || !stats) return;

    // 1. Build 1st-Order Markov Transition Matrix (10x10) over rolling window
    const winTicks = ticks.slice(-state.windowSize);
    const matrix = Array.from({ length: 10 }, () => Array(10).fill(0));
    const rowSums = Array(10).fill(0);

    for (let i = 0; i < winTicks.length - 1; i++) {
      const fromD = winTicks[i].last_digit;
      const toD = winTicks[i + 1].last_digit;
      matrix[fromD][toD]++;
      rowSums[fromD]++;
    }

    const currentDigit = winTicks[winTicks.length - 1].last_digit;
    const transitionsFromCurrent = matrix[currentDigit];
    const totalFromCurrent = rowSums[currentDigit];

    // Laplace-smoothed transition probabilities P(next = d | currentDigit)
    const condProbs = {};
    for (let d = 0; d <= 9; d++) {
      const p =
        totalFromCurrent > 0
          ? (transitionsFromCurrent[d] + 0.5) / (totalFromCurrent + 5.0)
          : 0.1;
      condProbs[d] = Number((p * 100).toFixed(1));
    }

    // Most likely & least likely next digit from Markov transition + global frequency blend
    let bestDigit = 0;
    let lowestDigit = 0;
    let bestScore = -1;
    let lowestScore = 999;

    for (let d = 0; d <= 9; d++) {
      // Blend 60% Markov transition probability + 40% rolling window frequency
      const blended = 0.6 * condProbs[d] + 0.4 * (stats.percentages[d] || 10.0);
      if (blended > bestScore) {
        bestScore = blended;
        bestDigit = d;
      }
      if (blended < lowestScore) {
        lowestScore = blended;
        lowestDigit = d;
      }
    }

    // 2. Compute Chi-Square goodness-of-fit against uniform distribution (E_i = total / 10)
    const total = stats.total_ticks || 1;
    const expected = total / 10.0;
    let chiSq = 0;
    let entropy = 0;

    for (let d = 0; d <= 9; d++) {
      const obs = stats.counts[d] || 0;
      chiSq += Math.pow(obs - expected, 2) / Math.max(1, expected);
      const p = obs / total;
      if (p > 0) {
        entropy -= p * Math.log2(p);
      }
    }

    // 3. Evaluate Regime & Feature Ensemble Confidence (0 - 96%)
    // Features: Chi-Sq skew, Markov concentration, Parity streak compression, Over/Under skew
    const maxStreak = Math.max(stats.current_even_streak, stats.current_odd_streak);
    const paritySkew = Math.abs(stats.even_pct - 50.0);
    const markovSpread = Math.max(0, bestScore - lowestScore);

    let rawConf =
      38 +
      Math.min(22, chiSq * 1.15) +
      Math.min(18, markovSpread * 0.9) +
      Math.min(14, maxStreak * 2.8) +
      Math.min(8, paritySkew * 0.6);

    const confidence = Math.min(96.0, Math.max(25.0, Number(rawConf.toFixed(1))));

    // Determine best high-expectancy contract recommendation
    const recent4 = stats.recent_digits.slice(-4);
    const lowDigitsCount = recent4.filter((d) => d <= 1).length;
    const highDigitsCount = recent4.filter((d) => d >= 8).length;

    let optimalContract = "DIGITDIFF";
    let optimalBarrier = lowestDigit;
    let optimalReason = `Markov min-prob digit ${lowestDigit} (${lowestScore.toFixed(1)}% blend)`;

    if (maxStreak >= state.strategyConfig.streak_threshold) {
      if (stats.current_odd_streak >= state.strategyConfig.streak_threshold) {
        optimalContract = "DIGITEVEN";
        optimalBarrier = null;
        optimalReason = `Odd run=${stats.current_odd_streak} + Even=${stats.even_pct}% reversion`;
      } else {
        optimalContract = "DIGITODD";
        optimalBarrier = null;
        optimalReason = `Even run=${stats.current_even_streak} + Odd=${stats.odd_pct}% reversion`;
      }
    } else if (lowDigitsCount >= 2 && stats.percentages[0] + stats.percentages[1] <= 21) {
      optimalContract = "DIGITOVER";
      optimalBarrier = 1;
      optimalReason = `Low-digit compression (0–1) -> High-prob OVER 1`;
    } else if (highDigitsCount >= 2 && stats.percentages[8] + stats.percentages[9] <= 21) {
      optimalContract = "DIGITUNDER";
      optimalBarrier = 8;
      optimalReason = `High-digit compression (8–9) -> High-prob UNDER 8`;
    }

    let regime = "MODERATE EDGE";
    if (confidence >= 72) regime = "HIGH STATISTICAL EDGE";
    else if (confidence < 56) regime = "RANDOM CHOP // HOLD";

    state.mlTelemetry = {
      confidence,
      regime,
      predictedDigit: bestDigit,
      predictedProb: Number(bestScore.toFixed(1)),
      safestDiffDigit: lowestDigit,
      safestDiffProb: Number(lowestScore.toFixed(1)),
      chiSquare: Number(chiSq.toFixed(2)),
      entropy: Number(entropy.toFixed(2)),
      optimalContract,
      optimalBarrier,
      optimalReason,
      transitionMatrix: matrix,
    };

    renderMLTelemetry();
  }

  function renderMLTelemetry() {
    const ml = state.mlTelemetry;
    mlConfidenceValue.textContent = `${ml.confidence.toFixed(1)}%`;
    mlConfidenceBar.style.width = `${ml.confidence}%`;
    chiSquareLabel.textContent = ml.chiSquare.toFixed(2);

    if (ml.confidence >= 70) {
      mlConfidenceValue.className = "text-lg font-bold text-[#00c853] tabular-nums";
      mlConfidenceBar.className = "h-full bg-[#00c853] transition-all duration-150";
      mlEdgeState.textContent = "STRONG";
      mlEdgeState.className = "text-[10px] text-[#00c853] font-bold";
      mlRegimeBadge.textContent = ml.regime;
      mlRegimeBadge.className =
        "font-mono text-[10px] px-1.5 py-0.5 bg-[#00c853]/15 border border-[#00c853]/40 text-[#00c853]";
    } else if (ml.confidence >= 58) {
      mlConfidenceValue.className = "text-lg font-bold text-[#ffab00] tabular-nums";
      mlConfidenceBar.className = "h-full bg-[#ffab00] transition-all duration-150";
      mlEdgeState.textContent = "NEUTRAL";
      mlEdgeState.className = "text-[10px] text-[#ffab00]";
      mlRegimeBadge.textContent = ml.regime;
      mlRegimeBadge.className =
        "font-mono text-[10px] px-1.5 py-0.5 bg-[#ffab00]/15 border border-[#ffab00]/40 text-[#ffab00]";
    } else {
      mlConfidenceValue.className = "text-lg font-bold text-[#8b949e] tabular-nums";
      mlConfidenceBar.className = "h-full bg-[#586069] transition-all duration-150";
      mlEdgeState.textContent = "FILTERED";
      mlEdgeState.className = "text-[10px] text-[#8b949e]";
      mlRegimeBadge.textContent = ml.regime;
      mlRegimeBadge.className =
        "font-mono text-[10px] px-1.5 py-0.5 bg-[#151a24] border border-[#1e2533] text-[#8b949e]";
    }

    mlPredictedDigit.textContent = `${ml.predictedDigit}`;
    mlTransitionProb.textContent = `Score: ${ml.predictedProb}%`;
    mlLeastLikelyDigit.textContent = `Safest Diff: Digit ${ml.safestDiffDigit} (${ml.safestDiffProb}%)`;

    const barTag =
      ml.optimalBarrier !== null && ml.optimalBarrier !== undefined
        ? ` [${ml.optimalBarrier}]`
        : "";
    mlOptimalContract.textContent = `${ml.optimalContract}${barTag}`;
    mlOptimalReason.textContent = ml.optimalReason;
  }

  // ============================================================================
  // 3. UI RENDERING (DIGIT MATRIX, BANNER, CHART, TRADE BLOTTER)
  // ============================================================================

  function initDigitGrid() {
    digitGrid.innerHTML = "";
    for (let d = 0; d <= 9; d++) {
      const cell = document.createElement("div");
      cell.id = `digit-cell-${d}`;
      cell.className = "digit-node flex flex-col items-center justify-between font-mono";
      cell.innerHTML = `
        <div class="w-full flex items-center justify-between px-1 text-[9px] text-[#8b949e]">
          <span>D${d}</span>
          <span id="digit-count-${d}">0</span>
        </div>
        <span class="text-base font-bold text-white my-0.5 tabular-nums">${d}</span>
        <span id="digit-pct-${d}" class="text-[11px] font-semibold text-[#8b949e] tabular-nums">10.0%</span>
        <div class="w-full h-1 bg-[#151a24] mt-1.5 overflow-hidden">
          <div id="digit-bar-${d}" class="h-full bg-[#586069]" style="width: 10%"></div>
        </div>
      `;
      digitGrid.appendChild(cell);
    }
  }

  function updateDigitHeatmap(stats, activeDigit) {
    if (!stats) return;
    state.digitStats = stats;

    windowCountBadge.textContent = `(${stats.total_ticks}/${stats.window_size} TICKS)`;
    hottestDigitLabel.textContent = `D${stats.hottest_digit} (${stats.percentages[stats.hottest_digit] || 0}%)`;
    coldestDigitLabel.textContent = `D${stats.coldest_digit} (${stats.percentages[stats.coldest_digit] || 0}%)`;

    evenPctLabel.textContent = `E: ${stats.even_pct}%`;
    oddPctLabel.textContent = `O: ${stats.odd_pct}%`;
    evenBar.style.width = `${stats.even_pct}%`;
    oddBar.style.width = `${stats.odd_pct}%`;

    barrierLabelMetric.textContent = stats.barrier;
    overPctLabel.textContent = `> ${stats.over_pct}%`;
    underPctLabel.textContent = `< ${stats.under_pct}%`;
    overBar.style.width = `${stats.over_pct}%`;
    underBar.style.width = `${stats.under_pct}%`;

    if (stats.current_even_streak > 0) {
      streakSummary.textContent = `${stats.current_even_streak}x EVEN`;
    } else if (stats.current_odd_streak > 0) {
      streakSummary.textContent = `${stats.current_odd_streak}x ODD`;
    } else {
      streakSummary.textContent = "--";
    }

    for (let d = 0; d <= 9; d++) {
      const cell = document.getElementById(`digit-cell-${d}`);
      const pctEl = document.getElementById(`digit-pct-${d}`);
      const cntEl = document.getElementById(`digit-count-${d}`);
      const barEl = document.getElementById(`digit-bar-${d}`);
      const pct = stats.percentages[d] ?? 0;
      const cnt = stats.counts[d] ?? 0;

      pctEl.textContent = `${pct.toFixed(1)}%`;
      cntEl.textContent = `${cnt}`;
      barEl.style.width = `${Math.min(100, pct * 4.2)}%`;

      cell.classList.toggle("active-tick", d === activeDigit);

      if (d === stats.hottest_digit) {
        barEl.className = "h-full bg-[#00c853]";
        pctEl.className = "text-[11px] font-bold text-[#00c853] tabular-nums";
      } else if (d === stats.coldest_digit) {
        barEl.className = "h-full bg-[#2979ff]";
        pctEl.className = "text-[11px] font-bold text-[#2979ff] tabular-nums";
      } else {
        barEl.className = "h-full bg-[#586069]";
        pctEl.className = "text-[11px] font-semibold text-[#8b949e] tabular-nums";
      }
    }

    recentDigitsTape.innerHTML = "";
    (stats.recent_digits || []).slice(-25).forEach((d, idx, arr) => {
      const badge = document.createElement("span");
      const isEven = d % 2 === 0;
      const isLatest = idx === arr.length - 1;
      badge.className = `w-5 h-5 flex items-center justify-center text-[11px] font-mono font-bold shrink-0 border ${
        isLatest
          ? "border-[#00c853] bg-[#00c853]/20 text-white"
          : isEven
          ? "border-[#2979ff]/30 bg-[#2979ff]/10 text-[#2979ff]"
          : "border-[#ffab00]/30 bg-[#ffab00]/10 text-[#ffab00]"
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
      ? "text-[10px] px-1 bg-[#2979ff]/20 text-[#2979ff] font-bold"
      : "text-[10px] px-1 bg-[#ffab00]/20 text-[#ffab00] font-bold";
  }

  function updateConnectionHeader(connected, authorized, account, symbol) {
    state.connectedToDeriv = connected;
    state.authorized = authorized;
    if (symbol && symbolSelect.value !== symbol) {
      symbolSelect.value = symbol;
    }

    if (connected) {
      wsDot.className = "inline-block w-2 h-2 bg-[#00c853]";
      connBadge.textContent = authorized ? "DERIV AUTHENTICATED" : "DERIV LIVE FEED";
      connBadge.className =
        "font-mono text-[10px] px-1.5 py-0.5 bg-[#00c853]/15 border border-[#00c853]/40 text-[#00c853]";
    } else {
      wsDot.className = "inline-block w-2 h-2 bg-[#ffab00]";
      connBadge.textContent = "RECONNECTING...";
      connBadge.className =
        "font-mono text-[10px] px-1.5 py-0.5 bg-[#ffab00]/15 border border-[#ffab00]/40 text-[#ffab00]";
    }

    if (account) {
      const loginid = account.loginid || "PAPER-SIM";
      accountLoginId.textContent = loginid;
      const bal = Number(account.balance || 0);
      const cur = account.currency || "USD";
      accountBalance.textContent = `${cur === "USD" ? "$" : cur + " "}${bal.toLocaleString(
        "en-US",
        {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }
      )}`;

      if (loginid === "PAPER-SIM") {
        accountTypeTag.textContent = "SIM";
        accountTypeTag.className =
          "text-[9px] font-mono font-bold px-1 bg-[#ffab00]/15 text-[#ffab00] border border-[#ffab00]/30";
      } else if (account.is_virtual || loginid.startsWith("VRTC")) {
        accountTypeTag.textContent = "DEMO";
        accountTypeTag.className =
          "text-[9px] font-mono font-bold px-1 bg-[#2979ff]/15 text-[#2979ff] border border-[#2979ff]/30";
      } else {
        accountTypeTag.textContent = "REAL";
        accountTypeTag.className =
          "text-[9px] font-mono font-bold px-1 bg-[#00c853]/15 text-[#00c853] border border-[#00c853]/40";
      }
    }
  }

  function updateRiskAndBotUI(riskSummary, strategyConfig) {
    if (riskSummary) {
      const pnl = Number(riskSummary.total_profit || 0);
      sessionPnl.textContent = `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`;
      sessionPnl.className = `text-sm font-bold tabular-nums ${
        pnl > 0 ? "text-[#00c853]" : pnl < 0 ? "text-[#ff3d57]" : "text-white"
      }`;
      sessionWinRate.textContent = `${Number(riskSummary.win_rate || 0).toFixed(1)}%`;
      sessionWL.textContent = `${riskSummary.wins} / ${riskSummary.losses}`;
      nextStakeLabel.textContent = `$${Number(riskSummary.current_stake || 0.35).toFixed(2)}`;
      profitLockValue.textContent =
        state.risk.profit_floor > 0 ? `+$${state.risk.profit_floor.toFixed(2)}` : "$0.00";

      if (riskSummary.halt_reason) {
        haltAlertBox.textContent = `EXECUTION HALTED // ${riskSummary.halt_reason}`;
        haltAlertBox.classList.remove("hidden");
      } else {
        haltAlertBox.classList.add("hidden");
      }
    }

    if (strategyConfig) {
      state.botEnabled = Boolean(strategyConfig.enabled);
      if (state.botEnabled) {
        botStateBadge.textContent = "ACTIVE // AUTO-EXEC";
        botStateBadge.className =
          "font-mono text-[10px] px-2 py-0.5 bg-[#00c853]/15 text-[#00c853] border border-[#00c853]/40 font-bold";
        toggleBotBtn.textContent = "DISENGAGE AUTOMATED ML BOT";
        toggleBotBtn.className =
          "terminal-btn w-full py-2.5 bg-[#ff3d57] hover:bg-[#e0324a] text-white font-bold text-xs";
      } else {
        botStateBadge.textContent = "STANDBY";
        botStateBadge.className =
          "font-mono text-[10px] px-2 py-0.5 bg-[#151a24] text-[#8b949e] border border-[#1e2533]";
        toggleBotBtn.textContent = "ENGAGE AUTOMATED ML BOT";
        toggleBotBtn.className =
          "terminal-btn w-full py-2.5 bg-[#00c853] hover:bg-[#00b248] text-[#090b0f] font-bold text-xs";
      }
    }
  }

  function renderTradesTable() {
    if (!state.trades.length) {
      tradeHistoryBody.innerHTML = `
        <tr>
          <td colspan="7" class="py-6 text-center text-[#586069] font-sans">
            No contracts executed in current session. Engage ML Auto-Bot or execute via Manual Order Ticket.
          </td>
        </tr>
      `;
      return;
    }

    tradeHistoryBody.innerHTML = state.trades
      .slice(0, 35)
      .map((t) => {
        const badgeColor =
          t.status === "WON"
            ? "bg-[#00c853]/15 text-[#00c853] border-[#00c853]/40"
            : t.status === "LOST"
            ? "bg-[#ff3d57]/15 text-[#ff3d57] border-[#ff3d57]/40"
            : "bg-[#ffab00]/15 text-[#ffab00] border-[#ffab00]/40";
        const profitStr =
          t.status === "OPEN"
            ? "PENDING"
            : `${t.profit >= 0 ? "+" : ""}$${Number(t.profit).toFixed(2)}`;
        const profitColor =
          t.profit > 0
            ? "text-[#00c853]"
            : t.profit < 0
            ? "text-[#ff3d57]"
            : "text-[#8b949e]";
        const barrierText =
          t.barrier !== null && t.barrier !== undefined ? ` [${t.barrier}]` : "";
        const execMode = t.is_paper ? "SIM" : "LIVE";

        return `
          <tr class="hover:bg-[#151a24]/60">
            <td class="py-1.5 px-2.5 text-[#8b949e]">${t.id} <span class="text-[9px] text-[#586069]">(${execMode})</span></td>
            <td class="py-1.5 px-2 font-bold text-white">${t.contract_type}${barrierText}</td>
            <td class="py-1.5 px-2">${t.entry_digit} &rarr; ${t.exit_digit ?? "-"}</td>
            <td class="py-1.5 px-2">$${Number(t.stake).toFixed(2)}</td>
            <td class="py-1.5 px-2">
              <span class="px-1.5 py-0.5 border text-[9px] font-bold ${badgeColor}">${t.status}</span>
            </td>
            <td class="py-1.5 px-2 font-bold ${profitColor}">${profitStr}</td>
            <td class="py-1.5 px-2.5 font-sans text-[#8b949e] truncate max-w-[230px]" title="${t.reason}">${t.reason}</td>
          </tr>
        `;
      })
      .join("");
  }

  function drawChart() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    // Subtle institutional grid lines
    ctx.strokeStyle = "#141923";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const gy = (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }

    if (state.chartMode === "ticks") {
      const pts = state.ticks.slice(-60);
      if (pts.length < 2) return;

      const quotes = pts.map((p) => p.quote);
      const minQ = Math.min(...quotes);
      const maxQ = Math.max(...quotes);
      const range = maxQ - minQ || 1;

      ctx.strokeStyle = "#00c853";
      ctx.lineWidth = 1.6;
      ctx.beginPath();

      pts.forEach((pt, i) => {
        const x = (i / (pts.length - 1)) * (w - 20) + 10;
        const y = h - 14 - ((pt.quote - minQ) / range) * (h - 28);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();

      const last = pts[pts.length - 1];
      const lx = w - 10;
      const ly = h - 14 - ((last.quote - minQ) / range) * (h - 28);
      ctx.fillStyle = "#00c853";
      ctx.beginPath();
      ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const candles = state.candles.slice(-36);
      if (!candles.length) return;

      const highs = candles.map((c) => c.high);
      const lows = candles.map((c) => c.low);
      const minP = Math.min(...lows);
      const maxP = Math.max(...highs);
      const range = maxP - minP || 1;

      const slotWidth = (w - 20) / candles.length;
      const bodyWidth = Math.max(4, slotWidth * 0.62);

      candles.forEach((c, idx) => {
        const xCenter = 10 + idx * slotWidth + slotWidth / 2;
        const yHigh = h - 14 - ((c.high - minP) / range) * (h - 28);
        const yLow = h - 14 - ((c.low - minP) / range) * (h - 28);
        const yOpen = h - 14 - ((c.open - minP) / range) * (h - 28);
        const yClose = h - 14 - ((c.close - minP) / range) * (h - 28);

        const bullish = c.close >= c.open;
        ctx.strokeStyle = bullish ? "#00c853" : "#ff3d57";
        ctx.fillStyle = bullish ? "#00c853" : "#ff3d57";

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
  // 4. BROWSER EXECUTION ENGINE (REAL/DEMO DERIV API + PAPER SIMULATOR)
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

  function recordCompletedTradeOutcome(t, won, profitAmount, payoutAmount) {
    if (won) {
      t.profit = Number(profitAmount.toFixed(2));
      t.payout = Number(payoutAmount.toFixed(2));
      t.status = "WON";
      state.risk.wins++;
      state.risk.consecutive_losses = 0;
      state.risk.current_stake = state.risk.base_stake;
    } else {
      t.profit = Number(profitAmount.toFixed(2));
      t.payout = 0;
      t.status = "LOST";
      state.risk.losses++;
      state.risk.consecutive_losses++;
      // Cooldown 2 ticks after loss so bot doesn't rapid-fire into adverse micro-burst
      state.cooldownTicks = 2;
      if (state.risk.use_martingale) {
        state.risk.current_stake = Math.max(
          0.35,
          Number((state.risk.current_stake * state.risk.martingale_multiplier).toFixed(2))
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

    // Update Trailing Profit Lock (High-Water Mark)
    if (state.risk.total_profit > state.risk.peak_profit) {
      state.risk.peak_profit = state.risk.total_profit;
      if (
        state.risk.use_profit_lock &&
        state.risk.peak_profit >= state.risk.base_stake * 3
      ) {
        state.risk.profit_floor = Number((state.risk.peak_profit * 0.5).toFixed(2));
      }
    }

    if (state.account.loginid === "PAPER-SIM") {
      state.account.balance = Number((10000 + state.risk.total_profit).toFixed(2));
    }

    updateRiskAndBotUI(state.risk, state.strategyConfig);
    updateConnectionHeader(state.connectedToDeriv, state.authorized, state.account, state.symbol);
    renderTradesTable();
  }

  function executeContractOrder(contractType, barrier, durationTicks, reason) {
    const lastTick = state.ticks[state.ticks.length - 1];
    if (!lastTick) return;

    const stake = Math.max(0.35, Number(state.risk.current_stake.toFixed(2)));
    const forceSim = paperTradingToggle.checked;
    const isPaper = forceSim || !state.authorized || !directDerivWS;
    const needsBarrier = ["DIGITOVER", "DIGITUNDER", "DIGITMATCH", "DIGITDIFF"].includes(
      contractType
    );
    const cleanBarrier = needsBarrier ? (barrier ?? state.barrier) : null;

    const trade = {
      id: `ORD-${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
      timestamp: Math.floor(Date.now() / 1000),
      symbol: state.symbol,
      strategy: state.strategyConfig.strategy_type,
      contract_type: contractType,
      barrier: cleanBarrier,
      duration_ticks: durationTicks,
      stake,
      entry_quote: lastTick.quote,
      entry_digit: lastTick.last_digit,
      exit_quote: null,
      exit_digit: null,
      status: "OPEN",
      payout: 0,
      profit: 0,
      is_paper: isPaper,
      reason,
    };

    state.trades.unshift(trade);
    renderTradesTable();

    if (isPaper) {
      state.pendingPaperTrades.push({ trade, remaining: durationTicks });
    } else {
      // Execute Live / Demo contract on user's authenticated Deriv WebSocket
      const params = {
        amount: stake,
        basis: "stake",
        contract_type: contractType,
        currency: state.account.currency || "USD",
        duration: durationTicks,
        duration_unit: "t",
        symbol: state.symbol,
      };
      if (needsBarrier) {
        params.barrier = String(cleanBarrier);
      }
      state.liveOpenContracts[trade.id] = trade;
      directDerivWS.send(
        JSON.stringify({
          buy: 1,
          price: stake,
          parameters: params,
          passthrough: { trade_id: trade.id },
        })
      );
    }
  }

  function evaluateAutomatedStrategy(tick, stats) {
    if (!state.strategyConfig.enabled) return;
    if (
      state.pendingPaperTrades.length > 0 ||
      Object.keys(state.liveOpenContracts).length > 0
    ) {
      return;
    }
    if (stats.total_ticks < 20) return;

    if (state.cooldownTicks > 0) {
      state.cooldownTicks--;
      return;
    }

    // 1. Check Capital Preservation & Trailing Profit Lock Guards
    if (state.risk.total_profit >= state.risk.take_profit) {
      state.risk.halt_reason = `TARGET TAKE PROFIT REACHED (+$${state.risk.total_profit.toFixed(2)})`;
      state.strategyConfig.enabled = false;
      updateRiskAndBotUI(state.risk, state.strategyConfig);
      return;
    }
    if (state.risk.total_profit <= -Math.abs(state.risk.stop_loss)) {
      state.risk.halt_reason = `HARD STOP LOSS TRIGGERED (-$${Math.abs(state.risk.total_profit).toFixed(2)})`;
      state.strategyConfig.enabled = false;
      updateRiskAndBotUI(state.risk, state.strategyConfig);
      return;
    }
    if (state.risk.consecutive_losses >= state.risk.max_consecutive_losses) {
      state.risk.halt_reason = `MAX CONSECUTIVE LOSSES (${state.risk.consecutive_losses})`;
      state.strategyConfig.enabled = false;
      updateRiskAndBotUI(state.risk, state.strategyConfig);
      return;
    }
    if (
      state.risk.use_profit_lock &&
      state.risk.profit_floor > 0 &&
      state.risk.total_profit <= state.risk.profit_floor
    ) {
      state.risk.halt_reason = `TRAILING PROFIT LOCK ENGAGED (+$${state.risk.total_profit.toFixed(2)} LOCKED)`;
      state.strategyConfig.enabled = false;
      updateRiskAndBotUI(state.risk, state.strategyConfig);
      return;
    }

    const st = state.strategyConfig.strategy_type;
    const threshold = state.strategyConfig.streak_threshold;
    const minMl = state.strategyConfig.ml_threshold || 68;
    const dur = state.strategyConfig.duration_ticks;
    const bar = state.strategyConfig.barrier;
    const ml = state.mlTelemetry;

    if (st === "ML_ADAPTIVE_EDGE") {
      if (ml.confidence >= minMl) {
        executeContractOrder(
          ml.optimalContract,
          ml.optimalBarrier,
          dur,
          `ML Conf ${ml.confidence}% // ${ml.optimalReason}`
        );
      }
    } else if (st === "SMALL_ACCT_SURVIVAL") {
      // High-win-rate small account builder: waits for 2 consecutive low digits (0/1) -> OVER 1, or 2 high digits (8/9) -> UNDER 8
      const recent2 = stats.recent_digits.slice(-2);
      if (recent2.length === 2 && recent2.every((d) => d <= 1) && ml.confidence >= 60) {
        executeContractOrder(
          "DIGITOVER",
          1,
          dur,
          `Small-Acct Compounder: 2x Low Digits [0-1] -> OVER 1`
        );
      } else if (recent2.length === 2 && recent2.every((d) => d >= 8) && ml.confidence >= 60) {
        executeContractOrder(
          "DIGITUNDER",
          8,
          dur,
          `Small-Acct Compounder: 2x High Digits [8-9] -> UNDER 8`
        );
      } else if (
        tick.last_digit === ml.safestDiffDigit &&
        ml.safestDiffProb <= 7.5 &&
        ml.confidence >= minMl
      ) {
        executeContractOrder(
          "DIGITDIFF",
          ml.safestDiffDigit,
          dur,
          `Small-Acct Compounder: Rare Digit ${ml.safestDiffDigit} (${ml.safestDiffProb}%) -> DIFF`
        );
      }
    } else if (st === "EVEN_ODD_STREAK") {
      if (stats.current_odd_streak >= threshold) {
        executeContractOrder(
          "DIGITEVEN",
          null,
          dur,
          `Odd streak ${stats.current_odd_streak}x -> Mean-Reversion DIGITEVEN`
        );
      } else if (stats.current_even_streak >= threshold) {
        executeContractOrder(
          "DIGITODD",
          null,
          dur,
          `Even streak ${stats.current_even_streak}x -> Mean-Reversion DIGITODD`
        );
      }
    } else if (st === "OVER_UNDER_EDGE") {
      const tail = stats.recent_digits.slice(-threshold);
      if (tail.length >= threshold) {
        if (tail.every((d) => d <= bar) && stats.over_pct >= 40) {
          executeContractOrder(
            "DIGITOVER",
            bar,
            dur,
            `${threshold} ticks <= ${bar} -> DIGITOVER ${bar}`
          );
        } else if (tail.every((d) => d >= bar) && stats.under_pct >= 40) {
          executeContractOrder(
            "DIGITUNDER",
            bar,
            dur,
            `${threshold} ticks >= ${bar} -> DIGITUNDER ${bar}`
          );
        }
      }
    } else if (st === "MATCH_DIFF_COLD") {
      const coldest = stats.coldest_digit;
      const coldPct = stats.percentages[coldest] ?? 10;
      if (tick.last_digit === coldest && coldPct <= 8.0) {
        executeContractOrder(
          "DIGITDIFF",
          coldest,
          dur,
          `Coldest digit ${coldest} (${coldPct}%) -> DIGITDIFF ${coldest}`
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
          executeContractOrder("CALL", null, dur, `Momentum ${threshold}x rising ticks -> CALL`);
        } else if (diffs.every((d) => d < 0)) {
          executeContractOrder("PUT", null, dur, `Momentum ${threshold}x falling ticks -> PUT`);
        }
      }
    }
  }

  function processIncomingTick(quote, epoch, pipSize, isHistorical = false) {
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
    if (state.ticks.length > 600) state.ticks.shift();

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
            const profit = Number((t.stake * ratio).toFixed(2));
            recordCompletedTradeOutcome(t, true, profit, t.stake + profit);
          } else {
            recordCompletedTradeOutcome(t, false, -t.stake, 0);
          }
        } else {
          nextPending.push(item);
        }
      });
      state.pendingPaperTrades = nextPending;
    }

    const stats = computeClientDigitStats();
    updateOnlineMLModel(stats);
    evaluateAutomatedStrategy(tick, stats);

    updateTickBanner(tick);
    updateDigitHeatmap(stats, tick.last_digit);
    updateRiskAndBotUI(state.risk, state.strategyConfig);
    updateConnectionHeader(state.connectedToDeriv, state.authorized, state.account, state.symbol);
    drawChart();
  }

  // ============================================================================
  // 5. DERIV WEBSOCKET CONNECTION (SUPPORTS MULTI-USER OAUTH + LIVE BUY)
  // ============================================================================

  function connectDerivWebSocket() {
    if (directDerivWS) {
      try {
        directDerivWS.onclose = null;
        directDerivWS.close();
      } catch (_) {}
    }
    if (pingTimer) clearInterval(pingTimer);

    state.ticks = [];
    state.candles = [];
    state.authorized = false;

    if (!state.apiToken) {
      state.account = {
        loginid: "PAPER-SIM",
        currency: "USD",
        balance: Number((10000 + state.risk.total_profit).toFixed(2)),
        is_virtual: true,
      };
    }

    const wsUrl = `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(
      state.appId || "1089"
    )}`;
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
          count: 120,
          end: "latest",
          style: "ticks",
          subscribe: 1,
        })
      );

      pingTimer = setInterval(() => {
        if (directDerivWS && directDerivWS.readyState === WebSocket.OPEN) {
          directDerivWS.send(JSON.stringify({ ping: 1 }));
        }
      }, 25000);
    };

    directDerivWS.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      const pipSize = PIP_SIZES[state.symbol] || 2;

      if (msg.error) {
        haltAlertBox.textContent = `DERIV API // ${msg.error.message}`;
        haltAlertBox.classList.remove("hidden");
        return;
      }

      if (msg.msg_type === "authorize" && msg.authorize) {
        state.authorized = true;
        state.account = {
          loginid: msg.authorize.loginid || "DERIV",
          currency: msg.authorize.currency || "USD",
          balance: Number(msg.authorize.balance || 0),
          is_virtual: Boolean(msg.authorize.is_virtual),
        };
        // Populate account list if returned by authorize.account_list
        if (Array.isArray(msg.authorize.account_list) && state.savedAccounts.length === 0) {
          renderAccountSwitcher();
        } else {
          renderAccountSwitcher();
        }
        directDerivWS.send(JSON.stringify({ balance: 1, subscribe: 1 }));
        updateConnectionHeader(true, true, state.account, state.symbol);
      } else if (msg.msg_type === "balance" && msg.balance) {
        state.account.balance = Number(msg.balance.balance ?? state.account.balance);
        updateConnectionHeader(true, state.authorized, state.account, state.symbol);
      } else if (msg.msg_type === "history" && msg.history) {
        const prices = msg.history.prices || [];
        const times = msg.history.times || [];
        const pSize = msg.pip_size !== undefined ? Number(msg.pip_size) : pipSize;
        for (let i = 0; i < prices.length; i++) {
          processIncomingTick(Number(prices[i]), Number(times[i]), pSize, i < prices.length - 1);
        }
      } else if (msg.msg_type === "tick" && msg.tick) {
        const pSize = msg.tick.pip_size !== undefined ? Number(msg.tick.pip_size) : pipSize;
        processIncomingTick(Number(msg.tick.quote), Number(msg.tick.epoch), pSize, false);
      } else if (msg.msg_type === "buy" && msg.buy) {
        const contractId = msg.buy.contract_id;
        const tradeId = msg.passthrough && msg.passthrough.trade_id;
        if (contractId && directDerivWS) {
          directDerivWS.send(
            JSON.stringify({
              proposal_open_contract: 1,
              contract_id: contractId,
              subscribe: 1,
              passthrough: { trade_id: tradeId },
            })
          );
        }
      } else if (msg.msg_type === "proposal_open_contract" && msg.proposal_open_contract) {
        const poc = msg.proposal_open_contract;
        if (poc.is_sold) {
          const tradeId = msg.passthrough && msg.passthrough.trade_id;
          const t = state.liveOpenContracts[tradeId];
          if (t) {
            delete state.liveOpenContracts[tradeId];
            const profit = Number(poc.profit || 0);
            const sellPrice = Number(poc.sell_price || 0);
            const exitQuote = Number(poc.exit_tick || t.entry_quote);
            const pipSz = PIP_SIZES[state.symbol] || 2;
            const { lastDigit } = extractLastDigitClient(exitQuote, pipSz);
            t.exit_quote = exitQuote;
            t.exit_digit = lastDigit;
            recordCompletedTradeOutcome(t, profit > 0, profit, sellPrice);
          }
        }
      }
    };

    directDerivWS.onclose = () => {
      state.connectedToDeriv = false;
      updateConnectionHeader(false, false, state.account, state.symbol);
      setTimeout(connectDerivWebSocket, 3000);
    };
  }

  // ============================================================================
  // 6. EVENT LISTENERS & SMALL-ACCOUNT PRESETS
  // ============================================================================

  symbolSelect.addEventListener("change", () => {
    state.symbol = symbolSelect.value;
    connectDerivWebSocket();
  });

  accountSwitcherSelect.addEventListener("change", () => {
    const val = accountSwitcherSelect.value;
    if (val === "PAPER-SIM") {
      state.apiToken = "";
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_TOKEN);
    } else {
      state.apiToken = val;
      localStorage.setItem(STORAGE_KEYS.ACTIVE_TOKEN, val);
    }
    renderAccountSwitcher();
    connectDerivWebSocket();
  });

  derivOAuthBtn.addEventListener("click", triggerDerivOAuthLogin);
  document.getElementById("modalOAuthLoginBtn").addEventListener("click", triggerDerivOAuthLogin);

  logoutDerivBtn.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEYS.ACCOUNTS);
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_TOKEN);
    state.savedAccounts = [];
    state.apiToken = "";
    state.authorized = false;
    renderAccountSwitcher();
    connectDerivWebSocket();
  });

  // Small-Account Compounding Presets ($10 / $25 / $50 / $100)
  document.querySelectorAll(".account-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cap = Number(btn.getAttribute("data-preset"));
      // 3% base stake (floored at $0.35), 18% Take Profit, 15% Stop Loss, 1.6x Soft Recovery
      const stake = Math.max(0.35, Number((cap * 0.03).toFixed(2)));
      const tp = Number((cap * 0.18).toFixed(2));
      const sl = Number((cap * 0.15).toFixed(2));

      baseStakeInput.value = stake;
      takeProfitInput.value = tp;
      stopLossInput.value = sl;
      maxLossStreakInput.value = 4;
      useMartingaleToggle.checked = true;
      martingaleMultInput.value = 1.65;
      useProfitLockToggle.checked = true;
      strategySelect.value = "ML_ADAPTIVE_EDGE";

      state.risk.base_stake = stake;
      state.risk.current_stake = stake;
      state.risk.take_profit = tp;
      state.risk.stop_loss = sl;
      state.risk.max_consecutive_losses = 4;
      state.risk.use_martingale = true;
      state.risk.martingale_multiplier = 1.65;
      state.risk.use_profit_lock = true;
      state.risk.halt_reason = null;

      updateRiskAndBotUI(state.risk, state.strategyConfig);
    });
  });

  toggleBotBtn.addEventListener("click", () => {
    const nextEnabled = !state.botEnabled;
    state.barrier = Number(barrierInput.value || 4);
    state.windowSize = Number(document.getElementById("windowSizeInput").value || 100);

    state.strategyConfig = {
      enabled: nextEnabled,
      strategy_type: strategySelect.value,
      symbol: symbolSelect.value,
      contract_type: "DIGITEVEN",
      duration_ticks: Number(durationTicksInput.value || 1),
      barrier: state.barrier,
      streak_threshold: Number(streakThresholdInput.value || 4),
      ml_threshold: Number(mlThresholdInput.value || 68),
      window_size: state.windowSize,
      paper_trading: paperTradingToggle.checked,
    };
    if (nextEnabled) state.risk.halt_reason = null;
    updateRiskAndBotUI(state.risk, state.strategyConfig);
  });

  document.querySelectorAll(".manual-trade-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const contractType = btn.getAttribute("data-contract");
      const dur = Number(durationTicksInput.value || 1);
      const bar = Number(barrierInput.value || 4);
      executeContractOrder(contractType, bar, dur, "Direct Order Ticket Fill");
    });
  });

  saveRiskBtn.addEventListener("click", () => {
    state.risk.base_stake = Math.max(0.35, Number(baseStakeInput.value || 0.35));
    state.risk.take_profit = Number(takeProfitInput.value || 3.0);
    state.risk.stop_loss = Number(stopLossInput.value || 2.5);
    state.risk.max_consecutive_losses = Number(maxLossStreakInput.value || 4);
    state.risk.use_martingale = useMartingaleToggle.checked;
    state.risk.martingale_multiplier = Number(martingaleMultInput.value || 1.65);
    state.risk.use_profit_lock = useProfitLockToggle.checked;
    if (state.risk.consecutive_losses === 0) {
      state.risk.current_stake = state.risk.base_stake;
    }
    state.risk.halt_reason = null;
    updateRiskAndBotUI(state.risk, state.strategyConfig);
  });

  resetSessionBtn.addEventListener("click", () => {
    state.risk.current_stake = state.risk.base_stake;
    state.risk.consecutive_losses = 0;
    state.risk.total_profit = 0;
    state.risk.peak_profit = 0;
    state.risk.profit_floor = 0;
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
  });

  chartModeTicksBtn.addEventListener("click", () => {
    state.chartMode = "ticks";
    chartModeTicksBtn.className =
      "terminal-btn px-2 py-0.5 bg-[#2979ff]/20 text-[#2979ff] border border-[#2979ff]/40";
    chartModeCandlesBtn.className =
      "terminal-btn px-2 py-0.5 bg-[#151a24] text-[#8b949e] border border-[#1e2533]";
    drawChart();
  });

  chartModeCandlesBtn.addEventListener("click", () => {
    state.chartMode = "candles";
    chartModeCandlesBtn.className =
      "terminal-btn px-2 py-0.5 bg-[#2979ff]/20 text-[#2979ff] border border-[#2979ff]/40";
    chartModeTicksBtn.className =
      "terminal-btn px-2 py-0.5 bg-[#151a24] text-[#8b949e] border border-[#1e2533]";
    drawChart();
  });

  // Modal handlers
  const apiModal = document.getElementById("apiModal");
  document.getElementById("openApiModalBtn").addEventListener("click", () => {
    document.getElementById("appIdInput").value = state.appId;
    document.getElementById("apiTokenInput").value = state.apiToken;
    apiModal.classList.remove("hidden");
    apiModal.classList.add("flex");
  });
  const closeModal = () => {
    apiModal.classList.add("hidden");
    apiModal.classList.remove("flex");
  };
  document.getElementById("closeApiModalBtn").addEventListener("click", closeModal);
  document.getElementById("cancelApiModalBtn").addEventListener("click", closeModal);
  document.getElementById("saveApiModalBtn").addEventListener("click", () => {
    state.appId = (document.getElementById("appIdInput").value || "1089").trim();
    state.apiToken = (document.getElementById("apiTokenInput").value || "").trim();
    state.windowSize = Number(document.getElementById("windowSizeInput").value || 100);
    state.barrier = Number(barrierInput.value || 4);

    localStorage.setItem(STORAGE_KEYS.APP_ID, state.appId);
    if (state.apiToken) {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_TOKEN, state.apiToken);
    } else {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_TOKEN);
    }
    renderAccountSwitcher();
    connectDerivWebSocket();
    closeModal();
  });

  window.addEventListener("resize", drawChart);

  initDigitGrid();
  parseDerivOAuthRedirect();
  connectDerivWebSocket();
})();
