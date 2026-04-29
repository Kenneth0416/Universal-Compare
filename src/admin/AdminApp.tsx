import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Check,
  Clock3,
  Database,
  FileText,
  GitCompareArrows,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  getAdminCalls,
  getAdminFeatured,
  getAdminReports,
  getAdminRuns,
  getAdminSession,
  getAdminSummary,
  getAdminUsers,
  loginAdmin,
  logoutAdmin,
  deleteAdminReport,
  addAdminFeatured,
  deleteAdminFeatured,
  patchAdminFeatured,
} from './adminApi';
import { generateComparison } from '../services/geminiService';
import { saveReport } from '../services/reportService';
import type { AdminSummary, CallListItem, FeaturedComparison, ReportListItem, RunListItem, UserListItem } from './types';

type AdminTab = 'overview' | 'runs' | 'calls' | 'users' | 'reports';

const dateTime = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDate(value: string | null) {
  if (!value) return '-';
  return dateTime.format(new Date(value));
}

function formatDuration(value: number) {
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function statusClass(status: string) {
  if (status === 'completed' || status === 'success') return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20';
  if (status === 'failed' || status === 'error') return 'bg-red-500/10 text-red-300 border-red-500/20';
  return 'bg-amber-500/10 text-amber-200 border-amber-500/20';
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Activity;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm text-neutral-400">{label}</span>
        <Icon size={18} className="text-neutral-500" />
      </div>
      <div className="text-2xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs text-neutral-500">{detail}</div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="rounded-lg border border-white/10 bg-white/[0.03] p-6 text-sm text-neutral-500">{label}</div>;
}

function RunsTable({ items }: { items: RunListItem[] }) {
  if (items.length === 0) return <EmptyState label="No comparison runs recorded yet." />;

  return (
    <div className="overflow-x-auto rounded-lg border border-white/10">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="bg-white/[0.04] text-xs uppercase text-neutral-500">
          <tr>
            <th className="px-4 py-3">Comparison</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Calls</th>
            <th className="px-4 py-3">Duration</th>
            <th className="px-4 py-3">Language</th>
            <th className="px-4 py-3">Started</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {items.map((item) => (
            <tr key={item.runId} className="bg-neutral-950/40">
              <td className="px-4 py-3 font-medium text-neutral-100">
                {item.itemA || '-'} <span className="text-neutral-500">vs</span> {item.itemB || '-'}
                <div className="mt-1 max-w-[320px] truncate text-xs font-normal text-neutral-500">{item.runId}</div>
              </td>
              <td className="px-4 py-3">
                <span className={`rounded-full border px-2 py-1 text-xs ${statusClass(item.status)}`}>{item.status}</span>
              </td>
              <td className="px-4 py-3 text-neutral-300">{item.callCount}</td>
              <td className="px-4 py-3 text-neutral-300">{formatDuration(item.totalDurationMs)}</td>
              <td className="px-4 py-3 text-neutral-300">{item.language}</td>
              <td className="px-4 py-3 text-neutral-400">{formatDate(item.startedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CallsTable({ items }: { items: CallListItem[] }) {
  if (items.length === 0) return <EmptyState label="No AI calls recorded yet." />;

  return (
    <div className="overflow-x-auto rounded-lg border border-white/10">
      <table className="w-full min-w-[920px] text-left text-sm">
        <thead className="bg-white/[0.04] text-xs uppercase text-neutral-500">
          <tr>
            <th className="px-4 py-3">Model</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">HTTP</th>
            <th className="px-4 py-3">Duration</th>
            <th className="px-4 py-3">Created</th>
            <th className="px-4 py-3">Error</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {items.map((item) => (
            <tr key={item.id} className="bg-neutral-950/40">
              <td className="px-4 py-3 font-medium text-neutral-100">{item.model || '-'}</td>
              <td className="px-4 py-3 text-neutral-300">{item.callType}</td>
              <td className="px-4 py-3">
                <span className={`rounded-full border px-2 py-1 text-xs ${statusClass(item.status)}`}>{item.status}</span>
              </td>
              <td className="px-4 py-3 text-neutral-300">{item.statusCode}</td>
              <td className="px-4 py-3 text-neutral-300">{formatDuration(item.durationMs)}</td>
              <td className="px-4 py-3 text-neutral-400">{formatDate(item.createdAt)}</td>
              <td className="max-w-[260px] truncate px-4 py-3 text-neutral-500">{item.errorMessage || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UsersTable({ items }: { items: UserListItem[] }) {
  const [hideBot, setHideBot] = useState(false);
  const filtered = hideBot ? items.filter((item) => item.userType !== 'bot') : items;

  if (items.length === 0) return <EmptyState label="No anonymous users recorded yet." />;

  const botCount = items.filter((item) => item.userType === 'bot').length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-400">
          <input
            type="checkbox"
            checked={hideBot}
            onChange={(e) => setHideBot(e.target.checked)}
            className="accent-indigo-500"
          />
          Hide bots ({botCount})
        </label>
        <span className="text-xs text-neutral-600">
          {filtered.length} of {items.length} shown
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-white/[0.04] text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-4 py-3">Visitor</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Comparisons</th>
              <th className="px-4 py-3">AI Calls</th>
              <th className="px-4 py-3">First Seen</th>
              <th className="px-4 py-3">Last Seen</th>
              <th className="px-4 py-3">User Agent</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {filtered.map((item) => (
              <tr key={item.visitorId} className="bg-neutral-950/40">
                <td className="px-4 py-3 font-medium text-neutral-100">{item.visitorId}</td>
                <td className="px-4 py-3">
                  {item.userType === 'bot' ? (
                    <span className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">Bot</span>
                  ) : (
                    <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">User</span>
                  )}
                </td>
                <td className="px-4 py-3 text-neutral-300">{item.comparisonCount}</td>
                <td className="px-4 py-3 text-neutral-300">{item.aiCallCount}</td>
                <td className="px-4 py-3 text-neutral-400">{formatDate(item.firstSeenAt)}</td>
                <td className="px-4 py-3 text-neutral-400">{formatDate(item.lastSeenAt)}</td>
                <td className="max-w-[280px] truncate px-4 py-3 text-neutral-500">{item.userAgent || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ReportsTable({ items, onDelete }: { items: ReportListItem[]; onDelete: (reportId: string) => void }) {
  if (items.length === 0) return <EmptyState label="No reports saved yet." />;

  return (
    <div className="overflow-x-auto rounded-lg border border-white/10">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="bg-white/[0.04] text-xs uppercase text-neutral-500">
          <tr>
            <th className="px-4 py-3">Report</th>
            <th className="px-4 py-3">Language</th>
            <th className="px-4 py-3">Views</th>
            <th className="px-4 py-3">Created</th>
            <th className="px-4 py-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {items.map((item) => (
            <tr key={item.reportId} className="bg-neutral-950/40">
              <td className="px-4 py-3 font-medium text-neutral-100">
                {item.itemA} <span className="text-neutral-500">vs</span> {item.itemB}
                <div className="mt-1 max-w-[320px] truncate text-xs font-normal text-neutral-500">{item.reportId}</div>
              </td>
              <td className="px-4 py-3 text-neutral-300">{item.language}</td>
              <td className="px-4 py-3 text-neutral-300">{item.viewCount}</td>
              <td className="px-4 py-3 text-neutral-400">{formatDate(item.createdAt)}</td>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <a
                    href={`/r/${item.reportId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg border border-white/10 px-2 py-1 text-xs text-neutral-300 transition hover:bg-white/10"
                  >
                    <FileText size={14} />
                  </a>
                  <button
                    type="button"
                    onClick={() => onDelete(item.reportId)}
                    className="rounded-lg border border-red-500/20 px-2 py-1 text-xs text-red-400 transition hover:bg-red-500/20"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminApp() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [calls, setCalls] = useState<CallListItem[]>([]);
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [featured, setFeatured] = useState<FeaturedComparison[]>([]);
  const [generatingIds, setGeneratingIds] = useState<Set<number>>(new Set());
  const [generatingProgress, setGeneratingProgress] = useState<Record<number, string>>({});
  const [newItemA, setNewItemA] = useState('');
  const [newItemB, setNewItemB] = useState('');
  const [newLang, setNewLang] = useState('en');
  const [newDesc, setNewDesc] = useState('');
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadDashboard = async () => {
    setLoading(true);
    setError('');
    try {
      const [summaryData, runsData, callsData, usersData, reportsData, featuredData] = await Promise.all([
        getAdminSummary(),
        getAdminRuns(),
        getAdminCalls(),
        getAdminUsers(),
        getAdminReports(),
        getAdminFeatured(),
      ]);
      setSummary(summaryData);
      setRuns(runsData.items);
      setCalls(callsData.items);
      setUsers(usersData.items);
      setReports(reportsData.items);
      setFeatured(featuredData.items);
    } catch (loadError: any) {
      setError(loadError.message || 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    getAdminSession().then((session) => {
      setAuthenticated(session.authenticated);
      if (session.authenticated) {
        loadDashboard();
      } else {
        setLoading(false);
      }
    });
  }, []);

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await loginAdmin(password);
      setAuthenticated(true);
      setPassword('');
      await loadDashboard();
    } catch (loginError: any) {
      setError(loginError.message || 'Invalid password');
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await logoutAdmin().catch(() => undefined);
    setAuthenticated(false);
    setSummary(null);
    setRuns([]);
    setCalls([]);
    setUsers([]);
    setReports([]);
    setFeatured([]);
  };

  const handleDeleteReport = async (reportId: string) => {
    if (!confirm(`Delete report ${reportId}?`)) return;
    try {
      await deleteAdminReport(reportId);
      setReports((prev) => prev.filter((r) => r.reportId !== reportId));
    } catch (deleteError: any) {
      setError(deleteError.message || 'Failed to delete report');
    }
  };

  const handleAddFeatured = async (event: FormEvent) => {
    event.preventDefault();
    if (!newItemA.trim() || !newItemB.trim()) return;
    const itemA = newItemA.trim();
    const itemB = newItemB.trim();
    const lang = newLang;
    const desc = newDesc.trim();
    try {
      const created = await addAdminFeatured(itemA, itemB, lang, desc);
      setFeatured((prev) => [...prev, created]);
      setNewItemA('');
      setNewItemB('');
      setNewDesc('');

      // Auto-generate report in background
      generateReportForFeatured(created.id, itemA, itemB, lang);
    } catch (addError: any) {
      setError(addError.message || 'Failed to add featured comparison');
    }
  };

  const generateReportForFeatured = async (featuredId: number, itemA: string, itemB: string, language: string) => {
    setGeneratingIds((prev) => new Set(prev).add(featuredId));
    setGeneratingProgress((prev) => ({ ...prev, [featuredId]: 'Starting...' }));
    try {
      const result = await generateComparison(
        itemA,
        itemB,
        (step) => setGeneratingProgress((prev) => ({ ...prev, [featuredId]: step })),
        undefined,
        language,
      );
      const saved = await saveReport({ itemA, itemB, language, result });
      await patchAdminFeatured(featuredId, saved.reportId);
      setFeatured((prev) =>
        prev.map((f) => (f.id === featuredId ? { ...f, reportId: saved.reportId } : f)),
      );
    } catch (genError: any) {
      setError(`Report generation failed for "${itemA} vs ${itemB}": ${genError.message}`);
    } finally {
      setGeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(featuredId);
        return next;
      });
      setGeneratingProgress((prev) => {
        const next = { ...prev };
        delete next[featuredId];
        return next;
      });
    }
  };

  const handleDeleteFeatured = async (id: number) => {
    try {
      await deleteAdminFeatured(id);
      setFeatured((prev) => prev.filter((f) => f.id !== id));
    } catch (deleteError: any) {
      setError(deleteError.message || 'Failed to delete featured comparison');
    }
  };

  if (authenticated === null) {
    return <div className="min-h-screen bg-neutral-950 text-neutral-400" />;
  }

  if (!authenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 text-neutral-100">
        <form onSubmit={handleLogin} className="w-full max-w-sm rounded-lg border border-white/10 bg-white/[0.04] p-6">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300">
              <ShieldCheck size={20} />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-white">CompareAI Admin</h1>
              <p className="text-sm text-neutral-500">Private analytics dashboard</p>
            </div>
          </div>
          <label className="mb-2 block text-sm text-neutral-400" htmlFor="admin-password">
            Password
          </label>
          <input
            id="admin-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mb-4 h-11 w-full rounded-lg border border-white/10 bg-neutral-900 px-3 text-white outline-none focus:border-indigo-400"
            autoComplete="current-password"
            required
          />
          {error && <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
          <button
            type="submit"
            disabled={loading}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
          >
            {loading ? <RefreshCw size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
            Sign in
          </button>
        </form>
      </main>
    );
  }

  const today = summary?.today;
  const tabs: Array<{ key: AdminTab; label: string }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'runs', label: 'Runs' },
    { key: 'reports', label: 'Reports' },
    { key: 'calls', label: 'Calls' },
    { key: 'users', label: 'Users' },
  ];

  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-6 text-neutral-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-col gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-white">CompareAI Admin</h1>
            <p className="mt-1 text-sm text-neutral-500">Operational analytics from the local API proxy.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={loadDashboard}
              disabled={loading}
              className="flex h-10 items-center gap-2 rounded-lg border border-white/10 px-3 text-sm text-neutral-200 transition hover:bg-white/10 disabled:opacity-60"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="flex h-10 items-center gap-2 rounded-lg border border-white/10 px-3 text-sm text-neutral-200 transition hover:bg-white/10"
            >
              <LogOut size={16} />
              Logout
            </button>
          </div>
        </header>

        {error && (
          <div className="mb-5 flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
            <AlertTriangle size={16} />
            {error}
          </div>
        )}

        <div className="mb-6 flex gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1">
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`h-9 rounded-md px-3 text-sm transition ${
                activeTab === tab.key ? 'bg-white/10 text-white' : 'text-neutral-500 hover:text-neutral-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <div className="space-y-6">
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <MetricCard label="Today Users" value={String(today?.users ?? 0)} detail="Anonymous visitors" icon={Users} />
              <MetricCard label="Comparisons" value={String(today?.comparisons ?? 0)} detail="Started today" icon={GitCompareArrows} />
              <MetricCard label="AI Calls" value={String(today?.aiCalls ?? 0)} detail="Proxy requests" icon={Activity} />
              <MetricCard label="Success Rate" value={`${today?.successRate ?? 0}%`} detail={`${today?.failedCalls ?? 0} failed`} icon={BarChart3} />
              <MetricCard label="Avg Latency" value={formatDuration(today?.averageDurationMs ?? 0)} detail="AI proxy duration" icon={Clock3} />
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
                <div className="mb-4 flex items-center gap-2 text-sm font-medium text-neutral-200">
                  <Users size={16} />
                  7-Day Users and Comparisons
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={summary?.trend || []}>
                      <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: '#a3a3a3', fontSize: 12 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fill: '#a3a3a3', fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: '#171717', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8 }} />
                      <Line type="monotone" dataKey="users" stroke="#38bdf8" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="comparisons" stroke="#a78bfa" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
                <div className="mb-4 flex items-center gap-2 text-sm font-medium text-neutral-200">
                  <Database size={16} />
                  7-Day AI Calls
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={summary?.trend || []}>
                      <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: '#a3a3a3', fontSize: 12 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fill: '#a3a3a3', fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: '#171717', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8 }} />
                      <Bar dataKey="aiCalls" fill="#34d399" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div>
                <h2 className="mb-3 text-sm font-medium text-neutral-200">Recent Runs</h2>
                <RunsTable items={summary?.recentRuns || []} />
              </div>
              <div>
                <h2 className="mb-3 text-sm font-medium text-neutral-200">Recent Failed Calls</h2>
                <CallsTable items={summary?.recentFailedCalls || []} />
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-neutral-200">
                <Sparkles size={16} />
                Featured Comparisons
              </div>
              <form onSubmit={handleAddFeatured} className="mb-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newItemA}
                    onChange={(e) => setNewItemA(e.target.value)}
                    placeholder="Item A"
                    className="h-9 flex-1 rounded-lg border border-white/10 bg-neutral-900 px-3 text-sm text-white outline-none focus:border-indigo-400"
                    required
                  />
                  <span className="text-xs text-neutral-500 font-mono">vs</span>
                  <input
                    type="text"
                    value={newItemB}
                    onChange={(e) => setNewItemB(e.target.value)}
                    placeholder="Item B"
                    className="h-9 flex-1 rounded-lg border border-white/10 bg-neutral-900 px-3 text-sm text-white outline-none focus:border-indigo-400"
                    required
                  />
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={newLang}
                    onChange={(e) => setNewLang(e.target.value)}
                    className="h-9 rounded-lg border border-white/10 bg-neutral-900 px-3 text-sm text-white outline-none focus:border-indigo-400"
                  >
                    <option value="en">EN</option>
                    <option value="zh-CN">简体</option>
                    <option value="zh-TW">繁体</option>
                  </select>
                  <input
                    type="text"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="Short description (optional)"
                    className="h-9 flex-1 rounded-lg border border-white/10 bg-neutral-900 px-3 text-sm text-white outline-none focus:border-indigo-400"
                  />
                  <button
                    type="submit"
                    className="flex h-9 items-center gap-1 rounded-lg bg-indigo-600 px-3 text-sm font-medium text-white transition hover:bg-indigo-500"
                  >
                    <Plus size={14} />
                    Add
                  </button>
                </div>
              </form>
              {featured.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {featured.map((item) => {
                    const isGenerating = generatingIds.has(item.id);
                    const progress = generatingProgress[item.id];
                    return (
                      <div key={item.id} className="flex items-start justify-between rounded-lg border border-white/10 bg-white/[0.04] p-4">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-white">
                            {item.itemA} <span className="text-neutral-500">vs</span> {item.itemB}
                          </div>
                          {item.description && (
                            <div className="mt-1 truncate text-xs text-neutral-500">{item.description}</div>
                          )}
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-neutral-400">{item.language}</span>
                            {isGenerating ? (
                              <span className="flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                                <Loader2 size={10} className="animate-spin" />
                                {progress || 'Generating...'}
                              </span>
                            ) : item.reportId ? (
                              <a
                                href={`/r/${item.reportId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300 transition hover:bg-emerald-500/20"
                              >
                                <Check size={10} />
                                Report
                              </a>
                            ) : (
                              <button
                                type="button"
                                onClick={() => generateReportForFeatured(item.id, item.itemA, item.itemB, item.language)}
                                className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] text-indigo-300 transition hover:bg-indigo-500/20"
                              >
                                Generate
                              </button>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteFeatured(item.id)}
                          disabled={isGenerating}
                          className="ml-2 shrink-0 rounded-lg border border-red-500/20 p-1.5 text-red-400 transition hover:bg-red-500/20 disabled:opacity-30"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <EmptyState label="No featured comparisons yet. Add some above to show as recommendations." />
              )}
            </section>
          </div>
        )}

        {activeTab === 'runs' && <RunsTable items={runs} />}
        {activeTab === 'reports' && <ReportsTable items={reports} onDelete={handleDeleteReport} />}
        {activeTab === 'calls' && <CallsTable items={calls} />}
        {activeTab === 'users' && <UsersTable items={users} />}
      </div>
    </main>
  );
}
