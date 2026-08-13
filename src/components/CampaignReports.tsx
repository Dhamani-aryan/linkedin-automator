import { CalendarDays, Download, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getCampaignAnalytics } from "../lib/runnerApi";
import type { CampaignAnalytics, CampaignAnalyticsDay, CampaignWorkspaceState } from "../types";

type CampaignReportsProps = {
  profileId: string;
  campaigns: CampaignWorkspaceState[];
};

type ChartSeriesKey = "invitesSent" | "accepted" | "messagesSent" | "replies";
type ChartWindow = "7" | "14" | "30" | "all";

const chartSeries: Array<{ key: ChartSeriesKey; label: string; className: string }> = [
  { key: "invitesSent", label: "Invites", className: "invite" },
  { key: "accepted", label: "Accepted", className: "accepted" },
  { key: "messagesSent", label: "Messages", className: "message" },
  { key: "replies", label: "Replies", className: "reply" }
];

const emptyAnalytics: CampaignAnalytics = {
  range: { from: "", to: "", timeZone: "UTC" },
  totals: {
    invitesSent: 0,
    accepted: 0,
    messagesSent: 0,
    replies: 0,
    acceptanceRate: 0,
    replyRate: 0
  },
  daily: [],
  campaigns: []
};

export function CampaignReports({ profileId, campaigns }: CampaignReportsProps) {
  const [campaignId, setCampaignId] = useState("");
  const [from, setFrom] = useState(() => dateInputValue(daysAgo(29)));
  const [to, setTo] = useState(() => dateInputValue(new Date()));
  const [chartWindow, setChartWindow] = useState<ChartWindow>("30");
  const [chartEndDate, setChartEndDate] = useState(() => dateInputValue(new Date()));
  const [analytics, setAnalytics] = useState<CampaignAnalytics>(emptyAnalytics);
  const [visibleSeries, setVisibleSeries] = useState<ChartSeriesKey[]>(() => chartSeries.map(({ key }) => key));
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    setIsLoading(true);
    setError("");
    try {
      setAnalytics(await getCampaignAnalytics({
        profileId,
        campaignId: campaignId || undefined,
        from,
        to,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
      }));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Reports could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [profileId, campaignId, from, to]);

  useEffect(() => {
    setChartEndDate((current) => current < from ? from : current > to ? to : current);
  }, [from, to]);

  const chartDays = useMemo(() => {
    const earliest = chartWindow === "all"
      ? from
      : laterDate(from, shiftDateKey(chartEndDate, -(Number(chartWindow) - 1)));
    return analytics.daily.filter((day) => day.date >= earliest && day.date <= chartEndDate);
  }, [analytics.daily, chartEndDate, chartWindow, from]);

  const campaignRows = useMemo(() => {
    if (campaignId) return analytics.campaigns;
    const byId = new Map(analytics.campaigns.map((campaign) => [campaign.id, campaign]));
    return campaigns.map(({ campaign }) => byId.get(campaign.id) ?? {
      id: campaign.id,
      name: campaign.name,
      invitesSent: 0,
      accepted: 0,
      messagesSent: 0,
      replies: 0,
      acceptanceRate: 0,
      replyRate: 0
    });
  }, [analytics.campaigns, campaignId, campaigns]);

  function downloadCsv() {
    const rows = [
      ["Date", "Invites sent", "Accepted", "Messages sent", "Replies"],
      ...analytics.daily.map((day) => [day.date, day.invitesSent, day.accepted, day.messagesSent, day.replies])
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `campaign-report-${from}-${to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function toggleSeries(key: ChartSeriesKey) {
    setVisibleSeries((current) => {
      if (current.includes(key)) {
        return current.length === 1 ? current : current.filter((item) => item !== key);
      }
      return [...current, key];
    });
  }

  return (
    <section className="campaign-reports">
      <div className="report-toolbar">
        <label>
          <span>Campaign</span>
          <select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}>
            <option value="">All campaigns</option>
            {campaigns.map(({ campaign }) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
          </select>
        </label>
        <label>
          <span>From</span>
          <div className="report-date-input"><CalendarDays size={16} /><input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></div>
        </label>
        <label>
          <span>To</span>
          <div className="report-date-input"><CalendarDays size={16} /><input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></div>
        </label>
        <div className="report-toolbar-actions">
          <button className="icon-button" type="button" title="Refresh reports" onClick={() => void refresh()} disabled={isLoading}>
            {isLoading ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}
          </button>
          <button className="ghost-button" type="button" onClick={downloadCsv} disabled={analytics.daily.length === 0}>
            <Download size={17} /> Export CSV
          </button>
        </div>
      </div>

      {error ? <div className="workspace-feedback error" role="alert"><span>{error}</span><button type="button" onClick={() => void refresh()}>Retry</button></div> : null}

      <div className="report-kpis" aria-label="Campaign totals">
        <ReportKpi label="Invites sent" value={analytics.totals.invitesSent} detail={`${formatPercent(analytics.totals.acceptanceRate)} accepted`} />
        <ReportKpi label="Accepted" value={analytics.totals.accepted} detail="Detected connections" />
        <ReportKpi label="Messages sent" value={analytics.totals.messagesSent} detail={`${formatPercent(analytics.totals.replyRate)} reply rate`} />
        <ReportKpi label="Replies" value={analytics.totals.replies} detail="Follow-ups suppressed" />
      </div>

      <section className="report-chart-section">
        <header>
          <div>
            <p className="section-kicker">Daily activity</p>
            <h2>Campaign outcomes</h2>
          </div>
          <div className="report-chart-settings">
            <div className="report-chart-date-controls">
              <label>
                <span>Window</span>
                <select value={chartWindow} onChange={(event) => setChartWindow(event.target.value as ChartWindow)}>
                  <option value="7">7 days</option>
                  <option value="14">14 days</option>
                  <option value="30">30 days</option>
                  <option value="all">Full range</option>
                </select>
              </label>
              <label>
                <span>Ending</span>
                <div className="report-date-input compact"><CalendarDays size={15} /><input type="date" value={chartEndDate} min={from} max={to} onChange={(event) => setChartEndDate(event.target.value)} /></div>
              </label>
            </div>
            <div className="report-legend" aria-label="Visible chart outcomes">
              {chartSeries.map((series) => {
                const checked = visibleSeries.includes(series.key);
                return (
                  <label className={`report-series-toggle ${checked ? "active" : ""}`} key={series.key}>
                    <input type="checkbox" checked={checked} onChange={() => toggleSeries(series.key)} />
                    <i className={series.className} />
                    <span>{series.label}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </header>
        <DailyActivityChart days={chartDays} visibleSeries={visibleSeries} />
      </section>

      <section className="report-campaign-table">
        <header><span>Campaign</span><span>Invites</span><span>Accepted</span><span>Messages</span><span>Replies</span><span>Acceptance</span><span>Reply rate</span></header>
        {campaignRows.length === 0 ? (
          <div className="report-empty">No campaign activity in this date range.</div>
        ) : campaignRows.map((campaign) => (
          <div key={campaign.id}>
            <strong>{campaign.name}</strong>
            <span>{campaign.invitesSent}</span>
            <span>{campaign.accepted}</span>
            <span>{campaign.messagesSent}</span>
            <span>{campaign.replies}</span>
            <span>{formatPercent(campaign.acceptanceRate)}</span>
            <span>{formatPercent(campaign.replyRate)}</span>
          </div>
        ))}
      </section>
    </section>
  );
}

function ReportKpi({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <div><span>{label}</span><strong>{value.toLocaleString()}</strong><small>{detail}</small></div>;
}

function DailyActivityChart({ days, visibleSeries }: { days: CampaignAnalyticsDay[]; visibleSeries: ChartSeriesKey[] }) {
  const maximum = Math.max(1, ...days.flatMap((day) => visibleSeries.map((key) => day[key])));
  return (
    <div className="report-chart-scroll">
      <div className="report-chart" style={{ gridTemplateColumns: `repeat(${Math.max(days.length, 1)}, minmax(30px, 1fr))` }}>
        {days.length === 0 ? <div className="report-empty">No activity recorded.</div> : days.map((day, index) => (
          <div
            className="report-day"
            key={day.date}
            tabIndex={0}
            aria-label={`${formatChartDate(day.date)} campaign outcomes`}
          >
            <div className="report-bars">
              {chartSeries.filter(({ key }) => visibleSeries.includes(key)).map((series) => (
                <i key={series.key} className={series.className} style={{ height: barHeight(day[series.key], maximum) }} />
              ))}
            </div>
            <span>{showDateLabel(index, days.length) ? day.date.slice(5) : ""}</span>
            <div className="report-tooltip" role="tooltip">
              <strong>{formatChartDate(day.date)}</strong>
              {chartSeries.filter(({ key }) => visibleSeries.includes(key)).map((series) => (
                <span key={series.key}><i className={series.className} /> {series.label}<b>{day[series.key]}</b></span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function barHeight(value: number, maximum: number) {
  return value === 0 ? "0" : `${Math.max(5, (value / maximum) * 100)}%`;
}

function showDateLabel(index: number, total: number) {
  const interval = total > 20 ? 5 : total > 10 ? 3 : 1;
  return index === 0 || index === total - 1 || index % interval === 0;
}

function formatPercent(value: number) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

function formatChartDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00.000Z`));
}

function daysAgo(count: number) {
  const date = new Date();
  date.setDate(date.getDate() - count);
  return date;
}

function dateInputValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function shiftDateKey(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function laterDate(left: string, right: string) {
  return left > right ? left : right;
}

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
