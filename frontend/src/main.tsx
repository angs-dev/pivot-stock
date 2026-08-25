import React from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  GripVertical,
  LayoutDashboard,
  Play,
  RefreshCcw,
  RotateCcw,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  XCircle
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import "./styles.css";

type Category = "BUY" | "WATCH" | "REJECTED";
type DashboardWidgetId = "scan" | "settings" | "opportunities" | "workspace" | "testing";
type UniverseKey = "nifty200" | "nse-equity";
type ScanScope = "nse" | "nifty200";

interface Condition {
  key: string;
  label: string;
  passed: boolean;
  message?: string | null;
}

interface ScanResult {
  id: number;
  stockSymbol: string;
  companyName: string;
  sector?: string | null;
  category: Category;
  score: number;
  close?: number | null;
  vwap?: number | null;
  ema20?: number | null;
  ema200?: number | null;
  previousHigh?: number | null;
  pivot?: number | null;
  r1?: number | null;
  volumeRatio?: number | null;
  breakoutLevel?: number | null;
  breakoutType?: string | null;
  signalTime?: string | null;
  entry?: number | null;
  quantity?: number | null;
  target2?: number | null;
  stopLoss?: number | null;
  profitTarget2Gross?: number | null;
  maxLossGross?: number | null;
  netProfitTarget2?: number | null;
  distanceBreakout?: number | null;
  reasons: string[];
  pending: string[];
  conditions?: Condition[];
}

interface ScanRun {
  id: number;
  status: string;
  startedAt: string;
  endedAt?: string | null;
  totalStocks: number;
  completedStocks: number;
  failedStocks: number;
  provider: string;
  results: ScanResult[];
  topThree: ScanResult[];
}

interface JobProgress {
  runId?: number;
  status: "idle" | "running" | "completed" | "failed";
  total: number;
  completed: number;
  failed?: number;
  missing?: number;
  message: string;
}

interface StatusPayload {
  market: {
    isOpen: boolean;
    status: string;
    istTime: string;
  };
  provider: string;
  delayed: boolean;
  lastSuccessfulDataUpdate?: string | null;
}

interface BacktestRun {
  id: number;
  status: string;
  startDate: string;
  endDate: string;
  symbolsRequested: number;
  symbolsTested: number;
  missingSymbols: string[];
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  grossProfit: number;
  totalCharges: number;
  netProfit: number;
  averageProfit: number;
  averageReturn: number;
  maxDrawdown: number;
  profitFactor: number;
  targetHitCount: number;
  stopLossHitCount: number;
  timeExitCount: number;
  monthlyPerformance: Array<{ month: string; profit: number }>;
  symbolPerformance: Array<{ symbol: string; trades: number; netProfit: number; winRate: number }>;
  equityCurve: Array<{ date: string; equity: number }>;
  trades: BacktestTrade[];
}

interface BacktestTrade {
  id: number;
  symbol: string;
  signalTime: string;
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  target: number;
  stopLoss: number;
  exitReason: string;
  grossProfit: number;
  charges: number;
  netProfit: number;
  returnPct: number;
  score: number;
  breakoutType?: string | null;
  breakoutLevel?: number | null;
}

interface PaperTrade {
  id: number;
  symbol: string;
  companyName?: string;
  status: "OPEN" | "CLOSED";
  entryPrice: number;
  quantity: number;
  target: number;
  stopLoss: number;
  netProfit?: number | null;
}

interface ChargeSettings {
  brokeragePercent: number;
  brokerageCapPerOrder: number;
  sttBuyPercent: number;
  sttSellPercent: number;
  exchangeTxnPercent: number;
  gstPercent: number;
  sebiPercent: number;
  stampDutyBuyPercent: number;
  slippagePct: number;
}

interface EditableSettings {
  timeframe: "15m";
  capitalPerTrade: number;
  targetPct: number;
  maxStopLossPct: number;
  stopBufferPct: number;
  volumeRatioThreshold: number;
  minimumScore: number;
  minimumWatchPassCount: number;
  maxBreakoutExtensionPct: number;
  breakoutConfirmationTolerancePct: number;
  vwapClearancePct: number;
  minimumAverageVolume: number;
  maxHoldingCandles: number;
  squareOffTime?: string;
  allowOverlap: boolean;
  charges: ChargeSettings;
}

const rupee = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const number = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

const DEFAULT_SETTINGS: EditableSettings = {
  timeframe: "15m",
  capitalPerTrade: 10_000,
  targetPct: 0.01,
  maxStopLossPct: 0.0075,
  stopBufferPct: 0.001,
  volumeRatioThreshold: 1.2,
  minimumScore: 65,
  minimumWatchPassCount: 12,
  maxBreakoutExtensionPct: 0.015,
  breakoutConfirmationTolerancePct: 0.003,
  vwapClearancePct: 0.001,
  minimumAverageVolume: 1,
  maxHoldingCandles: 16,
  squareOffTime: "15:15",
  allowOverlap: false,
  charges: {
    brokeragePercent: 0.0003,
    brokerageCapPerOrder: 20,
    sttBuyPercent: 0,
    sttSellPercent: 0.00025,
    exchangeTxnPercent: 0.0000345,
    gstPercent: 0.18,
    sebiPercent: 0.000001,
    stampDutyBuyPercent: 0.00003,
    slippagePct: 0
  }
};

const DEFAULT_WIDGET_ORDER: DashboardWidgetId[] = ["scan", "opportunities", "workspace", "settings", "testing"];
const LAYOUT_STORAGE_KEY = "nifty-dashboard-widget-order";
const APPROX_NSE_EQUITY_TOTAL = 2_300;

function App() {
  const [status, setStatus] = React.useState<StatusPayload | null>(null);
  const [scan, setScan] = React.useState<ScanRun | null>(null);
  const [scanProgress, setScanProgress] = React.useState<JobProgress | null>(null);
  const [backtest, setBacktest] = React.useState<BacktestRun | null>(null);
  const [backtestProgress, setBacktestProgress] = React.useState<JobProgress | null>(null);
  const [paperTrades, setPaperTrades] = React.useState<PaperTrade[]>([]);
  const [paperPerformance, setPaperPerformance] = React.useState<Record<string, number>>({});
  const [selected, setSelected] = React.useState<ScanResult | null>(null);
  const [details, setDetails] = React.useState<{ result: ScanResult; recentCandles: unknown[] } | null>(null);
  const [tab, setTab] = React.useState<"BUY" | "WATCH" | "REJECTED" | "ALL">("BUY");
  const [query, setQuery] = React.useState("");
  const [sector, setSector] = React.useState("ALL");
  const [minScore, setMinScore] = React.useState(0);
  const [sortKey, setSortKey] = React.useState("score");
  const [page, setPage] = React.useState(1);
  const [error, setError] = React.useState<string | null>(null);
  const [settingsSavedMessage, setSettingsSavedMessage] = React.useState<string | null>(null);
  const [controls, setControls] = React.useState<EditableSettings>(DEFAULT_SETTINGS);
  const [layoutMode, setLayoutMode] = React.useState(false);
  const [draggedWidget, setDraggedWidget] = React.useState<DashboardWidgetId | null>(null);
  const [widgetOrder, setWidgetOrder] = React.useState<DashboardWidgetId[]>(() => readWidgetOrder());
  const [scanScope, setScanScope] = React.useState<ScanScope>("nse");
  const [backtestControls, setBacktestControls] = React.useState<{
    startDate: string;
    endDate: string;
    symbols: string;
    universe: UniverseKey;
  }>({
    startDate: dateInput(-30),
    endDate: dateInput(0),
    symbols: "RELIANCE,TCS,INFY,HDFCBANK,ICICIBANK",
    universe: "nse-equity"
  });
  const scanProgressStatusRef = React.useRef<JobProgress["status"] | null>(null);
  const backtestProgressStatusRef = React.useRef<JobProgress["status"] | null>(null);

  React.useEffect(() => {
    refreshAll();
    const timer = window.setInterval(() => {
      void fetchStatus().catch(() => undefined);
      void fetchProgress().catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  React.useEffect(() => {
    if (selected) {
      fetchJson<{ result: ScanResult; recentCandles: unknown[] }>(`/api/stocks/${selected.stockSymbol}`)
        .then(setDetails)
        .catch(() => setDetails(null));
    }
  }, [selected]);

  const sectors = React.useMemo(() => {
    const values = new Set((scan?.results ?? []).map((result) => result.sector).filter(Boolean) as string[]);
    return ["ALL", ...Array.from(values).sort()];
  }, [scan]);

  const filtered = React.useMemo(() => {
    const source = scan?.results ?? [];
    return source
      .filter((result) => (tab === "ALL" ? true : result.category === tab))
      .filter((result) => (sector === "ALL" ? true : result.sector === sector))
      .filter((result) => result.score >= minScore)
      .filter((result) => {
        const haystack = `${result.stockSymbol} ${result.companyName} ${result.sector ?? ""}`.toLowerCase();
        return haystack.includes(query.toLowerCase());
      })
      .sort((a, b) => sortResult(a, b, sortKey));
  }, [scan, tab, sector, minScore, query, sortKey]);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visibleRows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const scanCounts = React.useMemo(() => {
    const counts = { BUY: 0, WATCH: 0, REJECTED: 0 };
    (scan?.results ?? []).forEach((result) => {
      counts[result.category] += 1;
    });
    return counts;
  }, [scan]);
  const bestWatch = React.useMemo(() => scan?.results.find((result) => result.category === "WATCH"), [scan]);
  const liveScanProgress = scanProgress?.status === "running" ? scanProgress : null;
  const liveBacktestProgress = backtestProgress?.status === "running" ? backtestProgress : null;
  const syncTotal = liveScanProgress?.total || scan?.totalStocks || scanProgress?.total || scanScopeFallbackTotal(scanScope);
  const syncCompleted = liveScanProgress ? liveScanProgress.completed : scan?.completedStocks ?? scanProgress?.completed ?? 0;
  const syncCompletion = syncTotal > 0 ? Math.min(100, Math.round((syncCompleted / syncTotal) * 100)) : 0;
  const syncRunId = liveScanProgress?.runId ?? scan?.id ?? scanProgress?.runId;
  const syncMessage =
    liveScanProgress?.message ??
    (scanProgress?.status === "failed" ? scanProgress.message : scan ? `Latest scan #${scan.id} loaded` : scanProgress?.message ?? "Waiting for first scan");
  const backtestSymbolCount = Number(backtestControls.symbols.split(",").filter(Boolean).length);
  const backtestTotal = liveBacktestProgress?.total || backtest?.symbolsRequested || backtestSymbolCount || universeFallbackTotal(backtestControls.universe);
  const backtestCompleted = liveBacktestProgress ? liveBacktestProgress.completed : backtest?.symbolsTested ?? 0;
  const backtestCompletion = backtestTotal > 0 ? Math.min(100, Math.round((backtestCompleted / backtestTotal) * 100)) : 0;
  const backtestTrades = React.useMemo(
    () => [...(backtest?.trades ?? [])].sort((a, b) => new Date(b.exitTime).getTime() - new Date(a.exitTime).getTime()),
    [backtest]
  );
  const symbolPerformance = React.useMemo(
    () => [...(backtest?.symbolPerformance ?? [])].sort((a, b) => b.netProfit - a.netProfit),
    [backtest]
  );

  async function refreshAll() {
    await Promise.all([fetchStatus(), fetchProgress(), fetchSettings(), fetchLatestScan(), fetchLatestBacktest(), fetchPaper()]);
  }

  async function fetchStatus() {
    setStatus(await fetchJson<StatusPayload>("/api/status"));
  }

  async function fetchSettings() {
    setControls(await fetchJson<EditableSettings>("/api/settings"));
  }

  async function fetchProgress() {
    const [nextScanProgress, nextBacktestProgress] = await Promise.all([
      fetchJson<JobProgress>("/api/scan/progress"),
      fetchJson<JobProgress>("/api/backtest/progress")
    ]);
    const previousScanStatus = scanProgressStatusRef.current;
    const previousBacktestStatus = backtestProgressStatusRef.current;
    scanProgressStatusRef.current = nextScanProgress.status;
    backtestProgressStatusRef.current = nextBacktestProgress.status;
    setScanProgress(nextScanProgress);
    setBacktestProgress(nextBacktestProgress);
    if (previousScanStatus === "running" && nextScanProgress.status !== "running") {
      await fetchLatestScan();
    }
    if (previousBacktestStatus === "running" && nextBacktestProgress.status !== "running") {
      await fetchLatestBacktest();
    }
  }

  async function fetchLatestScan() {
    const latest = await fetchJson<ScanRun | null>("/api/scan/latest");
    setScan(latest);
    if (latest?.results?.length && !selected) setSelected(latest.results[0]);
  }

  async function fetchLatestBacktest() {
    const latest = await fetchJson<BacktestRun | null>("/api/backtest/latest");
    setBacktest(latest?.id ? await fetchJson<BacktestRun>(`/api/backtest/${latest.id}`) : latest);
  }

  async function fetchPaper() {
    const [trades, performance] = await Promise.all([
      fetchJson<PaperTrade[]>("/api/paper-trades"),
      fetchJson<Record<string, number>>("/api/paper-trades/performance")
    ]);
    setPaperTrades(trades);
    setPaperPerformance(performance);
  }

  async function runScanNow(scope = scanScope) {
    setError(null);
    try {
      const response = await fetchJson<{ progress: JobProgress }>("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...controls,
          universe: scanUniverseForScope(scope),
          limit: scanLimitForScope(scope)
        })
      });
      setScanProgress(response.progress);
      scanProgressStatusRef.current = response.progress.status;
    } catch (requestError) {
      setError(errorText(requestError));
    }
  }

  async function runBacktestNow() {
    setError(null);
    try {
      const response = await fetchJson<{ progress: JobProgress }>("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...controls, ...backtestControls })
      });
      setBacktestProgress(response.progress);
      backtestProgressStatusRef.current = response.progress.status;
    } catch (requestError) {
      setError(errorText(requestError));
    }
  }

  async function createPaperTrade(result: ScanResult) {
    await fetchJson("/api/paper-trades", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scanResultId: result.id })
    });
    await fetchPaper();
  }

  async function closeTrade(trade: PaperTrade, exitPrice: number, exitReason: string) {
    await fetchJson(`/api/paper-trades/${trade.id}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exitPrice, exitReason })
    });
    await fetchPaper();
  }

  async function saveDashboardSettings(nextSettings = controls, message = "Settings saved") {
    setError(null);
    try {
      const saved = await fetchJson<EditableSettings>("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextSettings)
      });
      setControls(saved);
      setSettingsSavedMessage(message);
      window.setTimeout(() => setSettingsSavedMessage(null), 2500);
    } catch (requestError) {
      setError(errorText(requestError));
    }
  }

  function updateSetting<K extends keyof EditableSettings>(key: K, value: EditableSettings[K]) {
    setControls((current) => ({ ...current, [key]: value }));
  }

  function updateCharge<K extends keyof ChargeSettings>(key: K, value: ChargeSettings[K]) {
    setControls((current) => ({
      ...current,
      charges: {
        ...current.charges,
        [key]: value
      }
    }));
  }

  function moveWidget(targetWidget: DashboardWidgetId) {
    if (!draggedWidget || draggedWidget === targetWidget) return;
    setWidgetOrder((current) => {
      const withoutDragged = current.filter((item) => item !== draggedWidget);
      const targetIndex = withoutDragged.indexOf(targetWidget);
      const next = [...withoutDragged.slice(0, targetIndex), draggedWidget, ...withoutDragged.slice(targetIndex)];
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function resetWidgetOrder() {
    window.localStorage.removeItem(LAYOUT_STORAGE_KEY);
    setWidgetOrder(DEFAULT_WIDGET_ORDER);
  }

  function widgetProps(id: DashboardWidgetId) {
    return {
      draggable: layoutMode,
      onDragStart: () => setDraggedWidget(id),
      onDragEnd: () => setDraggedWidget(null),
      onDragOver: (event: React.DragEvent<HTMLElement>) => {
        if (layoutMode) event.preventDefault();
      },
      onDrop: () => moveWidget(id),
      style: {
        order: widgetOrder.indexOf(id)
      },
      className: `dashboard-widget ${layoutMode ? "layout-editing" : ""} ${draggedWidget === id ? "dragging" : ""}`
    };
  }

  const dragHandle = () =>
    layoutMode ? (
      <span className="drag-handle" title="Drag to rearrange">
        <GripVertical />
      </span>
    ) : null;

  return (
    <main className="app-shell">
      <div className="horizon-layout">
        <aside className="side-rail" aria-label="Dashboard navigation">
          <div className="rail-brand">
            <span>N2</span>
            <div>
              <strong>Nifty Watch</strong>
              <small>Horizon desk</small>
            </div>
          </div>
          <nav>
            <a className="active" href="#scan-panel" title="Scan controls">
              <TrendingUp />
              <span>Scan</span>
            </a>
            <a href="#watch-panel" title="Watch list data">
              <Clock />
              <span>Watch</span>
            </a>
            <a href="#backtest-panel" title="Backtest data">
              <BarChart3 />
              <span>Test</span>
            </a>
            <a href="#settings-panel" title="Strategy settings">
              <SlidersHorizontal />
              <span>Rules</span>
            </a>
          </nav>
          <div className="rail-card">
            <span>Watch rule</span>
            <strong>{controls.minimumWatchPassCount} passes</strong>
            <small>Backtest entries come from Watch List data</small>
          </div>
          <button className="rail-action" onClick={() => runScanNow(scanScope)} disabled={scanProgress?.status === "running"} title="Run scanner">
            <Play />
            <span>Run</span>
          </button>
        </aside>
        <div className="workspace-stage">
      <header className="header">
        <div>
          <p className="eyebrow">Horizon trading dashboard</p>
          <h1>NSE Watch Scanner</h1>
        </div>
        <div className="header-grid">
          <HeaderStat icon={<Activity />} label="Market" value={status?.market.status ?? "Loading"} tone={status?.market.isOpen ? "good" : "warn"} />
          <HeaderStat icon={<Clock />} label="IST" value={status?.market.istTime ?? "--"} />
          <HeaderStat icon={<ShieldCheck />} label="Provider" value={status?.provider ?? "Yahoo Finance"} />
          <HeaderStat icon={<AlertTriangle />} label="Data" value={status?.delayed ? "Delayed estimate" : "Realtime"} tone="warn" />
        </div>
      </header>

      {error && <div className="alert">{error}</div>}

      <section className="sync-status-bar" aria-live="polite">
        <div className="sync-status-head">
          <div>
            <span className={`sync-dot ${liveScanProgress ? "live" : ""}`} />
            <strong>{liveScanProgress ? `Live scan #${syncRunId ?? "-"}` : `Latest scan #${syncRunId ?? "-"}`}</strong>
            <small>{syncMessage}</small>
          </div>
          <div className="sync-status-meta">
            <span>{syncCompleted}/{syncTotal}</span>
            <strong>{syncCompletion}%</strong>
          </div>
        </div>
        <span className="sync-track" aria-label={`Scan sync ${syncCompletion}%`}>
          <span style={{ width: `${syncCompletion}%` }} />
        </span>
        <div className="sync-status-foot">
          <span>{liveScanProgress ? "Updating every second" : "Ready"}</span>
          <span>
            {liveBacktestProgress
              ? `Backtest running ${backtestCompleted}/${backtestTotal} · ${backtestCompletion}%`
              : `Backtest ${backtestProgress?.status ?? "ready"}`}
          </span>
        </div>
      </section>

      <section className="market-cockpit">
        <div className="cockpit-main">
          <span className="status-pill">
            <span className={status?.market.isOpen ? "pulse-dot live" : "pulse-dot"} />
            {status?.market.status ?? "Loading"}
          </span>
          <h2>Strategy Command Center</h2>
          <p className="cockpit-subline">
            Run #{syncRunId ?? "-"} · {syncCompleted}/{syncTotal} symbols · {syncCompletion}%
            complete
          </p>
          <span className="cockpit-meter" aria-label={`${syncCompletion}% complete`}>
            <span style={{ width: `${syncCompletion}%` }} />
          </span>
          <div className="strategy-chips">
            <span>Open &gt; Pivot</span>
            <span>VWAP &gt; EMA20</span>
            <span>Watch-only backtest</span>
          </div>
          <div className="cockpit-actions">
            <button className="primary" onClick={() => runScanNow(scanScope)} disabled={scanProgress?.status === "running"}>
              <Play />
              {scanActionLabel(scanScope)}
            </button>
            <button className={layoutMode ? "active-toggle" : ""} onClick={() => setLayoutMode((current) => !current)}>
              <LayoutDashboard />
              {layoutMode ? "Lock Layout" : "Arrange"}
            </button>
          </div>
        </div>
        <div className="cockpit-tiles">
          <CockpitTile icon={<CheckCircle2 />} label="Strict BUY" value={scanCounts.BUY} caption="Entry grade" tone="buy" />
          <CockpitTile icon={<Clock />} label="Watchlist" value={scanCounts.WATCH} caption="Near setup" tone="watch" />
          <CockpitTile icon={<AlertTriangle />} label="Rejected" value={scanCounts.REJECTED} caption="Filtered out" tone="reject" />
          <CockpitTile icon={<BarChart3 />} label="Paper Net" value={money(paperPerformance.netPnL)} caption="Closed P&L" tone="paper" />
        </div>
        <div className="cockpit-focus">
          <span>Best watch</span>
          <strong>{bestWatch?.stockSymbol ?? "None"}</strong>
          <p>
            {bestWatch
              ? `Score ${bestWatch.score} · Close ${formatNumber(bestWatch.close)} · VWAP ${formatNumber(bestWatch.vwap)}`
              : "No watch candidate from the latest scan."}
          </p>
        </div>
      </section>

      <div className="layout-toolbar">
        <div>
          <LayoutDashboard />
          <span>Dashboard layout</span>
        </div>
        <button className={layoutMode ? "active-toggle" : ""} onClick={() => setLayoutMode((current) => !current)}>
          {layoutMode ? "Done" : "Customize"}
        </button>
        <button onClick={resetWidgetOrder}>
          <RotateCcw />
          Reset layout
        </button>
      </div>

      <div className="dashboard-grid">
      <section id="scan-panel" {...widgetProps("scan")} className={`${widgetProps("scan").className} control-band`}>
        <div className="section-title">
          {dragHandle()}
          <TrendingUp />
          <h2>Scan Controls</h2>
        </div>
        <div className="controls">
          <label>
            Timeframe
            <select value="15m" disabled>
              <option>15m</option>
            </select>
          </label>
          <label>
            Scope
            <select value={scanScope} onChange={(event) => setScanScope(event.target.value as ScanScope)}>
              <option value="nse">Full NSE</option>
              <option value="nifty200">NSE 200</option>
            </select>
          </label>
          <NumberInput label="Capital" value={controls.capitalPerTrade} onChange={(value) => setControls({ ...controls, capitalPerTrade: value })} />
          <NumberInput label="Target %" value={controls.targetPct * 100} step={0.1} onChange={(value) => setControls({ ...controls, targetPct: value / 100 })} />
          <NumberInput
            label="Max stop %"
            value={controls.maxStopLossPct * 100}
            step={0.05}
            onChange={(value) => setControls({ ...controls, maxStopLossPct: value / 100 })}
          />
          <NumberInput
            label="Volume ratio"
            value={controls.volumeRatioThreshold}
            step={0.1}
            onChange={(value) => setControls({ ...controls, volumeRatioThreshold: value })}
          />
          <button className="primary" onClick={() => runScanNow(scanScope)} disabled={scanProgress?.status === "running"}>
            <Play />
            {scanActionLabel(scanScope)}
          </button>
        </div>
        <ProgressLine progress={scanProgress} fallbackTotal={scanScopeFallbackTotal(scanScope)} />
      </section>

      <section id="settings-panel" {...widgetProps("settings")} className={`${widgetProps("settings").className} settings-band`}>
        <div className="section-title">
          {dragHandle()}
          <SlidersHorizontal />
          <h2>Editable Settings</h2>
          {settingsSavedMessage && <span className="save-state">{settingsSavedMessage}</span>}
          <div className="actions">
            <button onClick={() => saveDashboardSettings()}>
              <Save />
              Save
            </button>
            <button onClick={() => saveDashboardSettings(DEFAULT_SETTINGS, "Defaults restored")}>
              <RotateCcw />
              Reset
            </button>
          </div>
        </div>
        <div className="settings-groups">
          <div>
            <h3 className="settings-group-title">Strategy</h3>
            <div className="controls settings-grid">
              <NumberInput label="Minimum score" value={controls.minimumScore} onChange={(value) => updateSetting("minimumScore", value)} />
              <NumberInput
                label="Watch passes"
                value={controls.minimumWatchPassCount}
                onChange={(value) => updateSetting("minimumWatchPassCount", Math.floor(value))}
              />
              <NumberInput
                label="Breakout max %"
                value={controls.maxBreakoutExtensionPct * 100}
                step={0.05}
                onChange={(value) => updateSetting("maxBreakoutExtensionPct", value / 100)}
              />
              <NumberInput
                label="Stop buffer %"
                value={controls.stopBufferPct * 100}
                step={0.01}
                onChange={(value) => updateSetting("stopBufferPct", value / 100)}
              />
              <NumberInput
                label="Confirm tol %"
                value={controls.breakoutConfirmationTolerancePct * 100}
                step={0.01}
                onChange={(value) => updateSetting("breakoutConfirmationTolerancePct", value / 100)}
              />
              <NumberInput
                label="VWAP clear %"
                value={controls.vwapClearancePct * 100}
                step={0.01}
                onChange={(value) => updateSetting("vwapClearancePct", value / 100)}
              />
              <NumberInput
                label="Min avg volume"
                value={controls.minimumAverageVolume}
                onChange={(value) => updateSetting("minimumAverageVolume", value)}
              />
              <NumberInput
                label="Max candles"
                value={controls.maxHoldingCandles}
                onChange={(value) => updateSetting("maxHoldingCandles", Math.floor(value))}
              />
              <label>
                Square-off
                <input
                  type="time"
                  value={controls.squareOffTime ?? "15:15"}
                  onChange={(event) => updateSetting("squareOffTime", event.target.value)}
                />
              </label>
              <label>
                Overlap
                <select
                  value={controls.allowOverlap ? "yes" : "no"}
                  onChange={(event) => updateSetting("allowOverlap", event.target.value === "yes")}
                >
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </label>
            </div>
          </div>
          <div>
            <h3 className="settings-group-title">Charges</h3>
            <div className="controls settings-grid">
              <NumberInput
                label="Brokerage %"
                value={controls.charges.brokeragePercent * 100}
                step={0.001}
                onChange={(value) => updateCharge("brokeragePercent", value / 100)}
              />
              <NumberInput
                label="Brokerage cap"
                value={controls.charges.brokerageCapPerOrder}
                onChange={(value) => updateCharge("brokerageCapPerOrder", value)}
              />
              <NumberInput
                label="STT buy %"
                value={controls.charges.sttBuyPercent * 100}
                step={0.001}
                onChange={(value) => updateCharge("sttBuyPercent", value / 100)}
              />
              <NumberInput
                label="STT sell %"
                value={controls.charges.sttSellPercent * 100}
                step={0.001}
                onChange={(value) => updateCharge("sttSellPercent", value / 100)}
              />
              <NumberInput
                label="Exchange %"
                value={controls.charges.exchangeTxnPercent * 100}
                step={0.0001}
                onChange={(value) => updateCharge("exchangeTxnPercent", value / 100)}
              />
              <NumberInput
                label="GST %"
                value={controls.charges.gstPercent * 100}
                step={0.1}
                onChange={(value) => updateCharge("gstPercent", value / 100)}
              />
              <NumberInput
                label="SEBI %"
                value={controls.charges.sebiPercent * 100}
                step={0.0001}
                onChange={(value) => updateCharge("sebiPercent", value / 100)}
              />
              <NumberInput
                label="Stamp %"
                value={controls.charges.stampDutyBuyPercent * 100}
                step={0.0001}
                onChange={(value) => updateCharge("stampDutyBuyPercent", value / 100)}
              />
              <NumberInput
                label="Slippage %"
                value={controls.charges.slippagePct * 100}
                step={0.01}
                onChange={(value) => updateCharge("slippagePct", value / 100)}
              />
            </div>
          </div>
        </div>
      </section>

      <section {...widgetProps("opportunities")} className={`${widgetProps("opportunities").className} top-band`}>
        <div className="section-title">
          {dragHandle()}
          <CheckCircle2 />
          <h2>Top Opportunities</h2>
        </div>
        <div className="top-grid">
          {(scan?.topThree?.length ? scan.topThree : []).map((result) => (
            <article className="opportunity" key={result.id}>
              <div>
                <span className="badge buy">BUY</span>
                <h3><StockChartLink result={result} variant="heading" /></h3>
                <p>{result.companyName}</p>
              </div>
              <dl>
                <Metric label="Score" value={`${result.score}`} />
                <Metric label="Entry" value={money(result.entry)} />
                <Metric label="Qty" value={result.quantity ?? "-"} />
                <Metric label="Target" value={money(result.target2)} />
                <Metric label="Stop" value={money(result.stopLoss)} />
                <Metric label="Net est." value={money(result.netProfitTarget2)} />
                <Metric label="Volume" value={formatNumber(result.volumeRatio)} />
                <Metric label="Breakout" value={result.breakoutType ?? "-"} />
              </dl>
              <p className="reasons">{result.reasons.slice(0, 3).join(" • ")}</p>
              <button onClick={() => createPaperTrade(result)}>Paper Trade</button>
            </article>
          ))}
          {!scan?.topThree?.length && (
            <div className="empty-state">
              <XCircle />
              <p>No strict BUY candidate is available from the latest scan.</p>
            </div>
          )}
        </div>
      </section>

      <section id="watch-panel" {...widgetProps("workspace")} className={`${widgetProps("workspace").className} work-grid`}>
        <div className="result-panel">
          <div className="section-title">
            {dragHandle()}
            <BarChart3 />
            <h2>Results</h2>
            <div className="actions">
              <a href="/api/export/scan" target="_blank">
                <Download />
                CSV
              </a>
              <a href="/api/export/scan?format=json" target="_blank">
                JSON
              </a>
            </div>
          </div>
          <div className="tabs">
            {(["BUY", "WATCH", "REJECTED", "ALL"] as const).map((item) => (
              <button className={tab === item ? "active" : ""} onClick={() => { setTab(item); setPage(1); }} key={item}>
                {item}
              </button>
            ))}
          </div>
          <div className="filters">
            <label className="search">
              <Search />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search symbol, company, sector" />
            </label>
            <select value={sector} onChange={(event) => setSector(event.target.value)}>
              {sectors.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <NumberInput label="Min score" value={minScore} onChange={setMinScore} />
            <select value={sortKey} onChange={(event) => setSortKey(event.target.value)}>
              <option value="score">Score</option>
              <option value="volumeRatio">Volume ratio</option>
              <option value="distanceBreakout">Breakout distance</option>
              <option value="liquidity">Liquidity</option>
            </select>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Company</th>
                  <th>Category</th>
                  <th>Score</th>
                  <th>Close</th>
                  <th>VWAP</th>
                  <th>EMA 20</th>
                  <th>EMA 200</th>
                  <th>Prev High</th>
                  <th>Pivot</th>
                  <th>R1</th>
                  <th>Vol Ratio</th>
                  <th>Breakout</th>
                  <th>Target</th>
                  <th>Stop</th>
                  <th>Signal</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((result) => (
                  <tr className={selected?.id === result.id ? "selected" : ""} onClick={() => setSelected(result)} key={result.id}>
                    <td><StockChartLink result={result} /></td>
                    <td>{result.companyName}</td>
                    <td><span className={`badge ${result.category.toLowerCase()}`}>{result.category}</span></td>
                    <td>{result.score}</td>
                    <td>{formatNumber(result.close)}</td>
                    <td>{formatNumber(result.vwap)}</td>
                    <td>{formatNumber(result.ema20)}</td>
                    <td>{formatNumber(result.ema200)}</td>
                    <td>{formatNumber(result.previousHigh)}</td>
                    <td>{formatNumber(result.pivot)}</td>
                    <td>{formatNumber(result.r1)}</td>
                    <td>{formatNumber(result.volumeRatio)}</td>
                    <td>{formatNumber(result.breakoutLevel)}</td>
                    <td>{money(result.target2)}</td>
                    <td>{money(result.stopLoss)}</td>
                    <td>{formatDate(result.signalTime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <button onClick={() => setPage(Math.max(1, page - 1))}>Prev</button>
            <span>{page} / {totalPages}</span>
            <button onClick={() => setPage(Math.min(totalPages, page + 1))}>Next</button>
          </div>
        </div>

        <aside className="details-panel">
          <div className="section-title">
            <RefreshCcw />
            <h2>Stock Details</h2>
          </div>
          {details ? (
            <>
              <div className="detail-head">
                <h3><StockChartLink result={details.result} variant="heading" /></h3>
                <span className={`badge ${details.result.category.toLowerCase()}`}>{details.result.category}</span>
              </div>
              <dl className="detail-metrics">
                <Metric label="Entry" value={money(details.result.entry)} />
                <Metric label="Qty" value={details.result.quantity ?? "-"} />
                <Metric label="Target 2" value={money(details.result.target2)} />
                <Metric label="Stop" value={money(details.result.stopLoss)} />
                <Metric label="Gross profit" value={money(details.result.profitTarget2Gross)} />
                <Metric label="Max loss" value={money(details.result.maxLossGross)} />
              </dl>
              <h4>Passed</h4>
              <ConditionList conditions={(details.result.conditions ?? []).filter((condition) => condition.passed)} />
              <h4>Failed</h4>
              <ConditionList conditions={(details.result.conditions ?? []).filter((condition) => !condition.passed)} />
              <h4>Pending</h4>
              <ul className="plain-list">
                {details.result.pending.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </>
          ) : (
            <p className="muted">Select a row after a scan completes.</p>
          )}
        </aside>
      </section>

      <section id="backtest-panel" {...widgetProps("testing")} className={`${widgetProps("testing").className} lower-grid`}>
        <div className="backtest-panel">
          <div className="section-title">
            {dragHandle()}
            <BarChart3 />
            <h2>Backtest</h2>
          </div>
          <div className="controls compact">
            <label>
              Start
              <input type="date" value={backtestControls.startDate} onChange={(event) => setBacktestControls({ ...backtestControls, startDate: event.target.value })} />
            </label>
            <label>
              End
              <input type="date" value={backtestControls.endDate} onChange={(event) => setBacktestControls({ ...backtestControls, endDate: event.target.value })} />
            </label>
            <label className="wide">
              Symbols
              <input value={backtestControls.symbols} onChange={(event) => setBacktestControls({ ...backtestControls, symbols: event.target.value })} />
            </label>
            <label>
              Universe
              <select value={backtestControls.universe} onChange={(event) => setBacktestControls({ ...backtestControls, universe: event.target.value as UniverseKey })}>
                <option value="nse-equity">Full NSE</option>
                <option value="nifty200">NSE 200</option>
              </select>
            </label>
            <button className="primary" onClick={runBacktestNow} disabled={backtestProgress?.status === "running"}>
              <Play />
              Start Backtest
            </button>
          </div>
          <ProgressLine progress={backtestProgress} fallbackTotal={backtestSymbolCount || universeFallbackTotal(backtestControls.universe)} />
          {backtest && (
            <>
              <div className="summary-grid">
                <Metric label="Trades" value={backtest.totalTrades} />
                <Metric label="Win rate" value={`${backtest.winRate}%`} />
                <Metric label="Net P&L" value={money(backtest.netProfit)} />
                <Metric label="Charges" value={money(backtest.totalCharges)} />
                <Metric label="Drawdown" value={money(backtest.maxDrawdown)} />
                <Metric label="Profit factor" value={formatNumber(backtest.profitFactor)} />
                <Metric label="Targets" value={backtest.targetHitCount} />
                <Metric label="Stops" value={backtest.stopLossHitCount} />
              </div>
              <div className="charts">
                <ChartFrame title="Equity Curve">
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={backtest.equityCurve}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" hide />
                      <YAxis width={54} />
                      <Tooltip />
                      <Line type="monotone" dataKey="equity" stroke="#00a67d" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartFrame>
                <ChartFrame title="Monthly P&L">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={backtest.monthlyPerformance}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis width={54} />
                      <Tooltip />
                      <Bar dataKey="profit" fill="#2563eb" />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartFrame>
              </div>
              <div className="backtest-data">
                <div className="backtest-data-head">
                  <div>
                    <h3>Backtest Data</h3>
                    <p>
                      Run #{backtest.id} · {backtest.startDate} to {backtest.endDate} · {backtest.symbolsTested}/
                      {backtest.symbolsRequested} symbols tested
                    </p>
                  </div>
                  <span>{backtestTrades.length} trades</span>
                </div>
                <div className="mini-data-grid">
                  <div className="mini-table-wrap">
                    <div className="mini-table-title">
                      <strong>Symbol Performance</strong>
                    </div>
                    <table className="mini-table">
                      <thead>
                        <tr>
                          <th>Symbol</th>
                          <th>Trades</th>
                          <th>Win %</th>
                          <th>Net P&L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {symbolPerformance.map((item) => (
                          <tr key={item.symbol}>
                            <td>{item.symbol}</td>
                            <td>{item.trades}</td>
                            <td>{formatNumber(item.winRate)}%</td>
                            <td className={profitClass(item.netProfit)}>{money(item.netProfit)}</td>
                          </tr>
                        ))}
                        {!symbolPerformance.length && (
                          <tr>
                            <td colSpan={4}>No symbol data yet.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="mini-table-wrap">
                    <div className="mini-table-title">
                      <strong>Monthly P&L</strong>
                    </div>
                    <table className="mini-table">
                      <thead>
                        <tr>
                          <th>Month</th>
                          <th>P&L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {backtest.monthlyPerformance.map((item) => (
                          <tr key={item.month}>
                            <td>{item.month}</td>
                            <td className={profitClass(item.profit)}>{money(item.profit)}</td>
                          </tr>
                        ))}
                        {!backtest.monthlyPerformance.length && (
                          <tr>
                            <td colSpan={2}>No monthly data yet.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="trade-ledger">
                  <div className="mini-table-title">
                    <strong>Trade Ledger</strong>
                    <span>Newest exits first</span>
                  </div>
                  <div className="table-wrap backtest-table-wrap">
                    <table className="backtest-table">
                      <thead>
                        <tr>
                          <th>Symbol</th>
                          <th>Signal</th>
                          <th>Entry</th>
                          <th>Exit</th>
                          <th>Entry Price</th>
                          <th>Exit Price</th>
                          <th>Qty</th>
                          <th>Target</th>
                          <th>Stop</th>
                          <th>Reason</th>
                          <th>Gross</th>
                          <th>Charges</th>
                          <th>Net</th>
                          <th>Return</th>
                          <th>Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {backtestTrades.map((trade) => (
                          <tr key={trade.id}>
                            <td>{trade.symbol}</td>
                            <td>{formatDate(trade.signalTime)}</td>
                            <td>{formatDate(trade.entryTime)}</td>
                            <td>{formatDate(trade.exitTime)}</td>
                            <td>{money(trade.entryPrice)}</td>
                            <td>{money(trade.exitPrice)}</td>
                            <td>{trade.quantity}</td>
                            <td>{money(trade.target)}</td>
                            <td>{money(trade.stopLoss)}</td>
                            <td><span className={`result-pill ${trade.exitReason.toLowerCase().replace(/_/g, "-")}`}>{trade.exitReason}</span></td>
                            <td className={profitClass(trade.grossProfit)}>{money(trade.grossProfit)}</td>
                            <td>{money(trade.charges)}</td>
                            <td className={profitClass(trade.netProfit)}>{money(trade.netProfit)}</td>
                            <td className={profitClass(trade.returnPct)}>{formatNumber(trade.returnPct)}%</td>
                            <td>{trade.score}</td>
                          </tr>
                        ))}
                        {!backtestTrades.length && (
                          <tr>
                            <td colSpan={15}>No trades were generated for this backtest.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                {backtest.missingSymbols.length > 0 && (
                  <div className="missing-symbols">
                    <strong>Missing Data</strong>
                    <ul>
                      {backtest.missingSymbols.slice(0, 20).map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <div className="actions">
                <a href={`/api/export/backtest/${backtest.id}/trades`} target="_blank"><Download /> Trades CSV</a>
                <a href={`/api/export/backtest/${backtest.id}/trades?format=json`} target="_blank">JSON</a>
              </div>
            </>
          )}
        </div>

        <div className="paper-panel">
          <div className="section-title">
            <ShieldCheck />
            <h2>Paper Trading</h2>
          </div>
          <div className="summary-grid">
            <Metric label="Open" value={paperPerformance.openTrades ?? 0} />
            <Metric label="Closed" value={paperPerformance.closedTrades ?? 0} />
            <Metric label="Win rate" value={`${paperPerformance.winRate ?? 0}%`} />
            <Metric label="Net P&L" value={money(paperPerformance.netPnL)} />
          </div>
          <div className="trade-list">
            {paperTrades.map((trade) => (
              <article key={trade.id} className="trade-row">
                <div>
                  <strong>{trade.symbol}</strong>
                  <span>{trade.status}</span>
                </div>
                <p>{trade.quantity} @ {money(trade.entryPrice)} · Target {money(trade.target)} · Stop {money(trade.stopLoss)}</p>
                {trade.status === "OPEN" ? (
                  <div className="mini-actions">
                    <button onClick={() => closeTrade(trade, trade.target, "TARGET")}>Target</button>
                    <button onClick={() => closeTrade(trade, trade.stopLoss, "STOP_LOSS")}>Stop</button>
                    <button
                      onClick={() => {
                        const value = window.prompt("Exit price");
                        if (value) closeTrade(trade, Number(value), "MANUAL");
                      }}
                    >
                      Manual
                    </button>
                  </div>
                ) : (
                  <p>Net {money(trade.netProfit)}</p>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>
      </div>
        </div>
      </div>
    </main>
  );
}

function HeaderStat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone?: "good" | "warn" }) {
  return (
    <div className={`header-stat ${tone ?? ""}`}>
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CockpitTile({
  icon,
  label,
  value,
  caption,
  tone
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  caption: string;
  tone: "buy" | "watch" | "reject" | "paper";
}) {
  return (
    <div className={`cockpit-tile ${tone}`}>
      <div className="cockpit-tile-head">
        {icon}
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <small>{caption}</small>
    </div>
  );
}

function NumberInput({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (value: number) => void; step?: number }) {
  return (
    <label>
      {label}
      <input type="number" value={value} step={step} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="metric">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function StockChartLink({
  result,
  variant = "inline"
}: {
  result: Pick<ScanResult, "stockSymbol" | "companyName">;
  variant?: "inline" | "heading";
}) {
  return (
    <a
      className={`stock-chart-link ${variant}`}
      href={growwChartUrl(result)}
      target={`groww-chart-${result.stockSymbol}`}
      rel="noreferrer"
      title={`Open ${result.stockSymbol} chart on Groww`}
      onClick={(event) => event.stopPropagation()}
    >
      <span>{result.stockSymbol}</span>
      <ExternalLink />
    </a>
  );
}

function ProgressLine({ progress, fallbackTotal }: { progress: JobProgress | null; fallbackTotal: number }) {
  const total = progress?.total || fallbackTotal;
  const completed = progress?.completed ?? 0;
  const width = total > 0 ? Math.min(100, (completed / total) * 100) : 0;
  return (
    <div className="progress-line">
      <div>
        <span>{progress?.message ?? "Ready"}</span>
        <strong>{completed}/{total}</strong>
      </div>
      <span className="track"><span style={{ width: `${width}%` }} /></span>
    </div>
  );
}

function ConditionList({ conditions }: { conditions: Condition[] }) {
  if (!conditions.length) return <p className="muted">None</p>;
  return (
    <ul className="condition-list">
      {conditions.map((condition) => (
        <li className={condition.passed ? "pass" : "fail"} key={condition.key}>
          {condition.passed ? <CheckCircle2 /> : <XCircle />}
          <span>{condition.label}</span>
        </li>
      ))}
    </ul>
  );
}

function ChartFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="chart-frame">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

function scanUniverseForScope(scope: ScanScope): UniverseKey {
  return scope === "nifty200" ? "nifty200" : "nse-equity";
}

function scanLimitForScope(scope: ScanScope): number | undefined {
  return undefined;
}

function scanScopeFallbackTotal(scope: ScanScope): number {
  return universeFallbackTotal(scanUniverseForScope(scope));
}

function universeFallbackTotal(universe: UniverseKey): number {
  return universe === "nse-equity" ? APPROX_NSE_EQUITY_TOTAL : 200;
}

function scanActionLabel(scope: ScanScope): string {
  if (scope === "nifty200") return "Scan NSE 200";
  return "Scan Full NSE";
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(data?.error ?? response.statusText);
  return data as T;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

function sortResult(a: ScanResult, b: ScanResult, key: string): number {
  const read = (result: ScanResult) => Number((result as unknown as Record<string, unknown>)[key] ?? 0);
  return read(b) - read(a);
}

function money(value?: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? rupee.format(value) : "-";
}

function formatNumber(value?: number | null): string {
  return typeof value === "number" && Number.isFinite(value) ? number.format(value) : "-";
}

function profitClass(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return "";
  return value > 0 ? "profit-positive" : "profit-negative";
}

function formatDate(value?: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" });
}

function growwChartUrl(result: Pick<ScanResult, "stockSymbol" | "companyName">): string {
  const slug = GROWW_SLUG_OVERRIDES[result.stockSymbol.toUpperCase()] ?? toGrowwSlug(result.companyName || result.stockSymbol);
  return `https://groww.in/charts/stocks/${slug}?exchange=NSE`;
}

function toGrowwSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\blimited\b/g, "ltd")
    .replace(/\bltd\./g, "ltd")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const GROWW_SLUG_OVERRIDES: Record<string, string> = {
  HDFCBANK: "hdfc-bank-ltd",
  ICICIBANK: "icici-bank-ltd",
  INFY: "infosys-ltd",
  KEI: "kei-industries-ltd",
  RELIANCE: "reliance-industries-ltd",
  TCS: "tata-consultancy-services-ltd"
};

function dateInput(offsetDays: number): string {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function readWidgetOrder(): DashboardWidgetId[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(LAYOUT_STORAGE_KEY) ?? "[]") as DashboardWidgetId[];
    const validStored = stored.filter((item): item is DashboardWidgetId => DEFAULT_WIDGET_ORDER.includes(item));
    const missing = DEFAULT_WIDGET_ORDER.filter((item) => !validStored.includes(item));
    return [...validStored, ...missing];
  } catch {
    return DEFAULT_WIDGET_ORDER;
  }
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
