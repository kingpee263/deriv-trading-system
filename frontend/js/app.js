(() => {
  const ALL_SYMBOLS = [
    "R_100",
    "1HZ100V",
    "R_75",
    "1HZ75V",
    "R_50",
    "1HZ50V",
    "R_25",
    "1HZ25V",
    "R_10",
    "1HZ10V",
  ];

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
    ACCOUNTS: "deriv_prodesk_accounts_v3",
    ACTIVE_TOKEN: "deriv_prodesk_active_token_v3",
    APP_ID: "deriv_prodesk_app_id_v3",
  };

  // Per-symbol live buffers for the 10-index parallel scanner
  const marketBuffers = {};
  ALL_SYMBOLS.forEach((sym) => {
    marketBuffers[sym] = {
      ticks: [],
      candles: [],
      confidence: 50.0,
      optimalContract: "DIGITOVER",
      optimalBarrier: 2,
      optimalReason: "Streaming live Deriv ticks...",
      evenStreak: 0,
      oddStreak: 0,
      ema8: null,
      ema21: null,
      rsi7: 50.0,
      velocity: 0.0,
    };
  });

  const state = {
    symbol: "R_100",
    appId: localStorage.getItem(STORAGE_KEYS.APP_ID) || "1089",
    apiToken: localStorage.getItem(STORAGE_KEYS.ACTIVE_TOKEN) || "",
    savedAccounts: [],
    guestModeDismissed: false,
    windowSize: 100,
    barrier: 2,
    timeframeSec: 60,
    connectedToDeriv: false,
    authorized: false,
    botEnabled: false,
    chartMode: "ticks",
    digitStats: null,
    liveProposals: {}, // contractType -> { id, ask_price, payout, net_pct }
    mlTelemetry: {
      confidence: 0,
      regime: "CALIBRATING",
      predictedDigit: 0,
      predictedProb: 10.0,
      safestDiffDigit: 0,
      safestDiffProb: 10.0,
      chiSquare: 0.0,
      entropy: 3.32,
      optimalContract: "DIGITOVER",
      optimalBarrier: 2,
      optimalReason: "Connecting to live Deriv stream...",
    },
    shadowBot: {
      requiredLosses: 1,
      currentShadowLosses: 0,
      pendingVirtualTrade: null,
    },
    trades: [],
    liveOpenContracts: {},
    cooldownTicks: 0,
    account: {
      loginid: "GUEST",
      email: "",
      currency: "USD",
      balance: 0.0,
      is_virtual: false,
    },
    strategyConfig: {
      enabled: false,
      strategy_type: "ML_ADAPTIVE_EDGE",
      symbol: "R_100",
      contract_type: "DIGITOVER",
      duration_ticks: 1,
      barrier: 2,
      streak_threshold: 4,
      ml_threshold: 68,
      virtual_losses_required: 1,
      window_size: 100,
    },
    risk: {
      base_stake: 0.35,
      take_profit: 1.5,
      stop_loss: 2.0,
      max_consecutive_losses: 4,
      cross_contract_recovery: true,
      use_martingale: true,
      martingale_multiplier: 1.45,
      use_profit_lock: true,
      peak_profit: 0.0,
      profit_floor: 0.0,
      recovery_deficit: 0.0,
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
  const loginGateOverlay = document.getElementById("loginGateOverlay");
  const gateTokenInput = document.getElementById("gateTokenInput");
  const gateLoginBtn = document.getElementById("gateLoginBtn");
  const gateErrorBox = document.getElementById("gateErrorBox");
  const gateOAuthBtn = document.getElementById("gateOAuthBtn");
  const gateGuestPreviewBtn = document.getElementById("gateGuestPreviewBtn");
  const gateCurrentAppId = document.getElementById("gateCurrentAppId");
  const popupTokenPageBtn = document.getElementById("popupTokenPageBtn");

  const wsDot = document.getElementById("wsDot");
  const connBadge = document.getElementById("connBadge");
  const symbolSelect = document.getElementById("symbolSelect");
  const userEmailLabel = document.getElementById("userEmailLabel");
  const accountTypeTag = document.getElementById("accountTypeTag");
  const accountSwitcherSelect = document.getElementById("accountSwitcherSelect");
  const accountLoginId = document.getElementById("accountLoginId");
  const accountBalance = document.getElementById("accountBalance");
  const connectAccountBtnLabel = document.getElementById("connectAccountBtnLabel");
  const syncDerivHistoryBtn = document.getElementById("syncDerivHistoryBtn");
  const logoutDerivBtn = document.getElementById("logoutDerivBtn");
  const liveOnboardingBar = document.getElementById("liveOnboardingBar");
  const quickTokenInput = document.getElementById("quickTokenInput");
  const quickConnectBtn = document.getElementById("quickConnectBtn");
  const reopenLoginGateBtn = document.getElementById("reopenLoginGateBtn");
  const multiMarketScannerGrid = document.getElementById("multiMarketScannerGrid");
  const autoSwitchMarketToggle = document.getElementById("autoSwitchMarketToggle");

  const liveQuote = document.getElementById("liveQuote");
  const liveEpoch = document.getElementById("liveEpoch");
  const liveLastDigit = document.getElementById("liveLastDigit");
  const liveParityBadge = document.getElementById("liveParityBadge");
  const streakSummary = document.getElementById("streakSummary");
  const microTrendBadge = document.getElementById("microTrendBadge");

  // ML DOM
  const shadowStatusBadge = document.getElementById("shadowStatusBadge");
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
  const orderTicketModeLabel = document.getElementById("orderTicketModeLabel");

  // Strategy & Risk Controls
  const botStateBadge = document.getElementById("botStateBadge");
  const sessionPnl = document.getElementById("sessionPnl");
  const sessionWinRate = document.getElementById("sessionWinRate");
  const sessionWL = document.getElementById("sessionWL");
  const profitLockValue = document.getElementById("profitLockValue");
  const haltAlertBox = document.getElementById("haltAlertBox");
  const strategySelect = document.getElementById("strategySelect");
  const mlThresholdInput = document.getElementById("mlThresholdInput");
  const virtualLossInput = document.getElementById("virtualLossInput");
  const streakThresholdInput = document.getElementById("streakThresholdInput");
  const barrierInput = document.getElementById("barrierInput");
  const durationTicksInput = document.getElementById("durationTicksInput");
  const toggleBotBtn = document.getElementById("toggleBotBtn");

  const nextStakeLabel = document.getElementById("nextStakeLabel");
  const baseStakeInput = document.getElementById("baseStakeInput");
  const maxLossStreakInput = document.getElementById("maxLossStreakInput");
  const takeProfitInput = document.getElementById("takeProfitInput");
  const stopLossInput = document.getElementById("stopLossInput");
  const crossContractRecoveryToggle = document.getElementById("crossContractRecoveryToggle");
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
  // 1. BROWSER LOGIN GATE & DERIV OAUTH / TOKEN SESSION MANAGER
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

    gateCurrentAppId.textContent = state.appId;
    if (state.apiToken) {
      loginGateOverlay.classList.add("hidden");
    }
    renderAccountSwitcher();
  }

  function renderAccountSwitcher() {
    accountSwitcherSelect.innerHTML = "";

    state.savedAccounts.forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item.token || item.acct;
      const isDemo = item.acct.startsWith("VRTC") || item.acct.startsWith("VRT");
      opt.textContent = `${item.acct} (${isDemo ? "DEMO" : "REAL"} ${item.cur})`;
      if (item.token === state.apiToken || item.acct === state.account.loginid) {
        opt.selected = true;
      }
      accountSwitcherSelect.appendChild(opt);
    });

    if (
      state.apiToken &&
      !state.savedAccounts.some(
        (a) => a.token === state.apiToken || a.acct === state.account.loginid
      )
    ) {
      const opt = document.createElement("option");
      opt.value = state.apiToken;
      opt.textContent =
        state.account.loginid !== "GUEST"
          ? `${state.account.loginid} (${state.account.currency})`
          : "AUTHORIZING DERIV...";
      opt.selected = true;
      accountSwitcherSelect.appendChild(opt);
    }

    if (!state.apiToken) {
      const guestOpt = document.createElement("option");
      guestOpt.value = "GUEST";
      guestOpt.textContent = "Not Signed In (Guest)";
      guestOpt.selected = true;
      accountSwitcherSelect.appendChild(guestOpt);
    }

    if (state.apiToken) {
      logoutDerivBtn.classList.remove("hidden");
      liveOnboardingBar.classList.add("hidden");
      connectAccountBtnLabel.textContent = "Account / App ID";
    } else {
      logoutDerivBtn.classList.add("hidden");
      liveOnboardingBar.classList.remove("hidden");
      connectAccountBtnLabel.textContent = "Sign In to Deriv";
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
  // 2. DIRECT DERIV LIVE PROPOSALS, PROFIT TABLE & OFFICIAL CANDLE FEEDS
  // ============================================================================

  function subscribeLiveDerivProposals() {
    if (!directDerivWS || directDerivWS.readyState !== WebSocket.OPEN) return;

    // Forget previous proposal streams before re-subscribing with new symbol/stake/barrier
    directDerivWS.send(JSON.stringify({ forget_all: "proposal" }));

    const stake = Math.max(0.35, Number(state.risk.current_stake || 0.35));
    const dur = Number(durationTicksInput.value || 1);
    const bar = Number(barrierInput.value || 2);
    const cur = state.account.currency || "USD";

    const contractsToQuote = [
      { type: "DIGITEVEN", needsBarrier: false },
      { type: "DIGITODD", needsBarrier: false },
      { type: "DIGITOVER", needsBarrier: true, barrier: bar },
      { type: "DIGITUNDER", needsBarrier: true, barrier: bar },
      { type: "DIGITDIFF", needsBarrier: true, barrier: bar },
      { type: "DIGITMATCH", needsBarrier: true, barrier: bar },
      { type: "CALL", needsBarrier: false },
      { type: "PUT", needsBarrier: false },
    ];

    contractsToQuote.forEach((item) => {
      const req = {
        proposal: 1,
        subscribe: 1,
        amount: stake,
        basis: "stake",
        contract_type: item.type,
        currency: cur,
        duration: dur,
        duration_unit: "t",
        symbol: state.symbol,
        passthrough: { contract_type: item.type },
      };
      if (item.needsBarrier) {
        req.barrier = String(item.barrier);
      }
      directDerivWS.send(JSON.stringify(req));
    });
  }

  function subscribeOfficialSymbolCandles(sym) {
    if (!directDerivWS || directDerivWS.readyState !== WebSocket.OPEN) return;
    directDerivWS.send(JSON.stringify({ forget_all: "candles" }));
    directDerivWS.send(
      JSON.stringify({
        ticks_history: sym,
        adjust_start_time: 1,
        count: 60,
        end: "latest",
        style: "candles",
        granularity: 60,
        subscribe: 1,
        passthrough: { candle_symbol: sym },
      })
    );
  }

  function syncDerivAccountData() {
    if (!directDerivWS || directDerivWS.readyState !== WebSocket.OPEN || !state.authorized) {
      return;
    }
    // 1. Live wallet balance stream
    directDerivWS.send(JSON.stringify({ balance: 1, subscribe: 1 }));
    // 2. Real historical trades from Deriv profit_table
    directDerivWS.send(
      JSON.stringify({
        profit_table: 1,
        description: 1,
        limit: 30,
        sort: "DESC",
      })
    );
    // 3. Currently open contracts from Deriv portfolio
    directDerivWS.send(JSON.stringify({ portfolio: 1 }));
  }

  // ============================================================================
  // 3. TECHNICAL INDICATORS (EMA 8/21, RSI 7, VELOCITY) & ML QUANT ENGINE
  // ============================================================================

  function updateSymbolMicrostructure(sym, quote) {
    const buf = marketBuffers[sym];
    const k8 = 2 / (8 + 1);
    const k21 = 2 / (21 + 1);

    if (buf.ema8 === null) {
      buf.ema8 = quote;
      buf.ema21 = quote;
    } else {
      buf.ema8 = quote * k8 + buf.ema8 * (1 - k8);
      buf.ema21 = quote * k21 + buf.ema21 * (1 - k21);
    }

    const ticks = buf.ticks;
    if (ticks.length >= 8) {
      let gains = 0;
      let losses = 0;
      for (let i = ticks.length - 7; i < ticks.length; i++) {
        const diff = ticks[i].quote - ticks[i - 1].quote;
        if (diff > 0) gains += diff;
        else losses -= diff;
      }
      if (losses === 0) buf.rsi7 = 95.0;
      else {
        const rs = gains / losses;
        buf.rsi7 = Number((100 - 100 / (1 + rs)).toFixed(1));
      }
    }

    if (ticks.length >= 4) {
      buf.velocity = ticks[ticks.length - 1].quote - ticks[ticks.length - 4].quote;
    }
  }

  function computeSymbolStatsAndML(sym) {
    const buf = marketBuffers[sym];
    const win = state.windowSize;
    const bar = state.barrier;
    const slice = buf.ticks.slice(-win);
    const total = slice.length;
    if (total < 12) return null;

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
      percentages[d] = Number(((counts[d] / total) * 100).toFixed(2));
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
    buf.evenStreak = evenStreak;
    buf.oddStreak = oddStreak;

    let hottest = 0;
    let coldest = 0;
    for (let d = 1; d <= 9; d++) {
      if (counts[d] >= counts[hottest]) hottest = d;
      if (counts[d] < counts[coldest]) coldest = d;
    }

    const matrix = Array.from({ length: 10 }, () => Array(10).fill(0));
    const rowSums = Array(10).fill(0);
    for (let i = 0; i < slice.length - 1; i++) {
      const f = slice[i].last_digit;
      const t = slice[i + 1].last_digit;
      matrix[f][t]++;
      rowSums[f]++;
    }

    const curDigit = slice[slice.length - 1].last_digit;
    const totalFromCur = rowSums[curDigit];
    const condProbs = {};
    for (let d = 0; d <= 9; d++) {
      const p =
        totalFromCur > 0 ? (matrix[curDigit][d] + 0.5) / (totalFromCur + 5.0) : 0.1;
      condProbs[d] = Number((p * 100).toFixed(1));
    }

    let bestDigit = 0;
    let lowestDigit = 0;
    let bestScore = -1;
    let lowestScore = 999;

    for (let d = 0; d <= 9; d++) {
      const blended = 0.6 * condProbs[d] + 0.4 * percentages[d];
      if (blended > bestScore) {
        bestScore = blended;
        bestDigit = d;
      }
      if (blended < lowestScore) {
        lowestScore = blended;
        lowestDigit = d;
      }
    }

    const expected = total / 10.0;
    let chiSq = 0;
    let entropy = 0;
    for (let d = 0; d <= 9; d++) {
      const obs = counts[d];
      chiSq += Math.pow(obs - expected, 2) / Math.max(1, expected);
      const p = obs / total;
      if (p > 0) entropy -= p * Math.log2(p);
    }

    const maxStreak = Math.max(evenStreak, oddStreak);
    const paritySkew = Math.abs((evenCount / total) * 100 - 50.0);
    const markovSpread = Math.max(0, bestScore - lowestScore);

    const rawConf =
      40 +
      Math.min(22, chiSq * 1.18) +
      Math.min(16, markovSpread * 0.9) +
      Math.min(15, maxStreak * 3.0) +
      Math.min(7, paritySkew * 0.55);
    const confidence = Math.min(97.0, Math.max(30.0, Number(rawConf.toFixed(1))));

    const recent3 = slice.slice(-3).map((t) => t.last_digit);
    const over2Pct = [3, 4, 5, 6, 7, 8, 9].reduce((acc, d) => acc + percentages[d], 0);
    const under7Pct = [0, 1, 2, 3, 4, 5, 6].reduce((acc, d) => acc + percentages[d], 0);

    let optimalContract = "DIGITOVER";
    let optimalBarrier = 2;
    let optimalReason = `Over 2 freq=${over2Pct.toFixed(1)}% (Live Deriv Feed)`;

    if (maxStreak >= 4) {
      if (oddStreak >= 4) {
        optimalContract = "DIGITEVEN";
        optimalBarrier = null;
        optimalReason = `${oddStreak}x Odd Streak Exhaustion -> BUY EVEN`;
      } else {
        optimalContract = "DIGITODD";
        optimalBarrier = null;
        optimalReason = `${evenStreak}x Even Streak Exhaustion -> BUY ODD`;
      }
    } else if (recent3.length >= 2 && recent3.slice(-2).every((d) => d <= 2) && over2Pct >= 68) {
      optimalContract = "DIGITOVER";
      optimalBarrier = 2;
      optimalReason = `2x Low-Digit Pullback + Over2=${over2Pct.toFixed(0)}% -> OVER 2`;
    } else if (recent3.length >= 2 && recent3.slice(-2).every((d) => d >= 7) && under7Pct >= 68) {
      optimalContract = "DIGITUNDER";
      optimalBarrier = 7;
      optimalReason = `2x High-Digit Pullback + Under7=${under7Pct.toFixed(0)}% -> UNDER 7`;
    } else if (curDigit === lowestDigit && lowestScore <= 7.8) {
      optimalContract = "DIGITDIFF";
      optimalBarrier = lowestDigit;
      optimalReason = `Markov Cold Digit ${lowestDigit} (${lowestScore.toFixed(1)}%) -> DIFF ${lowestDigit}`;
    }

    buf.confidence = confidence;
    buf.optimalContract = optimalContract;
    buf.optimalBarrier = optimalBarrier;
    buf.optimalReason = optimalReason;

    const statsObj = {
      symbol: sym,
      window_size: win,
      total_ticks: total,
      counts,
      percentages,
      even_pct: Number(((evenCount / total) * 100).toFixed(2)),
      odd_pct: Number(((oddCount / total) * 100).toFixed(2)),
      over_pct: Number(((overCount / total) * 100).toFixed(2)),
      under_pct: Number(((underCount / total) * 100).toFixed(2)),
      barrier: bar,
      current_even_streak: evenStreak,
      current_odd_streak: oddStreak,
      hottest_digit: hottest,
      coldest_digit: coldest,
      recent_digits: slice.slice(-30).map((t) => t.last_digit),
    };

    if (sym === state.symbol) {
      let regime = "MODERATE EDGE";
      if (confidence >= 72) regime = "HIGH STATISTICAL EDGE";
      else if (confidence < 56) regime = "RANDOM CHOP // FILTERED";

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
      };
    }

    return statsObj;
  }

  function renderMultiMarketScanner() {
    const ranked = ALL_SYMBOLS.map((sym) => ({
      sym,
      conf: marketBuffers[sym].confidence || 50,
      streak: Math.max(marketBuffers[sym].evenStreak, marketBuffers[sym].oddStreak),
    })).sort((a, b) => b.conf - a.conf);

    if (
      autoSwitchMarketToggle.checked &&
      ranked[0] &&
      ranked[0].conf >= 72 &&
      ranked[0].sym !== state.symbol &&
      Object.keys(state.liveOpenContracts).length === 0
    ) {
      state.symbol = ranked[0].sym;
      symbolSelect.value = state.symbol;
      subscribeOfficialSymbolCandles(state.symbol);
      subscribeLiveDerivProposals();
    }

    multiMarketScannerGrid.innerHTML = ranked
      .map((item) => {
        const isCurrent = item.sym === state.symbol;
        const isHot = item.conf >= 70;
        const borderClass = isCurrent
          ? "border-[#00c853] bg-[#00c853]/15 text-white"
          : isHot
          ? "border-[#2979ff]/50 bg-[#151a24] text-[#e6edf3]"
          : "border-[#1e2533] bg-[#0f131a] text-[#8b949e]";
        const confColor =
          item.conf >= 70
            ? "text-[#00c853]"
            : item.conf >= 60
            ? "text-[#ffab00]"
            : "text-[#8b949e]";
        return `
          <button data-scan-sym="${item.sym}" class="scanner-pill px-2 py-0.5 border ${borderClass} flex items-center gap-1.5 shrink-0 cursor-pointer hover:border-[#2979ff]">
            <span class="font-bold">${item.sym}</span>
            <span class="${confColor} font-bold">${item.conf.toFixed(0)}%</span>
            ${item.streak >= 3 ? `<span class="text-[9px] text-[#ffab00]">${item.streak}x</span>` : ""}
          </button>
        `;
      })
      .join("");

    document.querySelectorAll(".scanner-pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        const targetSym = pill.getAttribute("data-scan-sym");
        if (targetSym && targetSym !== state.symbol) {
          state.symbol = targetSym;
          symbolSelect.value = targetSym;
          subscribeOfficialSymbolCandles(state.symbol);
          subscribeLiveDerivProposals();
          const stats = computeSymbolStatsAndML(state.symbol);
          const ticks = marketBuffers[state.symbol].ticks;
          if (ticks.length) {
            updateTickBanner(ticks[ticks.length - 1]);
            updateDigitHeatmap(stats, ticks[ticks.length - 1].last_digit);
            renderMLTelemetry();
            drawChart();
          }
          renderMultiMarketScanner();
        }
      });
    });
  }

  // ============================================================================
  // 4. VIRTUAL LOSS FILTER ("SHADOW BOT") & CROSS-CONTRACT SMART RECOVERY
  // ============================================================================

  function updateShadowBadge() {
    const req = Number(virtualLossInput.value || 0);
    state.shadowBot.requiredLosses = req;
    if (req === 0) {
      shadowStatusBadge.textContent = "SHADOW FILTER: OFF (DIRECT)";
      shadowStatusBadge.className =
        "font-mono text-[10px] px-1.5 py-0.5 bg-[#151a24] border border-[#1e2533] text-[#8b949e]";
    } else if (state.shadowBot.currentShadowLosses >= req) {
      shadowStatusBadge.textContent = `SHADOW READY: ${state.shadowBot.currentShadowLosses}/${req} (ARMED FOR LIVE)`;
      shadowStatusBadge.className =
        "font-mono text-[10px] px-1.5 py-0.5 bg-[#00c853]/15 border border-[#00c853]/40 text-[#00c853] font-bold";
    } else {
      shadowStatusBadge.textContent = `SHADOW FILTER: ${state.shadowBot.currentShadowLosses}/${req} ABSORBED`;
      shadowStatusBadge.className =
        "font-mono text-[10px] px-1.5 py-0.5 bg-[#ffab00]/15 border border-[#ffab00]/40 text-[#ffab00]";
    }
  }

  function getSmartRecoveryOrder(defaultContract, defaultBarrier, stats) {
    if (
      state.risk.consecutive_losses === 0 ||
      state.risk.recovery_deficit <= 0 ||
      !crossContractRecoveryToggle.checked
    ) {
      return {
        contractType: defaultContract,
        barrier: defaultBarrier,
        stake: state.risk.base_stake,
        isRecovery: false,
      };
    }

    let recContract = "DIGITOVER";
    let recBarrier = 4;
    let estRatio = 1.38;

    if (stats.under_pct > stats.over_pct) {
      recContract = "DIGITUNDER";
      recBarrier = 5;
    }

    if (stats.current_odd_streak >= 4) {
      recContract = "DIGITEVEN";
      recBarrier = null;
      estRatio = 0.95;
    } else if (stats.current_even_streak >= 4) {
      recContract = "DIGITODD";
      recBarrier = null;
      estRatio = 0.95;
    }

    const targetGain = state.risk.recovery_deficit + state.risk.base_stake * 0.5;
    const calculatedStake = Math.max(0.35, Number((targetGain / estRatio).toFixed(2)));

    return {
      contractType: recContract,
      barrier: recBarrier,
      stake: calculatedStake,
      isRecovery: true,
    };
  }

  // ============================================================================
  // 5. UI RENDERING (DIGIT MATRIX, BANNER, CHART, TRADE BLOTTER)
  // ============================================================================

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
    updateShadowBadge();
  }

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

    const buf = marketBuffers[state.symbol];
    if (buf && buf.ema8 !== null && buf.ema21 !== null) {
      const trend = buf.ema8 > buf.ema21 ? "BULL" : "BEAR";
      microTrendBadge.textContent = `${trend} // RSI ${buf.rsi7.toFixed(0)}`;
      microTrendBadge.className =
        trend === "BULL"
          ? "text-xs text-[#00c853] font-bold tabular-nums"
          : "text-xs text-[#ff3d57] font-bold tabular-nums";
    }
  }

  function updateConnectionHeader(connected, authorized, account, symbol) {
    state.connectedToDeriv = connected;
    state.authorized = authorized;
    if (symbol && symbolSelect.value !== symbol) {
      symbolSelect.value = symbol;
    }

    if (connected) {
      wsDot.className = "inline-block w-2 h-2 bg-[#00c853]";
      connBadge.textContent = authorized
        ? `LIVE DERIV (${account.loginid})`
        : "LIVE DERIV FEED (GUEST)";
      connBadge.className =
        "font-mono text-[10px] px-1.5 py-0.5 bg-[#00c853]/15 border border-[#00c853]/40 text-[#00c853]";
    } else {
      wsDot.className = "inline-block w-2 h-2 bg-[#ffab00]";
      connBadge.textContent = "RECONNECTING TO DERIV...";
      connBadge.className =
        "font-mono text-[10px] px-1.5 py-0.5 bg-[#ffab00]/15 border border-[#ffab00]/40 text-[#ffab00]";
    }

    if (account) {
      const loginid = account.loginid || "GUEST";
      accountLoginId.textContent = loginid;
      userEmailLabel.textContent = account.email || (authorized ? loginid : "Not Signed In");

      const bal = Number(account.balance || 0);
      const cur = account.currency || "USD";
      accountBalance.textContent = `${cur === "USD" ? "$" : cur + " "}${bal.toLocaleString(
        "en-US",
        {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }
      )}`;

      orderTicketModeLabel.textContent = authorized
        ? `DIRECT DERIV FILL (${loginid})`
        : "SIGN IN TO EXECUTE";
      orderTicketModeLabel.className = authorized
        ? "font-mono text-[10px] text-[#00c853] font-bold"
        : "font-mono text-[10px] text-[#ffab00]";

      if (!authorized || loginid === "GUEST") {
        accountTypeTag.textContent = "GUEST";
        accountTypeTag.className =
          "text-[9px] font-mono font-bold px-1 bg-[#ffab00]/15 text-[#ffab00] border border-[#ffab00]/30";
      } else if (account.is_virtual || loginid.startsWith("VRTC")) {
        accountTypeTag.textContent = "DEMO LIVE";
        accountTypeTag.className =
          "text-[9px] font-mono font-bold px-1 bg-[#2979ff]/15 text-[#2979ff] border border-[#2979ff]/30";
      } else {
        accountTypeTag.textContent = "REAL LIVE";
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
        botStateBadge.textContent = "ACTIVE // LIVE DERIV BOT";
        botStateBadge.className =
          "font-mono text-[10px] px-2 py-0.5 bg-[#00c853]/15 text-[#00c853] border border-[#00c853]/40 font-bold";
        toggleBotBtn.textContent = "DISENGAGE LIVE AUTOMATED ML BOT";
        toggleBotBtn.className =
          "terminal-btn w-full py-2.5 bg-[#ff3d57] hover:bg-[#e0324a] text-white font-bold text-xs";
      } else {
        botStateBadge.textContent = "STANDBY";
        botStateBadge.className =
          "font-mono text-[10px] px-2 py-0.5 bg-[#151a24] text-[#8b949e] border border-[#1e2533]";
        toggleBotBtn.textContent = "ENGAGE LIVE AUTOMATED ML BOT";
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
            No contracts loaded yet. Sign in with your Deriv account to pull your live <code class="font-mono">profit_table</code> and execute contracts.
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
            ? "LIVE OPEN"
            : `${t.profit >= 0 ? "+" : ""}$${Number(t.profit).toFixed(2)}`;
        const profitColor =
          t.profit > 0
            ? "text-[#00c853]"
            : t.profit < 0
            ? "text-[#ff3d57]"
            : "text-[#8b949e]";
        const barrierText =
          t.barrier !== null && t.barrier !== undefined ? ` [${t.barrier}]` : "";

        return `
          <tr class="hover:bg-[#151a24]/60">
            <td class="py-1.5 px-2.5 text-[#8b949e]">${t.id}</td>
            <td class="py-1.5 px-2 font-bold text-white">${t.symbol} // ${t.contract_type}${barrierText}</td>
            <td class="py-1.5 px-2">${t.entry_digit ?? t.entry_quote ?? "-"} &rarr; ${t.exit_digit ?? t.exit_quote ?? "-"}</td>
            <td class="py-1.5 px-2">$${Number(t.stake).toFixed(2)}</td>
            <td class="py-1.5 px-2">
              <span class="px-1.5 py-0.5 border text-[9px] font-bold ${badgeColor}">${t.status}</span>
            </td>
            <td class="py-1.5 px-2 font-bold ${profitColor}">${profitStr}</td>
            <td class="py-1.5 px-2.5 font-sans text-[#8b949e] truncate max-w-[260px]" title="${t.reason}">${t.reason}</td>
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

    ctx.strokeStyle = "#141923";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const gy = (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }

    const buf = marketBuffers[state.symbol];
    if (!buf) return;

    if (state.chartMode === "ticks") {
      const pts = buf.ticks.slice(-60);
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
      const candles = buf.candles.slice(-40);
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
  // 6. DIRECT LIVE DERIV ORDER EXECUTION & CONTRACT SETTLEMENT
  // ============================================================================

  function extractLastDigitClient(quote, pipSize) {
    const formatted = Number(quote).toFixed(pipSize);
    const lastChar = formatted.charAt(formatted.length - 1);
    return { formatted, lastDigit: parseInt(lastChar, 10) || 0 };
  }

  function evaluateClientContract(contractType, entryQuote, exitQuote, exitDigit, barrier) {
    const b = barrier ?? 2;
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
      state.risk.recovery_deficit = Math.max(
        0,
        Number((state.risk.recovery_deficit - t.profit).toFixed(2))
      );
      state.risk.current_stake = state.risk.base_stake;
      state.shadowBot.currentShadowLosses = 0;
    } else {
      t.profit = Number(profitAmount.toFixed(2));
      t.payout = 0;
      t.status = "LOST";
      state.risk.losses++;
      state.risk.consecutive_losses++;
      state.risk.recovery_deficit = Number(
        (state.risk.recovery_deficit + Math.abs(t.profit)).toFixed(2)
      );
      state.cooldownTicks = 2;

      if (state.risk.use_martingale && !crossContractRecoveryToggle.checked) {
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

    if (state.risk.total_profit > state.risk.peak_profit) {
      state.risk.peak_profit = state.risk.total_profit;
      if (
        state.risk.use_profit_lock &&
        state.risk.peak_profit >= state.risk.base_stake * 3
      ) {
        state.risk.profit_floor = Number((state.risk.peak_profit * 0.5).toFixed(2));
      }
    }

    updateShadowBadge();
    updateRiskAndBotUI(state.risk, state.strategyConfig);
    updateConnectionHeader(state.connectedToDeriv, state.authorized, state.account, state.symbol);
    renderTradesTable();
  }

  function executeLiveDerivContract(
    contractType,
    barrier,
    durationTicks,
    reason,
    overrideStake = null
  ) {
    if (!state.authorized || !directDerivWS) {
      loginGateOverlay.classList.remove("hidden");
      return;
    }

    const symTicks = marketBuffers[state.symbol].ticks;
    const lastTick = symTicks[symTicks.length - 1];
    if (!lastTick) return;

    const stake = Math.max(
      0.35,
      Number((overrideStake !== null ? overrideStake : state.risk.current_stake).toFixed(2))
    );
    const needsBarrier = ["DIGITOVER", "DIGITUNDER", "DIGITMATCH", "DIGITDIFF"].includes(
      contractType
    );
    const cleanBarrier = needsBarrier ? (barrier ?? state.barrier) : null;

    const trade = {
      id: `PENDING-${Math.random().toString(16).slice(2, 6).toUpperCase()}`,
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
      reason,
    };

    state.trades.unshift(trade);
    renderTradesTable();

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

  function dispatchWithShadowFilter(contractType, barrier, durationTicks, reason, stats) {
    const reqVirtual = Number(virtualLossInput.value || 0);
    if (reqVirtual > 0 && state.shadowBot.currentShadowLosses < reqVirtual) {
      const symTicks = marketBuffers[state.symbol].ticks;
      const lastTick = symTicks[symTicks.length - 1];
      if (!lastTick || state.shadowBot.pendingVirtualTrade) return;

      state.shadowBot.pendingVirtualTrade = {
        symbol: state.symbol,
        contract_type: contractType,
        barrier,
        entry_quote: lastTick.quote,
        remaining: durationTicks,
      };
      return;
    }

    const rec = getSmartRecoveryOrder(contractType, barrier, stats);
    const finalReason = rec.isRecovery
      ? `[SMART RECOVERY $${rec.stake}] ${rec.contractType} ${rec.barrier ?? ""} // ${reason}`
      : reason;

    state.shadowBot.currentShadowLosses = 0;
    updateShadowBadge();
    executeLiveDerivContract(
      rec.contractType,
      rec.barrier,
      durationTicks,
      finalReason,
      rec.stake
    );
  }

  function evaluateAutomatedStrategy(tick, stats) {
    if (!state.strategyConfig.enabled || !stats || !state.authorized) return;
    if (
      Object.keys(state.liveOpenContracts).length > 0 ||
      state.shadowBot.pendingVirtualTrade !== null
    ) {
      return;
    }
    if (stats.total_ticks < 20) return;

    if (state.cooldownTicks > 0) {
      state.cooldownTicks--;
      return;
    }

    if (state.risk.total_profit >= state.risk.take_profit) {
      state.risk.halt_reason = `SESSION TAKE PROFIT REACHED (+$${state.risk.total_profit.toFixed(2)})`;
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
    const buf = marketBuffers[state.symbol];

    if (st === "ML_ADAPTIVE_EDGE") {
      if (ml.confidence >= minMl) {
        dispatchWithShadowFilter(
          ml.optimalContract,
          ml.optimalBarrier,
          dur,
          `ML ${ml.confidence}% // ${ml.optimalReason}`,
          stats
        );
      }
    } else if (st === "SMALL_ACCT_SURVIVAL") {
      const recent2 = stats.recent_digits.slice(-2);
      if (recent2.length === 2 && recent2.every((d) => d <= 1) && ml.confidence >= 60) {
        dispatchWithShadowFilter(
          "DIGITOVER",
          1,
          dur,
          `Small-Acct Compounder: 2x Low Digits [0-1] -> OVER 1`,
          stats
        );
      } else if (recent2.length === 2 && recent2.every((d) => d >= 8) && ml.confidence >= 60) {
        dispatchWithShadowFilter(
          "DIGITUNDER",
          8,
          dur,
          `Small-Acct Compounder: 2x High Digits [8-9] -> UNDER 8`,
          stats
        );
      }
    } else if (st === "RISE_FALL_CONFLUENCE") {
      if (buf.ema8 !== null && buf.ema21 !== null) {
        if (buf.ema8 > buf.ema21 && buf.rsi7 < 36 && buf.velocity > 0) {
          dispatchWithShadowFilter(
            "CALL",
            null,
            Math.max(5, dur),
            `EMA8>EMA21 + RSI(${buf.rsi7}) Pullback + Velocity -> CALL`,
            stats
          );
        } else if (buf.ema8 < buf.ema21 && buf.rsi7 > 64 && buf.velocity < 0) {
          dispatchWithShadowFilter(
            "PUT",
            null,
            Math.max(5, dur),
            `EMA8<EMA21 + RSI(${buf.rsi7}) Spike + Velocity -> PUT`,
            stats
          );
        }
      }
    } else if (st === "EVEN_ODD_STREAK") {
      if (stats.current_odd_streak >= threshold) {
        dispatchWithShadowFilter(
          "DIGITEVEN",
          null,
          dur,
          `Odd streak ${stats.current_odd_streak}x -> DIGITEVEN`,
          stats
        );
      } else if (stats.current_even_streak >= threshold) {
        dispatchWithShadowFilter(
          "DIGITODD",
          null,
          dur,
          `Even streak ${stats.current_even_streak}x -> DIGITODD`,
          stats
        );
      }
    } else if (st === "OVER_UNDER_EDGE") {
      const tail = stats.recent_digits.slice(-threshold);
      if (tail.length >= threshold) {
        if (tail.every((d) => d <= bar) && stats.over_pct >= 40) {
          dispatchWithShadowFilter(
            "DIGITOVER",
            bar,
            dur,
            `${threshold} ticks <= ${bar} -> DIGITOVER ${bar}`,
            stats
          );
        } else if (tail.every((d) => d >= bar) && stats.under_pct >= 40) {
          dispatchWithShadowFilter(
            "DIGITUNDER",
            bar,
            dur,
            `${threshold} ticks >= ${bar} -> DIGITUNDER ${bar}`,
            stats
          );
        }
      }
    } else if (st === "MATCH_DIFF_COLD") {
      const coldest = stats.coldest_digit;
      const coldPct = stats.percentages[coldest] ?? 10;
      if (tick.last_digit === coldest && coldPct <= 8.0) {
        dispatchWithShadowFilter(
          "DIGITDIFF",
          coldest,
          dur,
          `Coldest digit ${coldest} (${coldPct}%) -> DIGITDIFF ${coldest}`,
          stats
        );
      }
    }
  }

  function processIncomingTick(sym, quote, epoch, pipSize, isHistorical = false) {
    const buf = marketBuffers[sym];
    if (!buf) return;

    const { formatted, lastDigit } = extractLastDigitClient(quote, pipSize);
    const tick = {
      symbol: sym,
      epoch,
      quote: Number(quote),
      formatted_quote: formatted,
      pip_size: pipSize,
      last_digit: lastDigit,
    };

    buf.ticks.push(tick);
    if (buf.ticks.length > 400) buf.ticks.shift();

    updateSymbolMicrostructure(sym, tick.quote);

    if (isHistorical) return;

    const stats = computeSymbolStatsAndML(sym);

    if (
      state.shadowBot.pendingVirtualTrade &&
      state.shadowBot.pendingVirtualTrade.symbol === sym
    ) {
      const vt = state.shadowBot.pendingVirtualTrade;
      vt.remaining--;
      if (vt.remaining <= 0) {
        const vWon = evaluateClientContract(
          vt.contract_type,
          vt.entry_quote,
          tick.quote,
          tick.last_digit,
          vt.barrier
        );
        if (!vWon) {
          state.shadowBot.currentShadowLosses++;
        } else {
          state.shadowBot.currentShadowLosses = 0;
        }
        state.shadowBot.pendingVirtualTrade = null;
        updateShadowBadge();
      }
    }

    if (sym === state.symbol) {
      evaluateAutomatedStrategy(tick, stats);
      updateTickBanner(tick);
      updateDigitHeatmap(stats, tick.last_digit);
      renderMLTelemetry();
      updateRiskAndBotUI(state.risk, state.strategyConfig);
      updateConnectionHeader(
        state.connectedToDeriv,
        state.authorized,
        state.account,
        state.symbol
      );
      drawChart();
      renderMultiMarketScanner();
    }
  }

  // ============================================================================
  // 7. DERIV WEBSOCKET CONNECTION (DIRECT ACCOUNT + MARKET + PROPOSAL + CANDLES)
  // ============================================================================

  function connectDerivWebSocket() {
    if (directDerivWS) {
      try {
        directDerivWS.onclose = null;
        directDerivWS.close();
      } catch (_) {}
    }
    if (pingTimer) clearInterval(pingTimer);

    state.authorized = false;
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

      // 1. Subscribe to all 10 Volatility indices live tick streams
      ALL_SYMBOLS.forEach((sym) => {
        directDerivWS.send(
          JSON.stringify({
            ticks_history: sym,
            adjust_start_time: 1,
            count: 100,
            end: "latest",
            style: "ticks",
            subscribe: 1,
            passthrough: { symbol: sym },
          })
        );
      });

      // 2. Subscribe to official Deriv 1m OHLC candles for active symbol
      subscribeOfficialSymbolCandles(state.symbol);

      // 3. Subscribe to live Deriv payout proposals for active symbol
      subscribeLiveDerivProposals();

      pingTimer = setInterval(() => {
        if (directDerivWS && directDerivWS.readyState === WebSocket.OPEN) {
          directDerivWS.send(JSON.stringify({ ping: 1 }));
        }
      }, 25000);
    };

    directDerivWS.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.error) {
        if (msg.msg_type === "authorize") {
          gateErrorBox.textContent = `Deriv Login Error: ${msg.error.message}`;
          gateErrorBox.classList.remove("hidden");
        } else if (msg.msg_type === "app_register") {
          const stEl = document.getElementById("appRegisterStatus");
          stEl.textContent = `Error: ${msg.error.message}`;
          stEl.className = "text-[11px] font-mono text-[#ff3d57] pt-1";
          stEl.classList.remove("hidden");
        } else if (msg.msg_type !== "proposal") {
          haltAlertBox.textContent = `DERIV API // ${msg.error.message}`;
          haltAlertBox.classList.remove("hidden");
        }
        return;
      }

      // A. User Authenticated -> Unlock Login Gate & Pull All Live Account Data
      if (msg.msg_type === "authorize" && msg.authorize) {
        state.authorized = true;
        gateErrorBox.classList.add("hidden");
        loginGateOverlay.classList.add("hidden");

        state.account = {
          loginid: msg.authorize.loginid || "DERIV",
          email: msg.authorize.email || "",
          currency: msg.authorize.currency || "USD",
          balance: Number(msg.authorize.balance || 0),
          is_virtual: Boolean(msg.authorize.is_virtual),
        };

        // Import user's full Deriv account_list if not already populated via OAuth
        if (Array.isArray(msg.authorize.account_list) && state.savedAccounts.length === 0) {
          state.savedAccounts = msg.authorize.account_list.map((acc) => ({
            acct: acc.loginid,
            token: acc.loginid === state.account.loginid ? state.apiToken : "",
            cur: acc.currency || "USD",
          }));
        }

        renderAccountSwitcher();
        updateConnectionHeader(true, true, state.account, state.symbol);
        syncDerivAccountData();
        subscribeLiveDerivProposals();
      }

      // B. Live Deriv Account Balance Stream
      else if (msg.msg_type === "balance" && msg.balance) {
        state.account.balance = Number(msg.balance.balance ?? state.account.balance);
        if (msg.balance.currency) state.account.currency = msg.balance.currency;
        updateConnectionHeader(true, state.authorized, state.account, state.symbol);
      }

      // C. Direct Deriv Profit Table (User's Real Past Contracts from Deriv)
      else if (msg.msg_type === "profit_table" && msg.profit_table) {
        const transactions = msg.profit_table.transactions || [];
        const historical = transactions.map((tx) => {
          const buyP = Number(tx.buy_price || 0);
          const sellP = Number(tx.sell_price || 0);
          const netPnl = Number((sellP - buyP).toFixed(2));
          return {
            id: String(tx.contract_id || tx.transaction_id),
            timestamp: Number(tx.purchase_time || 0),
            symbol: tx.shortcode ? tx.shortcode.split("_")[1] || state.symbol : state.symbol,
            contract_type: tx.shortcode ? tx.shortcode.split("_")[0] : "CONTRACT",
            barrier: null,
            stake: buyP,
            entry_digit: "-",
            exit_digit: "-",
            status: netPnl > 0 ? "WON" : "LOST",
            payout: sellP,
            profit: netPnl,
            reason: tx.longcode || "Synced from Deriv profit_table",
          };
        });

        // Merge with any currently open live contracts
        const openOnes = Object.values(state.liveOpenContracts);
        state.trades = [...openOnes, ...historical];
        renderTradesTable();
      }

      // D. Live Portfolio Open Contracts
      else if (msg.msg_type === "portfolio" && msg.portfolio) {
        const contracts = msg.portfolio.contracts || [];
        contracts.forEach((c) => {
          directDerivWS.send(
            JSON.stringify({
              proposal_open_contract: 1,
              contract_id: c.contract_id,
              subscribe: 1,
            })
          );
        });
      }

      // E. Live Deriv Payout Proposals (Updates Order Ticket Buttons)
      else if (msg.msg_type === "proposal" && msg.proposal) {
        const ct = msg.passthrough && msg.passthrough.contract_type;
        const ask = Number(msg.proposal.ask_price || state.risk.current_stake);
        const payout = Number(msg.proposal.payout || 0);
        if (ct && ask > 0 && payout > 0) {
          const netPct = Number((((payout - ask) / ask) * 100).toFixed(1));
          state.liveProposals[ct] = {
            id: msg.proposal.id,
            ask_price: ask,
            payout,
            net_pct: netPct,
          };
          const el = document.getElementById(`prop-${ct}`);
          if (el) {
            el.textContent = `+$${(payout - ask).toFixed(2)} (+${netPct}%)`;
            el.className = "text-[9px] text-[#00c853] font-bold";
          }
        }
      }

      // F. Official Deriv 1m OHLC Server Candles
      else if (msg.msg_type === "candles" && msg.candles) {
        const sym = (msg.passthrough && msg.passthrough.candle_symbol) || state.symbol;
        const buf = marketBuffers[sym];
        if (buf) {
          buf.candles = msg.candles.map((c) => ({
            symbol: sym,
            timeframe_sec: 60,
            open_time: Number(c.epoch),
            open: Number(c.open),
            high: Number(c.high),
            low: Number(c.low),
            close: Number(c.close),
          }));
          if (sym === state.symbol) drawChart();
        }
      } else if (msg.msg_type === "ohlc" && msg.ohlc) {
        const o = msg.ohlc;
        const sym = o.symbol || state.symbol;
        const buf = marketBuffers[sym];
        if (buf) {
          const openTime = Number(o.open_time);
          const candle = {
            symbol: sym,
            timeframe_sec: 60,
            open_time: openTime,
            open: Number(o.open),
            high: Number(o.high),
            low: Number(o.low),
            close: Number(o.close),
          };
          const last = buf.candles[buf.candles.length - 1];
          if (last && last.open_time === openTime) {
            buf.candles[buf.candles.length - 1] = candle;
          } else {
            buf.candles.push(candle);
            if (buf.candles.length > 100) buf.candles.shift();
          }
          if (sym === state.symbol && state.chartMode === "candles") drawChart();
        }
      }

      // G. Historical Ticks & Live Tick Stream
      else if (msg.msg_type === "history" && msg.history) {
        const sym =
          (msg.passthrough && msg.passthrough.symbol) ||
          (msg.echo_req && msg.echo_req.ticks_history) ||
          state.symbol;
        const pipSize = msg.pip_size !== undefined ? Number(msg.pip_size) : PIP_SIZES[sym] || 2;
        const prices = msg.history.prices || [];
        const times = msg.history.times || [];
        marketBuffers[sym].ticks = [];
        for (let i = 0; i < prices.length; i++) {
          processIncomingTick(
            sym,
            Number(prices[i]),
            Number(times[i]),
            pipSize,
            i < prices.length - 1
          );
        }
      } else if (msg.msg_type === "tick" && msg.tick) {
        const sym = msg.tick.symbol || state.symbol;
        const pipSize =
          msg.tick.pip_size !== undefined ? Number(msg.tick.pip_size) : PIP_SIZES[sym] || 2;
        processIncomingTick(sym, Number(msg.tick.quote), Number(msg.tick.epoch), pipSize, false);
      }

      // H. Live Buy Execution & Open Contract Settlement
      else if (msg.msg_type === "buy" && msg.buy) {
        const contractId = msg.buy.contract_id;
        const tradeId = msg.passthrough && msg.passthrough.trade_id;
        if (tradeId && state.liveOpenContracts[tradeId]) {
          state.liveOpenContracts[tradeId].id = String(contractId);
          renderTradesTable();
        }
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
            const pipSz = PIP_SIZES[t.symbol] || 2;
            const { lastDigit } = extractLastDigitClient(exitQuote, pipSz);
            t.exit_quote = exitQuote;
            t.exit_digit = lastDigit;
            recordCompletedTradeOutcome(t, profit > 0, profit, sellPrice);
          }
        }
      }

      // I. Automatic OAuth App Registration Response
      else if (msg.msg_type === "app_register" && msg.app_register) {
        const newAppId = String(msg.app_register.app_id);
        state.appId = newAppId;
        localStorage.setItem(STORAGE_KEYS.APP_ID, newAppId);
        document.getElementById("appIdInput").value = newAppId;
        gateCurrentAppId.textContent = newAppId;
        const stEl = document.getElementById("appRegisterStatus");
        stEl.textContent = `Success! Dedicated OAuth App ID ${newAppId} created and saved for ${window.location.origin}.`;
        stEl.className = "text-[11px] font-mono text-[#00c853] pt-1";
        stEl.classList.remove("hidden");
      }
    };

    directDerivWS.onclose = () => {
      state.connectedToDeriv = false;
      updateConnectionHeader(false, false, state.account, state.symbol);
      setTimeout(connectDerivWebSocket, 3000);
    };
  }

  // ============================================================================
  // 8. EVENT LISTENERS & CONTROLS
  // ============================================================================

  // Login Gate Overlay Controls
  popupTokenPageBtn.addEventListener("click", () => {
    window.open(
      "https://app.deriv.com/account/api-token",
      "DerivTokenWindow",
      "width=980,height=720,menubar=no,toolbar=no,location=yes"
    );
  });

  gateLoginBtn.addEventListener("click", () => {
    const token = (gateTokenInput.value || "").trim();
    if (!token) {
      gateErrorBox.textContent = "Please paste a valid Deriv API Token.";
      gateErrorBox.classList.remove("hidden");
      return;
    }
    state.apiToken = token;
    localStorage.setItem(STORAGE_KEYS.ACTIVE_TOKEN, token);
    gateErrorBox.classList.add("hidden");
    if (directDerivWS && directDerivWS.readyState === WebSocket.OPEN) {
      directDerivWS.send(JSON.stringify({ authorize: token }));
    } else {
      connectDerivWebSocket();
    }
  });

  gateOAuthBtn.addEventListener("click", triggerDerivOAuthLogin);

  gateGuestPreviewBtn.addEventListener("click", () => {
    state.guestModeDismissed = true;
    loginGateOverlay.classList.add("hidden");
  });

  reopenLoginGateBtn.addEventListener("click", () => {
    loginGateOverlay.classList.remove("hidden");
  });

  quickConnectBtn.addEventListener("click", () => {
    const token = (quickTokenInput.value || "").trim();
    if (!token) return;
    state.apiToken = token;
    localStorage.setItem(STORAGE_KEYS.ACTIVE_TOKEN, token);
    haltAlertBox.classList.add("hidden");
    renderAccountSwitcher();
    connectDerivWebSocket();
  });

  syncDerivHistoryBtn.addEventListener("click", () => {
    if (!state.authorized) {
      loginGateOverlay.classList.remove("hidden");
      return;
    }
    syncDerivAccountData();
    subscribeLiveDerivProposals();
  });

  symbolSelect.addEventListener("change", () => {
    state.symbol = symbolSelect.value;
    subscribeOfficialSymbolCandles(state.symbol);
    subscribeLiveDerivProposals();
    const stats = computeSymbolStatsAndML(state.symbol);
    const ticks = marketBuffers[state.symbol].ticks;
    if (ticks.length) {
      updateTickBanner(ticks[ticks.length - 1]);
      updateDigitHeatmap(stats, ticks[ticks.length - 1].last_digit);
      renderMLTelemetry();
      drawChart();
    }
    renderMultiMarketScanner();
  });

  barrierInput.addEventListener("change", () => {
    state.barrier = Number(barrierInput.value || 2);
    subscribeLiveDerivProposals();
  });

  durationTicksInput.addEventListener("change", () => {
    subscribeLiveDerivProposals();
  });

  accountSwitcherSelect.addEventListener("change", () => {
    const val = accountSwitcherSelect.value;
    if (val === "GUEST") {
      loginGateOverlay.classList.remove("hidden");
      return;
    }
    if (val && val !== state.account.loginid) {
      state.apiToken = val;
      localStorage.setItem(STORAGE_KEYS.ACTIVE_TOKEN, val);
      connectDerivWebSocket();
    }
  });

  logoutDerivBtn.addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEYS.ACCOUNTS);
    localStorage.removeItem(STORAGE_KEYS.ACTIVE_TOKEN);
    state.savedAccounts = [];
    state.apiToken = "";
    state.authorized = false;
    state.trades = [];
    state.account = {
      loginid: "GUEST",
      email: "",
      currency: "USD",
      balance: 0.0,
      is_virtual: false,
    };
    renderAccountSwitcher();
    renderTradesTable();
    loginGateOverlay.classList.remove("hidden");
    connectDerivWebSocket();
  });

  document.getElementById("autoRegisterAppIdBtn").addEventListener("click", () => {
    if (!directDerivWS || directDerivWS.readyState !== WebSocket.OPEN || !state.authorized) {
      const stEl = document.getElementById("appRegisterStatus");
      stEl.textContent = "Authorize with an Admin-scoped Deriv API token first.";
      stEl.className = "text-[11px] font-mono text-[#ffab00] pt-1";
      stEl.classList.remove("hidden");
      return;
    }
    const redirectUri = window.location.origin + window.location.pathname;
    directDerivWS.send(
      JSON.stringify({
        app_register: "Deriv ProDesk Terminal",
        scopes: ["read", "trade", "trading_information", "payments"],
        redirect_uri: redirectUri,
        verification_uri: redirectUri,
      })
    );
  });

  // Small-Account Presets
  document.querySelectorAll(".account-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cap = Number(btn.getAttribute("data-preset"));
      const stake = Math.max(0.35, Number((cap * 0.03).toFixed(2)));
      const tp = Number((cap * 0.12).toFixed(2));
      const sl = Number((cap * 0.15).toFixed(2));

      baseStakeInput.value = stake;
      takeProfitInput.value = tp;
      stopLossInput.value = sl;
      maxLossStreakInput.value = 4;
      virtualLossInput.value = 1;
      crossContractRecoveryToggle.checked = true;
      useMartingaleToggle.checked = true;
      martingaleMultInput.value = 1.45;
      useProfitLockToggle.checked = true;
      strategySelect.value = "ML_ADAPTIVE_EDGE";

      state.risk.base_stake = stake;
      state.risk.current_stake = stake;
      state.risk.take_profit = tp;
      state.risk.stop_loss = sl;
      state.risk.max_consecutive_losses = 4;
      state.risk.cross_contract_recovery = true;
      state.risk.use_martingale = true;
      state.risk.martingale_multiplier = 1.45;
      state.risk.use_profit_lock = true;
      state.risk.halt_reason = null;

      updateShadowBadge();
      updateRiskAndBotUI(state.risk, state.strategyConfig);
      subscribeLiveDerivProposals();
    });
  });

  toggleBotBtn.addEventListener("click", () => {
    if (!state.authorized) {
      loginGateOverlay.classList.remove("hidden");
      return;
    }
    const nextEnabled = !state.botEnabled;
    state.barrier = Number(barrierInput.value || 2);
    state.windowSize = Number(document.getElementById("windowSizeInput").value || 100);

    state.strategyConfig = {
      enabled: nextEnabled,
      strategy_type: strategySelect.value,
      symbol: symbolSelect.value,
      contract_type: "DIGITOVER",
      duration_ticks: Number(durationTicksInput.value || 1),
      barrier: state.barrier,
      streak_threshold: Number(streakThresholdInput.value || 4),
      ml_threshold: Number(mlThresholdInput.value || 68),
      virtual_losses_required: Number(virtualLossInput.value || 1),
      window_size: state.windowSize,
    };
    if (nextEnabled) {
      state.risk.halt_reason = null;
      state.shadowBot.currentShadowLosses = 0;
    }
    updateShadowBadge();
    updateRiskAndBotUI(state.risk, state.strategyConfig);
  });

  document.querySelectorAll(".manual-trade-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const contractType = btn.getAttribute("data-contract");
      const dur = Number(durationTicksInput.value || 1);
      const bar = Number(barrierInput.value || 2);
      executeLiveDerivContract(contractType, bar, dur, "Direct 1-Click Live Order Ticket");
    });
  });

  saveRiskBtn.addEventListener("click", () => {
    state.risk.base_stake = Math.max(0.35, Number(baseStakeInput.value || 0.35));
    state.risk.take_profit = Number(takeProfitInput.value || 1.5);
    state.risk.stop_loss = Number(stopLossInput.value || 2.0);
    state.risk.max_consecutive_losses = Number(maxLossStreakInput.value || 4);
    state.risk.cross_contract_recovery = crossContractRecoveryToggle.checked;
    state.risk.use_martingale = useMartingaleToggle.checked;
    state.risk.martingale_multiplier = Number(martingaleMultInput.value || 1.45);
    state.risk.use_profit_lock = useProfitLockToggle.checked;
    if (state.risk.consecutive_losses === 0) {
      state.risk.current_stake = state.risk.base_stake;
    }
    state.risk.halt_reason = null;
    updateShadowBadge();
    updateRiskAndBotUI(state.risk, state.strategyConfig);
    subscribeLiveDerivProposals();
  });

  resetSessionBtn.addEventListener("click", () => {
    state.risk.current_stake = state.risk.base_stake;
    state.risk.consecutive_losses = 0;
    state.risk.recovery_deficit = 0;
    state.risk.total_profit = 0;
    state.risk.peak_profit = 0;
    state.risk.profit_floor = 0;
    state.risk.total_trades = 0;
    state.risk.wins = 0;
    state.risk.losses = 0;
    state.risk.win_rate = 0;
    state.risk.halt_reason = null;
    state.shadowBot.currentShadowLosses = 0;
    state.shadowBot.pendingVirtualTrade = null;
    updateShadowBadge();
    updateRiskAndBotUI(state.risk, state.strategyConfig);
    if (state.authorized) {
      syncDerivAccountData();
    }
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
    state.barrier = Number(barrierInput.value || 2);

    localStorage.setItem(STORAGE_KEYS.APP_ID, state.appId);
    gateCurrentAppId.textContent = state.appId;
    if (state.apiToken) {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_TOKEN, state.apiToken);
    } else {
      localStorage.removeItem(STORAGE_KEYS.ACTIVE_TOKEN);
    }
    haltAlertBox.classList.add("hidden");
    renderAccountSwitcher();
    connectDerivWebSocket();
    closeModal();
  });

  window.addEventListener("resize", drawChart);

  initDigitGrid();
  parseDerivOAuthRedirect();
  updateShadowBadge();
  connectDerivWebSocket();
})();
