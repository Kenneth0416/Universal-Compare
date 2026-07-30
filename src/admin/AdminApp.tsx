import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Check,
  Clock3,
  Database,
  Eye,
  FileText,
  Gauge,
  GitCompareArrows,
  Layers,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
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
  backfillSources,
  preflightFeatured,
  getEntities,
  addEntity,
  bulkAddEntities,
  deleteEntity,
  syncCandidates,
  listCandidates,
  bulkPreflightCandidates,
  bulkPromoteCandidates,
} from './adminApi';
import { generateComparison } from '../services/geminiService';
import { saveReport } from '../services/reportService';
import { finishComparisonRun, startComparisonRun } from '../services/trackingService';
import type {
  AdminPeriodDays,
  AdminSummary,
  CallListItem,
  CandidatePair,
  CandidatePairStatus,
  DemandSenseResult,
  Entity,
  FeaturedComparison,
  ReportListItem,
  RunListItem,
  UserListItem,
} from './types';
import { parseCandidateSignals } from './types';

type AdminTab = 'overview' | 'runs' | 'calls' | 'users' | 'reports' | 'pool';

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

function formatTokens(value: number) {
  const tokens = Math.max(Number(value) || 0, 0);
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(Math.round(tokens));
}

function formatCost(value: number) {
  const cost = Math.max(Number(value) || 0, 0);
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function createIdempotencyKey(action: string) {
  const unique = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `admin-${action}-${unique}`;
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
      <table className="w-full min-w-[1040px] text-left text-sm">
        <thead className="bg-white/[0.04] text-xs uppercase text-neutral-500">
          <tr>
            <th className="px-4 py-3">Comparison</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Calls</th>
            <th className="px-4 py-3">Tokens</th>
            <th className="px-4 py-3">Cost</th>
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
              <td className="px-4 py-3 text-neutral-300">{formatTokens(item.totalTokens)}</td>
              <td className="px-4 py-3 text-neutral-300">{formatCost(item.totalCostUsd)}</td>
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
      <table className="w-full min-w-[1240px] text-left text-sm">
        <thead className="bg-white/[0.04] text-xs uppercase text-neutral-500">
          <tr>
            <th className="px-4 py-3">Model</th>
            <th className="px-4 py-3">Type</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Tokens</th>
            <th className="px-4 py-3">Cost</th>
            <th className="px-4 py-3">Tools</th>
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
              <td className="px-4 py-3 text-neutral-300">
                {formatTokens(item.totalTokens)}
                <div className="mt-1 text-xs text-neutral-500">
                  In {formatTokens(item.promptTokens)} / Out {formatTokens(item.completionTokens + item.reasoningTokens)}
                </div>
              </td>
              <td className="px-4 py-3 text-neutral-300">
                {formatCost(item.costUsd)}
                <div className="mt-1 text-xs text-neutral-500">{item.costSource}</div>
              </td>
              <td className="px-4 py-3 text-neutral-300">
                W {item.webSearchCount}
                <span className="mx-1 text-neutral-600">/</span>
                X {item.xSearchCount}
                <div className="mt-1 max-w-[180px] truncate text-xs text-neutral-500" title={item.toolUsageJson || undefined}>
                  {item.toolUsageJson || '-'}
                </div>
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

function ReportsTable({
  items,
  onDelete,
  onFeature,
  isFeatureBusy,
}: {
  items: ReportListItem[];
  onDelete: (reportId: string) => void;
  onFeature: (item: ReportListItem) => void;
  isFeatureBusy: (reportId: string) => boolean;
}) {
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
                    aria-label={`View report ${item.itemA} versus ${item.itemB}`}
                    className="rounded-lg border border-white/10 px-2 py-1 text-xs text-neutral-300 transition hover:bg-white/10"
                  >
                    <FileText size={14} />
                  </a>
                  <button
                    type="button"
                    onClick={() => onFeature(item)}
                    disabled={isFeatureBusy(item.reportId)}
                    aria-label={`Add ${item.itemA} versus ${item.itemB} to featured`}
                    className="rounded-lg border border-indigo-500/20 px-2 py-1 text-xs text-indigo-400 transition hover:bg-indigo-500/20 disabled:opacity-50"
                    title="Add to featured"
                  >
                    <Sparkles size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(item.reportId)}
                    aria-label={`Delete report ${item.itemA} versus ${item.itemB}`}
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
  const [pendingReports, setPendingReports] = useState<Record<number, { reportId: string; runId?: string }>>({});
  const [backfillingIds, setBackfillingIds] = useState<Set<number>>(new Set());
  const [newItemA, setNewItemA] = useState('');
  const [newItemB, setNewItemB] = useState('');
  const [newLang, setNewLang] = useState('en');
  const [newDesc, setNewDesc] = useState('');

  type PreflightState =
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'success'; result: DemandSenseResult }
    | { kind: 'error'; message: string };
  const [preflightState, setPreflightState] = useState<PreflightState>({ kind: 'idle' });

  const [poolEntities, setPoolEntities] = useState<Entity[]>([]);
  const [poolCategories, setPoolCategories] = useState<string[]>([]);
  const [poolCategoryFilter, setPoolCategoryFilter] = useState<string>('');
  const [poolNewName, setPoolNewName] = useState('');
  const [poolNewCategory, setPoolNewCategory] = useState('');
  const [poolCsvText, setPoolCsvText] = useState('');
  const [poolCsvBusy, setPoolCsvBusy] = useState(false);
  const [poolCsvMsg, setPoolCsvMsg] = useState<string | null>(null);

  const [candidates, setCandidates] = useState<CandidatePair[]>([]);
  const [candidateStatusFilter, setCandidateStatusFilter] = useState<CandidatePairStatus | 'all'>('all');
  const [candidateMinScore, setCandidateMinScore] = useState<number>(0);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<'idle' | 'preflighting' | 'promoting' | 'syncing'>('idle');
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [periodDays, setPeriodDays] = useState<AdminPeriodDays>(1);
  const [loginSubmitting, setLoginSubmitting] = useState(false);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [poolLoading, setPoolLoading] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState('');
  const [error, setError] = useState('');

  const actionLocksRef = useRef<Set<string>>(new Set());
  const [actionLocks, setActionLocks] = useState<Set<string>>(new Set());
  const loginLockRef = useRef(false);
  const dashboardRequestRef = useRef<{ generation: number; controller: AbortController } | null>(null);
  const generationControllersRef = useRef<Map<number, AbortController>>(new Map());
  const poolRequestRef = useRef<{ generation: number; controller: AbortController } | null>(null);
  const requestGenerationRef = useRef({ dashboard: 0, pool: 0 });
  const poolFiltersRef = useRef({
    category: poolCategoryFilter,
    status: candidateStatusFilter,
    minScore: candidateMinScore,
  });
  poolFiltersRef.current = {
    category: poolCategoryFilter,
    status: candidateStatusFilter,
    minScore: candidateMinScore,
  };
  const errorRef = useRef<HTMLDivElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const acquireAction = (key: string) => {
    if (actionLocksRef.current.has(key)) return false;
    actionLocksRef.current.add(key);
    setActionLocks(new Set(actionLocksRef.current));
    return true;
  };

  const releaseAction = (key: string) => {
    actionLocksRef.current.delete(key);
    setActionLocks(new Set(actionLocksRef.current));
  };

  const loadDashboard = async (period: AdminPeriodDays = periodDays) => {
    dashboardRequestRef.current?.controller.abort();
    const generation = ++requestGenerationRef.current.dashboard;
    const controller = new AbortController();
    dashboardRequestRef.current = { generation, controller };
    setDashboardLoading(true);
    setError('');
    try {
      const options = { signal: controller.signal };
      const [summaryData, runsData, callsData, usersData, reportsData, featuredData] = await Promise.all([
        getAdminSummary(period, options),
        getAdminRuns(options),
        getAdminCalls(options),
        getAdminUsers(options),
        getAdminReports(options),
        getAdminFeatured(options),
      ]);
      if (controller.signal.aborted || requestGenerationRef.current.dashboard !== generation) return;
      setSummary(summaryData);
      setRuns(runsData.items);
      setCalls(callsData.items);
      setUsers(usersData.items);
      setReports(reportsData.items);
      setFeatured(featuredData.items);
    } catch (loadError: any) {
      if (!controller.signal.aborted && requestGenerationRef.current.dashboard === generation) {
        setError(loadError.message || 'Failed to load admin data');
      }
    } finally {
      if (requestGenerationRef.current.dashboard === generation) {
        setDashboardLoading(false);
      }
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    getAdminSession({ signal: controller.signal }).then((session) => {
      if (controller.signal.aborted) return;
      setAuthenticated(session.authenticated);
      if (session.authenticated) loadDashboard();
    }).catch(() => undefined);

    return () => {
      controller.abort();
      dashboardRequestRef.current?.controller.abort();
      poolRequestRef.current?.controller.abort();
      for (const generationController of generationControllersRef.current.values()) generationController.abort();
      generationControllersRef.current.clear();
    };
    // The initial dashboard request must only run after the session check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPool = async () => {
    poolRequestRef.current?.controller.abort();
    const generation = ++requestGenerationRef.current.pool;
    const controller = new AbortController();
    poolRequestRef.current = { generation, controller };
    setPoolLoading(true);
    const filters = poolFiltersRef.current;
    try {
      const [ents, cands] = await Promise.all([
        getEntities(filters.category || undefined, { signal: controller.signal }),
        listCandidates({
          category: filters.category || undefined,
          status: filters.status === 'all' ? undefined : filters.status,
          minScore: filters.minScore > 0 ? filters.minScore : undefined,
          limit: 200,
          offset: 0,
          signal: controller.signal,
        }),
      ]);
      if (controller.signal.aborted || requestGenerationRef.current.pool !== generation) return;
      setPoolEntities(ents.items);
      setPoolCategories(ents.categories);
      setCandidates(cands.items);
      const actionableIds = new Set(cands.items.filter((item) => item.status !== 'promoted').map((item) => item.id));
      setSelectedCandidateIds((previous) => new Set([...previous].filter((id) => actionableIds.has(id))));
    } catch (loadErr: any) {
      if (!controller.signal.aborted && requestGenerationRef.current.pool === generation) {
        setError(loadErr.message || 'Failed to load pool');
      }
    } finally {
      if (requestGenerationRef.current.pool === generation) setPoolLoading(false);
    }
  };

  useEffect(() => {
    if (authenticated && activeTab === 'pool') {
      loadPool();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, activeTab, poolCategoryFilter, candidateStatusFilter, candidateMinScore]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const visibleSelectedIds = candidates
    .filter((candidate) => candidate.status !== 'promoted' && selectedCandidateIds.has(candidate.id))
    .map((candidate) => candidate.id);

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    if (loginLockRef.current) return;
    loginLockRef.current = true;
    setError('');
    setSubmissionStatus('Signing in...');
    setLoginSubmitting(true);
    try {
      await loginAdmin(password);
      setAuthenticated(true);
      setPassword('');
      setSubmissionStatus('Signed in. Loading dashboard...');
      await loadDashboard();
    } catch (loginError: any) {
      setError(loginError.message || 'Invalid password');
      setSubmissionStatus('Sign in failed.');
      requestAnimationFrame(() => passwordRef.current?.focus());
    } finally {
      loginLockRef.current = false;
      setLoginSubmitting(false);
    }
  };

  const handleLogout = async () => {
    dashboardRequestRef.current?.controller.abort();
    poolRequestRef.current?.controller.abort();
    for (const controller of generationControllersRef.current.values()) controller.abort();
    generationControllersRef.current.clear();
    requestGenerationRef.current.dashboard += 1;
    requestGenerationRef.current.pool += 1;
    setDashboardLoading(false);
    setPoolLoading(false);
    await logoutAdmin().catch(() => undefined);
    setAuthenticated(false);
    setSummary(null);
    setRuns([]);
    setCalls([]);
    setUsers([]);
    setReports([]);
    setFeatured([]);
    setCandidates([]);
    setSelectedCandidateIds(new Set());
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

  const handleFeatureReport = async (item: ReportListItem) => {
    const actionKey = `feature-report-${item.reportId}`;
    if (featured.some((f) => f.reportId === item.reportId) || !acquireAction(actionKey)) return;
    setSubmissionStatus(`Adding ${item.itemA} vs ${item.itemB} to featured...`);
    try {
      const created = await addAdminFeatured(
        item.itemA,
        item.itemB,
        item.language,
        '',
        item.reportId,
        createIdempotencyKey('feature-report'),
      );
      setFeatured((prev) => [...prev, created]);
      setSubmissionStatus(`${item.itemA} vs ${item.itemB} added to featured.`);
    } catch (featureError: any) {
      setError(featureError.message || 'Failed to feature report');
      setSubmissionStatus('Adding report to featured failed.');
    } finally {
      releaseAction(actionKey);
    }
  };

  const handleAddPoolEntity = async (event: FormEvent) => {
    event.preventDefault();
    if (!poolNewName.trim() || !poolNewCategory.trim()) return;
    try {
      await addEntity(poolNewName.trim(), poolNewCategory.trim());
      setPoolNewName('');
      setPoolNewCategory('');
      await loadPool();
    } catch (addError: any) {
      setError(addError.message || 'Failed to add entity');
    }
  };

  const handleImportCsv = async () => {
    const csv = poolCsvText.trim();
    if (!csv || !acquireAction('csv-import')) return;
    setPoolCsvBusy(true);
    setPoolCsvMsg('Importing CSV...');
    try {
      const result = await bulkAddEntities(csv, createIdempotencyKey('csv-import'));
      setPoolCsvMsg(`Added ${result.added.length}, skipped ${result.skipped.length}`);
      setPoolCsvText('');
      await loadPool();
    } catch (importError: any) {
      setError(importError.message || 'CSV import failed');
      setPoolCsvMsg('CSV import failed.');
    } finally {
      setPoolCsvBusy(false);
      releaseAction('csv-import');
    }
  };

  const handleDeleteEntity = async (id: number) => {
    try {
      await deleteEntity(id);
      await loadPool();
    } catch (deleteError: any) {
      setError(deleteError.message || 'Failed to delete entity');
    }
  };

  const handleSyncCandidates = async () => {
    if (!acquireAction('candidate-bulk')) return;
    setBulkBusy('syncing');
    setBulkMsg('Syncing candidate pairs...');
    try {
      const result = await syncCandidates(poolCategoryFilter || undefined, createIdempotencyKey('candidate-sync'));
      setBulkMsg(`${result.created} new pairs added (${result.total} total possible)`);
      await loadPool();
    } catch (syncError: any) {
      setError(syncError.message || 'Sync failed');
      setBulkMsg('Candidate sync failed.');
    } finally {
      setBulkBusy('idle');
      releaseAction('candidate-bulk');
    }
  };

  const toggleSelected = (id: number) => {
    setSelectedCandidateIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkPreflight = async () => {
    const ids = [...visibleSelectedIds];
    if (ids.length === 0 || !acquireAction('candidate-bulk')) return;
    if (ids.length > 50) {
      setError('Max 50 visible pairs per batch');
      releaseAction('candidate-bulk');
      return;
    }
    if (!confirm(`Run paid demand checks for ${ids.length} currently visible pair${ids.length === 1 ? '' : 's'}?`)) {
      releaseAction('candidate-bulk');
      return;
    }
    setBulkBusy('preflighting');
    setBulkMsg(`Confirmed ${ids.length} visible pairs. Scoring...`);
    try {
      const result = await bulkPreflightCandidates(ids, 'en', createIdempotencyKey('bulk-preflight'));
      const scored = result.results.filter((r) => r.status === 'scored').length;
      const errs = result.results.filter((r) => r.status === 'error').length;
      setBulkMsg(`Submitted ${ids.length} visible pairs. Done: ${scored} scored, ${errs} errors`);
      setSelectedCandidateIds(new Set());
      await loadPool();
    } catch (pfError: any) {
      setError(pfError.message || 'Bulk preflight failed');
      setBulkMsg(`Bulk preflight failed for ${ids.length} visible pairs.`);
    } finally {
      setBulkBusy('idle');
      releaseAction('candidate-bulk');
    }
  };

  const handleBulkPromote = async () => {
    const ids = [...visibleSelectedIds];
    if (ids.length === 0 || !acquireAction('candidate-bulk')) return;
    if (ids.length > 50) {
      setError('Max 50 visible pairs per batch');
      releaseAction('candidate-bulk');
      return;
    }
    if (!confirm(`Promote ${ids.length} currently visible pair${ids.length === 1 ? '' : 's'}?`)) {
      releaseAction('candidate-bulk');
      return;
    }
    setBulkBusy('promoting');
    setBulkMsg(`Confirmed ${ids.length} visible pairs. Promoting...`);
    try {
      const result = await bulkPromoteCandidates(ids, 'en', undefined, createIdempotencyKey('bulk-promote'));
      setBulkMsg(`Submitted ${ids.length} visible pairs. Promoted ${result.promoted.length}, skipped ${result.skipped.length}`);
      setSelectedCandidateIds(new Set());
      await loadPool();
    } catch (promoteError: any) {
      setError(promoteError.message || 'Bulk promote failed');
      setBulkMsg(`Bulk promote failed for ${ids.length} visible pairs.`);
    } finally {
      setBulkBusy('idle');
      releaseAction('candidate-bulk');
    }
  };

  const handleCheckDemand = async () => {
    if (!newItemA.trim() || !newItemB.trim() || !acquireAction('featured-preflight')) return;
    setPreflightState({ kind: 'loading' });
    try {
      const result = await preflightFeatured(
        newItemA.trim(),
        newItemB.trim(),
        newLang,
        createIdempotencyKey('featured-preflight'),
      );
      setPreflightState({ kind: 'success', result });
    } catch (err: any) {
      setPreflightState({
        kind: 'error',
        message: err.message || 'Demand check failed',
      });
    } finally {
      releaseAction('featured-preflight');
    }
  };

  const handleAddFeatured = async (event: FormEvent) => {
    event.preventDefault();
    if (!newItemA.trim() || !newItemB.trim() || !acquireAction('add-featured')) return;
    const itemA = newItemA.trim();
    const itemB = newItemB.trim();
    const lang = newLang;
    const desc = newDesc.trim();
    setSubmissionStatus(`Adding ${itemA} vs ${itemB}...`);
    try {
      const created = await addAdminFeatured(
        itemA,
        itemB,
        lang,
        desc,
        undefined,
        createIdempotencyKey('add-featured'),
      );
      setFeatured((prev) => [...prev, created]);
      setNewItemA('');
      setNewItemB('');
      setNewDesc('');
      setPreflightState({ kind: 'idle' });
      setSubmissionStatus(`${itemA} vs ${itemB} added. Report generation started.`);

      // Auto-generate report in background.
      void generateReportForFeatured(created.id, itemA, itemB, lang);
    } catch (addError: any) {
      setError(addError.message || 'Failed to add featured comparison');
      setSubmissionStatus('Adding featured comparison failed.');
    } finally {
      releaseAction('add-featured');
    }
  };

  const generateReportForFeatured = async (featuredId: number, itemA: string, itemB: string, language: string) => {
    const actionKey = `generate-report-${featuredId}`;
    if (!acquireAction(actionKey)) return;
    setGeneratingIds((prev) => new Set(prev).add(featuredId));
    setGeneratingProgress((prev) => ({ ...prev, [featuredId]: 'Starting...' }));
    setSubmissionStatus(`Generating report for ${itemA} vs ${itemB}...`);
    const controller = new AbortController();
    generationControllersRef.current.set(featuredId, controller);
    let runId: string | undefined;
    let reportSaved = false;
    try {
      const pendingReport = pendingReports[featuredId];
      if (pendingReport) {
        reportSaved = true;
        runId = pendingReport.runId;
        await patchAdminFeatured(featuredId, pendingReport.reportId, { signal: controller.signal });
        if (pendingReport.runId) {
          await finishComparisonRun({ runId: pendingReport.runId, status: 'completed' });
        }
        setFeatured((prev) => prev.map((item) =>
          item.id === featuredId ? { ...item, reportId: pendingReport.reportId } : item));
        setPendingReports((prev) => {
          const next = { ...prev };
          delete next[featuredId];
          return next;
        });
        setSubmissionStatus(`Saved report for ${itemA} vs ${itemB} was linked successfully.`);
        return;
      }

      const trackedRun = await startComparisonRun({ itemA, itemB, language, signal: controller.signal }).catch(() => null);
      runId = trackedRun?.runId;
      const result = await generateComparison(
        itemA,
        itemB,
        (progress) => {
          setGeneratingProgress((prev) => ({ ...prev, [featuredId]: progress.key }));
          setSubmissionStatus(`Generating ${itemA} vs ${itemB}: ${progress.key}.`);
        },
        undefined,
        language,
        runId,
        controller.signal,
      );
      const saved = await saveReport({ runId, itemA, itemB, language, result, signal: controller.signal });
      reportSaved = true;
      setPendingReports((prev) => ({
        ...prev,
        [featuredId]: { reportId: saved.reportId, ...(runId ? { runId } : {}) },
      }));
      await patchAdminFeatured(featuredId, saved.reportId, { signal: controller.signal });
      setFeatured((prev) =>
        prev.map((f) => (f.id === featuredId ? { ...f, reportId: saved.reportId } : f)),
      );
      setPendingReports((prev) => {
        const next = { ...prev };
        delete next[featuredId];
        return next;
      });
      if (runId) await finishComparisonRun({ runId, status: 'completed' }).catch(() => undefined);
      setSubmissionStatus(`Report for ${itemA} vs ${itemB} is ready.`);
    } catch (genError: any) {
      if (controller.signal.aborted) {
        if (runId && !reportSaved) {
          await finishComparisonRun({ runId, status: 'failed', errorMessage: 'Generation cancelled' }).catch(() => undefined);
        }
        return;
      }
      if (runId && !reportSaved) {
        await finishComparisonRun({
          runId,
          status: 'failed',
          errorMessage: genError instanceof Error ? genError.message : 'Report generation failed',
        }).catch(() => undefined);
      }
      setError(`Report generation failed for "${itemA} vs ${itemB}": ${genError.message}`);
      setSubmissionStatus(reportSaved
        ? `Report was saved but could not be linked. Use Generate again to retry linking without another AI run.`
        : `Report generation failed for ${itemA} vs ${itemB}.`);
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
      generationControllersRef.current.delete(featuredId);
      releaseAction(actionKey);
    }
  };

  const handleBackfillFeatured = async (item: FeaturedComparison) => {
    if (!item.reportId) return;
    const actionKey = `backfill-${item.id}`;
    if (!acquireAction(actionKey)) return;
    setBackfillingIds((prev) => new Set(prev).add(item.id));
    setSubmissionStatus(`Backfilling sources for ${item.itemA} vs ${item.itemB}...`);
    try {
      const result = await backfillSources(item.reportId, createIdempotencyKey('backfill-sources'));
      setFeatured((prev) =>
        prev.map((featuredItem) =>
          featuredItem.id === item.id
            ? {
                ...featuredItem,
                hasSources: result.sourcesCount > 0,
                hasCitations: result.dimensionsUpdated > 0,
              }
            : featuredItem,
        ),
      );
      setSubmissionStatus(
        `Backfilled ${item.itemA} vs ${item.itemB}: ${result.sourcesCount} sources, ${result.dimensionsUpdated} dimensions.`,
      );
    } catch (backfillError: any) {
      setError(`Backfill failed for ${item.itemA} vs ${item.itemB}: ${backfillError.message || 'Unknown error'}`);
      setSubmissionStatus('Source backfill failed.');
    } finally {
      setBackfillingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
      releaseAction(actionKey);
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

  const handlePeriodChange = (days: AdminPeriodDays) => {
    setPeriodDays(days);
    void loadDashboard(days);
  };

  const periodOptions: Array<{ value: AdminPeriodDays; label: string }> = [
    { value: 1, label: '24h' },
    { value: 7, label: '7d' },
    { value: 14, label: '14d' },
    { value: 30, label: '30d' },
    { value: 0, label: 'All' },
  ];

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
            ref={passwordRef}
            id="admin-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mb-4 h-11 w-full rounded-lg border border-white/10 bg-neutral-900 px-3 text-white outline-none focus:border-indigo-400"
            autoComplete="current-password"
            required
          />
          {error && (
            <div
              ref={errorRef}
              role="alert"
              aria-live="assertive"
              tabIndex={-1}
              className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300 outline-none"
            >
              {error}
            </div>
          )}
          <div className="sr-only" role="status" aria-live="polite">{submissionStatus}</div>
          <button
            type="submit"
            disabled={loginSubmitting}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
          >
            {loginSubmitting ? <RefreshCw size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
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
    { key: 'pool', label: 'Pool' },
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
              onClick={() => void loadDashboard()}
              disabled={dashboardLoading}
              className="flex h-10 items-center gap-2 rounded-lg border border-white/10 px-3 text-sm text-neutral-200 transition hover:bg-white/10 disabled:opacity-60"
            >
              <RefreshCw size={16} className={dashboardLoading ? 'animate-spin' : ''} />
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
          <div
            ref={errorRef}
            role="alert"
            aria-live="assertive"
            tabIndex={-1}
            className="mb-5 flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300 outline-none"
          >
            <AlertTriangle size={16} />
            {error}
          </div>
        )}
        <div className="sr-only" role="status" aria-live="polite">{submissionStatus}</div>

        <div className="mb-6 flex gap-1 overflow-x-auto rounded-lg border border-white/10 bg-white/[0.03] p-1">
          {tabs.map((tab) => (
            <button
              type="button"
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`h-9 shrink-0 rounded-md px-3 text-sm transition ${
                activeTab === tab.key ? 'bg-white/10 text-white' : 'text-neutral-500 hover:text-neutral-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="flex max-w-full items-center gap-1 self-start overflow-x-auto rounded-lg border border-white/10 bg-white/[0.03] p-1">
              {periodOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handlePeriodChange(opt.value)}
                  className={`h-8 shrink-0 rounded-md px-3 text-sm transition ${
                    periodDays === opt.value ? 'bg-indigo-600 text-white' : 'text-neutral-500 hover:text-neutral-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
              <MetricCard label="Today Users" value={String(today?.users ?? 0)} detail="Anonymous visitors" icon={Users} />
              <MetricCard label="Comparisons" value={String(today?.comparisons ?? 0)} detail="Started today" icon={GitCompareArrows} />
              <MetricCard label="AI Calls" value={String(today?.aiCalls ?? 0)} detail="Proxy requests" icon={Activity} />
              <MetricCard
                label="Tokens"
                value={formatTokens(today?.totalTokens ?? 0)}
                detail={`In ${formatTokens(today?.promptTokens ?? 0)} / Out ${formatTokens((today?.completionTokens ?? 0) + (today?.reasoningTokens ?? 0))}`}
                icon={Database}
              />
              <MetricCard label="AI Cost" value={formatCost(today?.aiCostUsd ?? 0)} detail="Provider or estimate" icon={BarChart3} />
              <MetricCard
                label="Search Tools"
                value={`W ${today?.webSearchCount ?? 0} / X ${today?.xSearchCount ?? 0}`}
                detail="Server-side tool calls"
                icon={Database}
              />
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
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    type="text"
                    aria-label="Featured item A"
                    value={newItemA}
                    onChange={(e) => setNewItemA(e.target.value)}
                    placeholder="Item A"
                    className="h-9 flex-1 rounded-lg border border-white/10 bg-neutral-900 px-3 text-sm text-white outline-none focus:border-indigo-400"
                    required
                  />
                  <span className="text-xs text-neutral-500 font-mono">vs</span>
                  <input
                    type="text"
                    aria-label="Featured item B"
                    value={newItemB}
                    onChange={(e) => setNewItemB(e.target.value)}
                    placeholder="Item B"
                    className="h-9 flex-1 rounded-lg border border-white/10 bg-neutral-900 px-3 text-sm text-white outline-none focus:border-indigo-400"
                    required
                  />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <select
                    aria-label="Featured comparison language"
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
                    aria-label="Featured comparison description"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="Short description (optional)"
                    className="h-9 flex-1 rounded-lg border border-white/10 bg-neutral-900 px-3 text-sm text-white outline-none focus:border-indigo-400"
                  />
                  <button
                    type="button"
                    onClick={handleCheckDemand}
                    disabled={actionLocks.has('featured-preflight') || !newItemA.trim() || !newItemB.trim()}
                    className="flex h-9 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 text-sm font-medium text-neutral-200 transition hover:bg-white/10 disabled:opacity-50"
                  >
                    {preflightState.kind === 'loading' ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Gauge size={14} />
                    )}
                    Check Demand
                  </button>
                  <button
                    type="submit"
                    disabled={actionLocks.has('add-featured')}
                    className="flex h-9 items-center gap-1 rounded-lg bg-indigo-600 px-3 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
                  >
                    <Plus size={14} />
                    Add
                  </button>
                </div>
                {preflightState.kind === 'error' && (
                  <div role="alert" aria-live="assertive" className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
                    {preflightState.message}
                  </div>
                )}
                {preflightState.kind === 'success' && (
                  <div role="status" aria-live="polite" className="rounded-lg border border-white/10 bg-white/[0.04] p-3 text-xs text-neutral-300">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-md px-2 py-0.5 font-mono text-sm font-semibold ${
                            preflightState.result.score >= 8
                              ? 'bg-green-500/20 text-green-300'
                              : preflightState.result.score >= 6
                              ? 'bg-indigo-500/20 text-indigo-300'
                              : preflightState.result.score >= 4
                              ? 'bg-amber-500/20 text-amber-300'
                              : 'bg-red-500/20 text-red-300'
                          }`}
                        >
                          {preflightState.result.score.toFixed(1)}/10
                        </span>
                        <span className="text-[10px] uppercase tracking-wide text-neutral-500">
                          {preflightState.result.recommendation}
                        </span>
                        {preflightState.result.partial && (
                          <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">
                            partial signal
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-neutral-500">
                        {preflightState.result.metrics.durationMs}ms · {preflightState.result.metrics.totalTokens} tok
                      </span>
                    </div>
                    <p className="mb-2 text-neutral-400">{preflightState.result.reasoning}</p>
                    <ul className="mb-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
                      <li>Articles: <span className="text-neutral-300">{preflightState.result.signals.existing_articles_count}</span></li>
                      <li>Reddit: <span className="text-neutral-300">{preflightState.result.signals.has_reddit_discussion ? 'yes' : 'no'}</span></li>
                      <li>Authoritative: <span className="text-neutral-300">{preflightState.result.signals.has_authoritative_source ? 'yes' : 'no'}</span></li>
                      <li>Competition: <span className="text-neutral-300">{preflightState.result.signals.competition_level}</span></li>
                      <li>Freshness: <span className="text-neutral-300">{preflightState.result.signals.freshness}</span></li>
                    </ul>
                    {preflightState.result.topSources.length > 0 && (
                      <div>
                        <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">Top existing articles</div>
                        <ul className="space-y-0.5 text-[11px]">
                          {preflightState.result.topSources.map((s) => (
                            <li key={s.url} className="truncate">
                              <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-indigo-300 hover:underline">
                                {s.title || s.url}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
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
                            <span
                              className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-neutral-400"
                              title="Views"
                            >
                              <Eye size={10} />
                              {item.viewCount ?? 0} views
                            </span>
                            {isGenerating ? (
                              <span
                                className="flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300"
                                role="status"
                                aria-live="polite"
                              >
                                <Loader2 size={10} className="animate-spin" />
                                {progress || 'Generating...'}
                              </span>
                            ) : item.reportId ? (
                              <>
                                <a
                                  href={`/compare/${item.slug}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300 transition hover:bg-emerald-500/20"
                                >
                                  <Check size={10} />
                                  Report
                                </a>
                                {(!item.hasSources || !item.hasCitations) && (
                                  <button
                                    type="button"
                                    onClick={() => void handleBackfillFeatured(item)}
                                    disabled={backfillingIds.has(item.id)}
                                    className="text-xs text-blue-400 hover:text-blue-300 disabled:text-neutral-600"
                                  >
                                    {backfillingIds.has(item.id) ? 'Backfilling...' : 'Backfill Sources'}
                                  </button>
                                )}
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void generateReportForFeatured(item.id, item.itemA, item.itemB, item.language)}
                                disabled={actionLocks.has(`generate-report-${item.id}`)}
                                className="rounded-full border border-indigo-500/20 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] text-indigo-300 transition hover:bg-indigo-500/20 disabled:opacity-50"
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
                          aria-label={`Delete featured comparison ${item.itemA} versus ${item.itemB}`}
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
        {activeTab === 'reports' && (
          <ReportsTable
            items={reports}
            onDelete={handleDeleteReport}
            onFeature={handleFeatureReport}
            isFeatureBusy={(reportId) => actionLocks.has(`feature-report-${reportId}`)}
          />
        )}
        {activeTab === 'calls' && <CallsTable items={calls} />}
        {activeTab === 'users' && <UsersTable items={users} />}

        {activeTab === 'pool' && (
          <div className="space-y-6">
            <section>
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-neutral-200">
                <Database size={16} /> Entity Pool
              </div>

              <form onSubmit={handleAddPoolEntity} className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  type="text"
                  aria-label="Entity name"
                  value={poolNewName}
                  onChange={(e) => setPoolNewName(e.target.value)}
                  placeholder="Entity name (e.g., ChatGPT)"
                  className="h-9 flex-1 rounded-lg border border-white/10 bg-neutral-900 px-3 text-sm text-white outline-none focus:border-indigo-400"
                  required
                />
                <input
                  type="text"
                  aria-label="Entity category"
                  value={poolNewCategory}
                  onChange={(e) => setPoolNewCategory(e.target.value)}
                  placeholder="Category (e.g., AI Assistant)"
                  className="h-9 flex-1 rounded-lg border border-white/10 bg-neutral-900 px-3 text-sm text-white outline-none focus:border-indigo-400"
                  required
                />
                <button type="submit" className="flex h-9 items-center gap-1 rounded-lg bg-indigo-600 px-3 text-sm font-medium text-white hover:bg-indigo-500">
                  <Plus size={14} /> Add
                </button>
              </form>

              <details className="mb-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-sm">
                <summary className="cursor-pointer text-neutral-300">Bulk import CSV</summary>
                <label htmlFor="pool-csv" className="sr-only">Entity CSV data</label>
                <textarea
                  id="pool-csv"
                  value={poolCsvText}
                  onChange={(e) => setPoolCsvText(e.target.value)}
                  placeholder="name,category&#10;ChatGPT,AI Assistant&#10;Claude,AI Assistant&#10;Gemini,AI Assistant"
                  rows={6}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-neutral-900 p-2 font-mono text-xs text-white outline-none focus:border-indigo-400"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleImportCsv}
                    disabled={poolCsvBusy || actionLocks.has('csv-import') || !poolCsvText.trim()}
                    className="flex h-8 items-center gap-1 rounded-lg bg-indigo-600 px-3 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                  >
                    {poolCsvBusy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                    Import
                  </button>
                  {poolCsvMsg && <span role="status" aria-live="polite" className="text-xs text-neutral-400">{poolCsvMsg}</span>}
                </div>
              </details>

              <div className="mb-2 flex flex-wrap items-center gap-2">
                <select
                  aria-label="Entity category filter"
                  value={poolCategoryFilter}
                  onChange={(e) => {
                    setSelectedCandidateIds(new Set());
                    setPoolCategoryFilter(e.target.value);
                  }}
                  className="h-8 rounded-lg border border-white/10 bg-neutral-900 px-2 text-xs text-white outline-none focus:border-indigo-400"
                >
                  <option value="">All categories</option>
                  {poolCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <span className="text-xs text-neutral-500">
                  {poolLoading ? 'Loading pool...' : `${poolEntities.length} entities`}
                </span>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {poolEntities.map((entity) => (
                  <div key={entity.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
                    <div>
                      <div className="text-sm font-medium text-white">{entity.name}</div>
                      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{entity.category}</div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Delete ${entity.name}`}
                      onClick={() => handleDeleteEntity(entity.id)}
                      className="rounded-lg p-1 text-neutral-500 hover:bg-red-500/10 hover:text-red-300"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-neutral-200">
                  <Layers size={16} /> Candidate Pairs
                </div>
                <button
                  type="button"
                  onClick={handleSyncCandidates}
                  disabled={bulkBusy !== 'idle' || actionLocks.has('candidate-bulk')}
                  className="flex h-8 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium text-neutral-200 hover:bg-white/10 disabled:opacity-50"
                >
                  {bulkBusy === 'syncing' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  Sync from Pool
                </button>
              </div>

              <div className="mb-3 flex flex-wrap items-center gap-2">
                <select
                  aria-label="Candidate status filter"
                  value={candidateStatusFilter}
                  onChange={(e) => {
                    setSelectedCandidateIds(new Set());
                    setCandidateStatusFilter(e.target.value as CandidatePairStatus | 'all');
                  }}
                  className="h-8 rounded-lg border border-white/10 bg-neutral-900 px-2 text-xs text-white outline-none focus:border-indigo-400"
                >
                  <option value="all">All statuses</option>
                  <option value="pending">Pending</option>
                  <option value="scored">Scored</option>
                  <option value="promoted">Promoted</option>
                  <option value="rejected">Rejected</option>
                </select>
                <select
                  aria-label="Candidate minimum score filter"
                  value={candidateMinScore}
                  onChange={(e) => {
                    setSelectedCandidateIds(new Set());
                    setCandidateMinScore(Number(e.target.value));
                  }}
                  className="h-8 rounded-lg border border-white/10 bg-neutral-900 px-2 text-xs text-white outline-none focus:border-indigo-400"
                >
                  <option value="0">Min score: any</option>
                  <option value="4">≥ 4</option>
                  <option value="6">≥ 6</option>
                  <option value="8">≥ 8</option>
                </select>
                <span className="text-xs text-neutral-500">
                  {poolLoading ? 'Loading candidates...' : `${candidates.length} pairs`} · {visibleSelectedIds.length} visible selected
                </span>
                <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                  <button
                    type="button"
                    onClick={handleBulkPreflight}
                    disabled={bulkBusy !== 'idle' || actionLocks.has('candidate-bulk') || visibleSelectedIds.length === 0}
                    className="flex h-8 items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-3 text-xs font-medium text-neutral-200 hover:bg-white/10 disabled:opacity-50"
                  >
                    {bulkBusy === 'preflighting' ? <Loader2 size={12} className="animate-spin" /> : <Gauge size={12} />}
                    Bulk Preflight ({visibleSelectedIds.length})
                  </button>
                  <button
                    type="button"
                    onClick={handleBulkPromote}
                    disabled={bulkBusy !== 'idle' || actionLocks.has('candidate-bulk') || visibleSelectedIds.length === 0}
                    className="flex h-8 items-center gap-1 rounded-lg bg-indigo-600 px-3 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                  >
                    {bulkBusy === 'promoting' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    Bulk Promote ({visibleSelectedIds.length})
                  </button>
                </div>
              </div>

              {bulkMsg && (
                <div role="status" aria-live="polite" className="mb-3 rounded-lg border border-white/10 bg-white/[0.04] p-2 text-xs text-neutral-300">
                  {bulkMsg}
                </div>
              )}

              <div className="max-w-full overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full min-w-[820px] text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-neutral-500">
                      <th className="px-2 py-2 w-8"></th>
                      <th className="px-2 py-2">Pair</th>
                      <th className="px-2 py-2">Category</th>
                      <th className="px-2 py-2">Status</th>
                      <th className="px-2 py-2">Score</th>
                      <th className="px-2 py-2">Recommendation</th>
                      <th className="px-2 py-2">Signals</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((pair) => {
                      const signals = parseCandidateSignals(pair.signalsJson);
                      const checked = selectedCandidateIds.has(pair.id);
                      const canSelect = pair.status !== 'promoted';
                      return (
                        <tr key={pair.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                          <td className="px-2 py-2">
                            <input
                              type="checkbox"
                              aria-label={`Select ${pair.itemAName} versus ${pair.itemBName}`}
                              checked={checked}
                              disabled={!canSelect}
                              onChange={() => toggleSelected(pair.id)}
                            />
                          </td>
                          <td className="px-2 py-2 font-medium text-white">
                            {pair.itemAName} <span className="text-neutral-500">vs</span> {pair.itemBName}
                          </td>
                          <td className="px-2 py-2 text-neutral-400">{pair.category}</td>
                          <td className="px-2 py-2">
                            <span className={`rounded-md px-1.5 py-0.5 text-[10px] uppercase ${
                              pair.status === 'scored' ? 'bg-indigo-500/15 text-indigo-300'
                              : pair.status === 'promoted' ? 'bg-green-500/15 text-green-300'
                              : pair.status === 'rejected' ? 'bg-red-500/15 text-red-300'
                              : 'bg-white/5 text-neutral-400'
                            }`}>
                              {pair.status}
                            </span>
                          </td>
                          <td className="px-2 py-2">
                            {typeof pair.demandScore === 'number' ? (
                              <span className={`rounded-md px-2 py-0.5 font-mono ${
                                pair.demandScore >= 8 ? 'bg-green-500/20 text-green-300'
                                : pair.demandScore >= 6 ? 'bg-indigo-500/20 text-indigo-300'
                                : pair.demandScore >= 4 ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-red-500/20 text-red-300'
                              }`}>
                                {pair.demandScore.toFixed(1)}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="px-2 py-2 text-neutral-400">{pair.recommendation || '—'}</td>
                          <td className="px-2 py-2 text-[10px] text-neutral-500">
                            {signals ? (
                              <span>
                                art:{signals.existing_articles_count} ·
                                rdt:{signals.has_reddit_discussion ? '✓' : '✗'} ·
                                auth:{signals.has_authoritative_source ? '✓' : '✗'}
                              </span>
                            ) : (
                              <span>unavailable</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {candidates.length === 0 && (
                  <div className="rounded-lg border border-dashed border-white/10 p-6 text-center text-xs text-neutral-500">
                    No candidates yet. Add entities above, then click "Sync from Pool".
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
