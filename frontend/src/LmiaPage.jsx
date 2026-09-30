import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  Search, MapPin, Building2, Banknote, Calendar, ExternalLink, Globe2, 
  AlertCircle, CheckCircle, Download, ArrowDownUp, Phone, X, RefreshCw, 
  Briefcase, ChevronLeft, ChevronRight, Laptop, Sparkles, Check, Ban, Tag, 
  Edit3, CalendarDays, UserCheck, FileText, ArrowLeft, LogOut, User,
  CloudUpload, Hash, Mail, BarChart3, Clock, History, Award, CheckCircle2
} from 'lucide-react';

const CANADIAN_PROVINCES = [
  { code: '', label: 'All Canada' },
  { code: 'ON', label: 'Ontario' },
  { code: 'BC', label: 'British Columbia' },
  { code: 'AB', label: 'Alberta' },
  { code: 'QC', label: 'Quebec' },
  { code: 'MB', label: 'Manitoba' },
  { code: 'SK', label: 'Saskatchewan' },
  { code: 'NS', label: 'Nova Scotia' },
  { code: 'NB', label: 'New Brunswick' },
  { code: 'NL', label: 'Newfoundland & Labrador' },
  { code: 'PE', label: 'Prince Edward Island' },
  { code: 'NT', label: 'Northwest Territories' },
  { code: 'YT', label: 'Yukon' },
  { code: 'NU', label: 'Nunavut' },
];

function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

function parseApplicantCodes(rawCode) {
  if (!rawCode) return [];
  if (Array.isArray(rawCode)) {
    return rawCode.map(c => String(c || '').trim().toUpperCase()).filter(Boolean);
  }
  const str = String(rawCode).trim();
  if (!str) return [];
  return str.split(/[\s,]+/).map(c => c.trim().toUpperCase()).filter(Boolean);
}

function formatAppTimestamp(timestamp) {
  if (!timestamp) return '—';
  try {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return String(timestamp);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return String(timestamp);
  }
}

function groupApplicationsByAuthor(applications, fallbackUser, fallbackCodes) {
  if (applications && applications.length > 0) {
    const groups = new Map();
    applications.forEach(app => {
      const author = app.applied_by || fallbackUser || 'Unknown';
      const code = String(app.applicant_code || '').trim().toUpperCase();
      if (!code) return;
      if (!groups.has(author)) groups.set(author, []);
      if (!groups.get(author).includes(code)) {
        groups.get(author).push(code);
      }
    });

    if (groups.size > 0) {
      return Array.from(groups.entries()).map(([author, codes]) => ({ author, codes }));
    }
  }

  const codes = parseApplicantCodes(fallbackCodes);
  if (codes.length > 0) {
    return [{ author: fallbackUser || 'Unknown', codes }];
  }

  return [];
}

export default function LmiaPage({
  currentUser,
  onLogout,
  trackedJobs,
  jobApplications,
  toggleChecked,
  toggleNotRequired,
  openAppliedModal,
  contactInfo,
  fetchContactInfo,
  onNavigateView
}) {
  // LMIA sub-tab: 'all' | 'approved' | 'requested'
  const [subTab, setSubTab] = useState('all');

  const [keyword, setKeyword] = useState('');
  const debouncedKeyword = useDebounce(keyword, 350);
  const [searchQuery, setSearchQuery] = useState('');
  const [province, setProvince] = useState('');
  const [internationalOnly, setInternationalOnly] = useState(true);
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('D');

  const [jobs, setJobs] = useState([]);
  const [totalJobs, setTotalJobs] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Quick stats counters
  const [approvedCount, setApprovedCount] = useState(null);
  const [requestedCount, setRequestedCount] = useState(null);

  const abortControllerRef = useRef(null);

  // Sync debounced keyword -> searchQuery
  const isFirstMountRef = useRef(true);
  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      return;
    }
    setSearchQuery(debouncedKeyword);
    setPage(1);
  }, [debouncedKeyword]);

  const handleInstantSearch = (e) => {
    if (e) e.preventDefault();
    setSearchQuery(keyword);
    setPage(1);
  };

  const handleClearSearch = () => {
    setKeyword('');
    setSearchQuery('');
    setPage(1);
  };

  // Fetch jobs for current subTab and filters
  const fetchLmiaJobs = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
      const params = new URLSearchParams({
        keywords: searchQuery,
        page: String(page),
        sort: sort,
        international_only: internationalOnly ? 'true' : 'false',
        remote: remoteOnly ? 'true' : 'false',
        lmia: subTab // 'all' | 'approved' | 'requested'
      });

      if (province) {
        params.append('province', province);
      }

      const response = await fetch(`${apiUrl}/jobs?${params.toString()}`, {
        signal: controller.signal,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server error: ${response.status}`);
      }

      const data = await response.json();
      if (controller.signal.aborted) return;

      setJobs(data.jobs || []);
      setTotalJobs(data.totalJobs || 0);
      setTotalPages(data.totalPages || 1);

      // Record count for active subTab
      if (subTab === 'approved') {
        setApprovedCount(data.totalJobs || 0);
      } else if (subTab === 'requested') {
        setRequestedCount(data.totalJobs || 0);
      }

      setLoading(false);
    } catch (err) {
      if (err.name === 'AbortError' || controller.signal.aborted) return;
      setError(err.message || 'Failed to fetch LMIA jobs.');
      setJobs([]);
      setLoading(false);
    }
  }, [searchQuery, page, sort, province, internationalOnly, remoteOnly, subTab]);

  useEffect(() => {
    fetchLmiaJobs();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchLmiaJobs]);

  // Pre-fetch count stats on initial mount
  useEffect(() => {
    const fetchQuickCounts = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
        const [appRes, reqRes] = await Promise.all([
          fetch(`${apiUrl}/jobs?lmia=approved&international_only=true`),
          fetch(`${apiUrl}/jobs?lmia=requested&international_only=true`)
        ]);
        if (appRes.ok) {
          const appData = await appRes.json();
          setApprovedCount(appData.totalJobs || 0);
        }
        if (reqRes.ok) {
          const reqData = await reqRes.json();
          setRequestedCount(reqData.totalJobs || 0);
        }
      } catch (e) {
        console.warn('Could not pre-fetch LMIA counts:', e);
      }
    };
    fetchQuickCounts();
  }, []);

  // Helper to look up tracked state
  const getTrackedJob = (jobOrId, maybeUrl, maybeJobNumber) => {
    if (!jobOrId) return null;
    let idStr = '';
    let urlStr = '';
    let numStr = '';

    if (typeof jobOrId === 'object' && jobOrId !== null) {
      idStr = String(jobOrId.jobId || jobOrId.jobNumber || '');
      urlStr = jobOrId.url || '';
      numStr = String(jobOrId.jobNumber || jobOrId.jobId || '');
    } else {
      idStr = String(jobOrId);
      urlStr = maybeUrl || '';
      numStr = String(maybeJobNumber || '');
    }

    const cleanUrl = urlStr ? urlStr.split(';')[0].split('?')[0] : '';

    return (trackedJobs || []).find(j => {
      const jIdStr = String(j.jobId || '');
      const jNumStr = String(j.jobNumber || '');
      if (idStr && (jIdStr === idStr || jNumStr === idStr)) return true;
      if (numStr && (jIdStr === numStr || jNumStr === numStr)) return true;
      if (cleanUrl && j.url) {
        const jClean = j.url.split(';')[0].split('?')[0];
        if (jClean === cleanUrl) return true;
      }
      return false;
    });
  };

  const getApplicationsForJob = (job, tracked) => {
    const ids = new Set([
      String(job?.jobId || ''),
      String(job?.jobNumber || ''),
      String(tracked?.jobId || ''),
      String(tracked?.jobNumber || '')
    ].filter(Boolean));

    if (ids.size === 0) return [];
    return (jobApplications || []).filter(a => ids.has(String(a.job_id)));
  };

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setPage(newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const resetAllFilters = () => {
    setKeyword('');
    setSearchQuery('');
    setProvince('');
    setInternationalOnly(true);
    setRemoteOnly(false);
    setPage(1);
  };

  const hasActiveFilters = Boolean(searchQuery || province || remoteOnly || !internationalOnly);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans selection:bg-amber-200">
      {/* Top Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-sm backdrop-blur-md bg-white/95">
        <div className="max-w-6xl mx-auto px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            {/* Logo and Brand */}
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 via-orange-500 to-red-600 flex items-center justify-center text-white shadow-md shadow-amber-500/20 shrink-0">
                <span className="text-xl">🍁</span>
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                  LMIA Vacancies
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-100 text-amber-800 border border-amber-200">
                    Live Portal
                  </span>
                </h1>
                <p className="text-xs text-slate-500 hidden sm:block">
                  Verified Labour Market Impact Assessment postings on Job Bank Canada
                </p>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-semibold self-start sm:self-auto">
              <button
                type="button"
                onClick={() => onNavigateView('search')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 transition-all"
              >
                <Search className="w-3.5 h-3.5" />
                <span>Search Jobs</span>
              </button>

              <button
                type="button"
                onClick={() => onNavigateView('lmia')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold shadow-xs transition-all"
              >
                <span>🍁</span>
                <span>LMIA Vacancies</span>
                <span className="px-1.5 py-0.2 rounded-full bg-white/20 text-white text-[10px] font-bold">
                  {totalJobs > 0 ? totalJobs.toLocaleString() : 'Live'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => onNavigateView('reports')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 transition-all"
              >
                <BarChart3 className="w-3.5 h-3.5 text-blue-600" />
                <span>Reports & Analytics</span>
                {(trackedJobs || []).length > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full bg-blue-100 text-blue-800 text-[10px] font-bold">
                    {(trackedJobs || []).length}
                  </span>
                )}
              </button>
            </div>

            {/* User Pill & Logout */}
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="flex items-center gap-2 px-2.5 sm:px-3 py-1.5 bg-slate-100 rounded-xl border border-slate-200">
                <div className="w-6 h-6 rounded-full bg-amber-600 flex items-center justify-center text-white text-[10px] font-bold uppercase shrink-0">
                  {currentUser?.username?.[0] || 'U'}
                </div>
                <span className="text-xs font-semibold text-slate-700 capitalize hidden sm:inline">
                  {currentUser?.username || 'User'}
                </span>
              </div>

              <button
                onClick={onLogout}
                className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 text-xs font-semibold text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-xl border border-slate-200 hover:border-red-200 transition-all"
                title="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </div>
          </div>

          {/* Search Row */}
          <form onSubmit={handleInstantSearch} className="flex flex-col sm:flex-row items-center gap-2.5 pt-3">
            <div className="relative flex-1 w-full min-w-0">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <Search className="h-4 w-4" />
              </div>
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="Search LMIA job title, NOC, employer or city (e.g., Farm Worker, Cook, Manager, Toronto)..."
                className="w-full pl-10 pr-9 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 focus:bg-white transition-all shadow-inner"
              />
              {keyword && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                  title="Clear input"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Province Selector */}
            <div className="relative w-full sm:w-56 shrink-0">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <MapPin className="h-4 w-4" />
              </div>
              <select
                value={province}
                onChange={(e) => {
                  setProvince(e.target.value);
                  setPage(1);
                }}
                className="w-full pl-10 pr-8 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 focus:bg-white transition-all appearance-none cursor-pointer"
              >
                {CANADIAN_PROVINCES.map((prov) => (
                  <option key={prov.code} value={prov.code}>
                    {prov.label}
                  </option>
                ))}
              </select>
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none text-slate-400">
                <ChevronRight className="h-4 w-4 rotate-90" />
              </div>
            </div>

            {/* Search Button */}
            <button
              type="submit"
              className="w-full sm:w-auto px-5 py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white text-sm font-bold rounded-xl shadow-sm transition-all flex items-center justify-center gap-1.5 shrink-0 active:scale-95"
            >
              <Search className="w-4 h-4" />
              <span>Search LMIA</span>
            </button>
          </form>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-6xl mx-auto px-4 py-6 sm:px-6 lg:px-8 flex-1 w-full space-y-6">
        {/* LMIA Explanation & Educational Banner */}
        <div className="bg-gradient-to-r from-amber-50 via-orange-50 to-amber-100/50 rounded-2xl p-5 border border-amber-200/80 shadow-xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xl">🍁</span>
                <h2 className="text-base font-bold text-slate-900 tracking-tight">
                  Labour Market Impact Assessment (LMIA) Direct Portal
                </h2>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed max-w-2xl">
                An LMIA is an official document from ESDC confirming a Canadian employer may hire a foreign worker. Postings here are directly tagged by the Canadian Government for foreign and international applicants.
              </p>
            </div>

            {/* Key legend */}
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 text-xs">
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-xl border border-amber-300 shadow-2xs font-semibold text-amber-900">
                <span>⭐</span>
                <span>Approved LMIA</span>
                <span className="text-[10px] text-amber-700 font-normal ml-0.5">(Ready to hire)</span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-xl border border-blue-200 shadow-2xs font-semibold text-blue-900">
                <span>📋</span>
                <span>LMIA Requested</span>
                <span className="text-[10px] text-blue-700 font-normal ml-0.5">(In progress)</span>
              </div>
            </div>
          </div>
        </div>

        {/* LMIA Sub-Tabs & Filter Controls Bar */}
        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
          {/* 3 Main Sub-Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200 text-xs font-semibold overflow-x-auto">
            {/* Tab 1: All LMIA */}
            <button
              type="button"
              onClick={() => {
                setSubTab('all');
                setPage(1);
              }}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg transition-all whitespace-nowrap ${
                subTab === 'all'
                  ? 'bg-white text-slate-900 shadow-2xs font-bold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>🍁 All LMIA</span>
              <span className="px-1.5 py-0.2 rounded-full bg-slate-200 text-slate-700 text-[10px] font-bold">
                {subTab === 'all' ? totalJobs.toLocaleString() : '~1,050+'}
              </span>
            </button>

            {/* Tab 2: Approved LMIA */}
            <button
              type="button"
              onClick={() => {
                setSubTab('approved');
                setPage(1);
              }}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg transition-all whitespace-nowrap ${
                subTab === 'approved'
                  ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-white shadow-xs font-bold'
                  : 'text-amber-800 hover:text-amber-950 hover:bg-amber-100/50'
              }`}
            >
              <span>⭐ Approved LMIA</span>
              {approvedCount !== null && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                  subTab === 'approved' ? 'bg-amber-700 text-white' : 'bg-amber-100 text-amber-800'
                }`}>
                  {approvedCount}
                </span>
              )}
            </button>

            {/* Tab 3: LMIA Requested */}
            <button
              type="button"
              onClick={() => {
                setSubTab('requested');
                setPage(1);
              }}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg transition-all whitespace-nowrap ${
                subTab === 'requested'
                  ? 'bg-blue-600 text-white shadow-xs font-bold'
                  : 'text-blue-700 hover:text-blue-900 hover:bg-blue-50'
              }`}
            >
              <span>📋 LMIA Requested</span>
              {requestedCount !== null && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                  subTab === 'requested' ? 'bg-blue-800 text-white' : 'bg-blue-100 text-blue-800'
                }`}>
                  {requestedCount}
                </span>
              )}
            </button>
          </div>

          {/* Additional Filter Switches & Sort */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {/* International Toggle */}
            <label className="inline-flex items-center gap-1.5 cursor-pointer bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 transition-colors">
              <input
                type="checkbox"
                checked={internationalOnly}
                onChange={(e) => {
                  setInternationalOnly(e.target.checked);
                  setPage(1);
                }}
                className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 border-slate-300 cursor-pointer"
              />
              <span className="font-semibold text-slate-700">International Eligible (fglo=1)</span>
            </label>

            {/* Remote workplace toggle */}
            <label className="inline-flex items-center gap-1.5 cursor-pointer bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-100 transition-colors">
              <input
                type="checkbox"
                checked={remoteOnly}
                onChange={(e) => {
                  setRemoteOnly(e.target.checked);
                  setPage(1);
                }}
                className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 border-slate-300 cursor-pointer"
              />
              <span className="font-semibold text-slate-700">Remote / Telework</span>
            </label>

            {/* Sort order */}
            <div className="inline-flex items-center gap-1 bg-slate-50 px-2.5 py-1 rounded-xl border border-slate-200">
              <ArrowDownUp className="w-3.5 h-3.5 text-slate-400" />
              <select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  setPage(1);
                }}
                className="bg-transparent font-medium text-slate-700 text-xs focus:outline-none cursor-pointer"
              >
                <option value="D">Latest First</option>
                <option value="M">Best Match</option>
              </select>
            </div>
          </div>
        </div>

        {/* Results Info & Active SubTab Indicator */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-500 px-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-800">
              {loading ? 'Fetching LMIA vacancies...' : `${totalJobs.toLocaleString()} vacancies found`}
            </span>
            <span>&bull;</span>
            <span className="text-amber-800 font-semibold bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
              Category: {subTab === 'approved' ? '⭐ Approved LMIA' : subTab === 'requested' ? '📋 LMIA Requested' : '🍁 All LMIA (Approved + Requested)'}
            </span>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetAllFilters}
                className="text-blue-600 hover:text-blue-800 font-semibold underline ml-1 cursor-pointer"
              >
                Reset filters
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <span>Page {page} of {totalPages}</span>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-800 text-xs flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              onClick={() => fetchLmiaJobs()}
              className="px-3 py-1 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition-colors shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        {/* Jobs Listing */}
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="bg-white rounded-2xl p-6 border border-slate-200 animate-pulse space-y-4 shadow-xs">
                <div className="h-4 bg-slate-200 rounded w-1/4"></div>
                <div className="h-6 bg-slate-200 rounded w-3/4"></div>
                <div className="h-4 bg-slate-200 rounded w-1/2"></div>
                <div className="h-8 bg-slate-100 rounded w-full"></div>
              </div>
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-16 px-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-50 text-amber-600 mb-4 shadow-inner">
              <Search className="h-8 w-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">No LMIA jobs found</h3>
            <p className="mt-1.5 text-sm text-slate-500 max-w-md mx-auto">
              {subTab === 'approved' 
                ? 'No Approved LMIA postings matched your search. Try switching to "All LMIA" or unchecking province filters.'
                : 'No LMIA vacancies matched your query. Try adjusting your search keywords or clearing province filters.'}
            </p>
            <div className="mt-5 flex items-center justify-center gap-2">
              {subTab !== 'all' && (
                <button
                  onClick={() => setSubTab('all')}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-xl transition-colors shadow-sm"
                >
                  View All LMIA Vacancies
                </button>
              )}
              {hasActiveFilters && (
                <button
                  onClick={resetAllFilters}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors"
                >
                  Clear All Filters
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {jobs.map((job, idx) => {
              const trackedJob = getTrackedJob(job) || job;
              const jobApps = getApplicationsForJob(job, trackedJob);
              const jobIsApplied = Boolean(trackedJob?.isApplied || jobApps.length > 0);
              const jobIsChecked = trackedJob?.isChecked || false;
              const jobIsNotRequired = trackedJob?.isNotRequired || false;
              const jobContact = contactInfo[job.jobId];
              const displayJobNumber = trackedJob?.jobNumber || job.jobNumber || jobContact?.jobNumber || job.jobId;

              const isApprovedLmia = job.lmiaStatus === 'approved';
              const isRequestedLmia = job.lmiaStatus === 'requested';

              const hasCoverLetter = jobContact?.hasCoverLetter !== undefined
                ? jobContact.hasCoverLetter
                : (jobContact?.data ? jobContact.data.toLowerCase().includes('cover letter') : false);

              // Distinct card border
              const cardBorderClass = isApprovedLmia
                ? 'border-amber-300/80 bg-gradient-to-r from-amber-50/30 via-white to-white shadow-amber-100/50 ring-1 ring-amber-300/40 hover:border-amber-400'
                : jobIsApplied
                ? 'border-emerald-300 bg-emerald-50/25 shadow-emerald-100/50 ring-1 ring-emerald-200/50'
                : jobIsChecked
                ? 'border-blue-300 bg-blue-50/20 ring-1 ring-blue-200/40'
                : jobIsNotRequired
                ? 'border-slate-200 bg-slate-50/70 opacity-65'
                : 'border-slate-200 hover:shadow-md hover:border-amber-300';

              return (
                <div 
                  key={job.jobId || idx} 
                  className={`group bg-white rounded-2xl p-5 sm:p-6 shadow-xs border transition-all duration-200 ${cardBorderClass}`}
                >
                  <div className="flex flex-col lg:flex-row justify-between gap-5 lg:gap-6">
                    <div className="space-y-3 flex-1">
                      {/* Top Row: LMIA Badges + Job ID + Flags */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {/* Prominent Approved LMIA Badge */}
                        {isApprovedLmia && (
                          <span 
                            className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-bold bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-xs" 
                            title="Employer has an approved Labour Market Impact Assessment (LMIA) on file to hire foreign workers"
                          >
                            <span>⭐</span>
                            <span>Approved LMIA</span>
                          </span>
                        )}

                        {/* LMIA Requested Badge */}
                        {isRequestedLmia && (
                          <span 
                            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-sky-100 text-sky-800 border border-sky-200" 
                            title="Employer application is under review by ESDC / TFW Program"
                          >
                            <span>📋</span>
                            <span>LMIA Requested</span>
                          </span>
                        )}

                        {/* Job ID badge */}
                        {displayJobNumber && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-slate-100 text-slate-500 border border-slate-200" title={`Job Bank #${displayJobNumber}`}>
                            <Hash className="w-3 h-3" />
                            {displayJobNumber}
                          </span>
                        )}

                        {/* Cover Letter badge */}
                        {hasCoverLetter && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-100 text-rose-700 border border-rose-200">
                            <Mail className="w-3 h-3" />
                            Cover Letter Required
                          </span>
                        )}

                        {/* Regular flags */}
                        {job.flags && job.flags.length > 0 && job.flags.map((flag, fIdx) => {
                          if (flag.toLowerCase().includes('lmia')) return null; // already shown prominently above
                          const isDirect = flag.toLowerCase().includes('direct apply');
                          const isNew = flag.toLowerCase().includes('new');
                          const isRemote = flag.toLowerCase().includes('remote') || flag.toLowerCase().includes('telework');

                          return (
                            <span 
                              key={fIdx} 
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold ${
                                isDirect 
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
                                  : isNew
                                  ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                  : isRemote
                                  ? 'bg-purple-100 text-purple-800 border border-purple-200'
                                  : 'bg-slate-100 text-slate-700 border border-slate-200'
                              }`}
                            >
                              {flag}
                            </span>
                          );
                        })}
                      </div>

                      {/* Job Title */}
                      <h2 className="text-xl font-bold text-slate-900 group-hover:text-amber-700 transition-colors line-clamp-2">
                        <a href={job.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                          {job.title}
                        </a>
                      </h2>
                      
                      {/* Company and Location */}
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <Building2 className="w-4 h-4 text-slate-400" />
                          <span className="font-semibold text-slate-800">{job.company}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-4 h-4 text-slate-400" />
                          <span>{job.location}</span>
                        </div>
                      </div>
                      
                      {/* Salary and Date */}
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <Banknote className="w-4 h-4 text-emerald-600" />
                          <span className="font-semibold text-slate-900 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200/60">
                            {job.salary}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-4 h-4 text-slate-400" />
                          <span className="text-xs text-slate-500">{job.datePosted}</span>
                        </div>
                      </div>
                      
                      {/* Contact Info Drawer */}
                      {jobContact && !jobContact.loading && (
                        <div className="mt-3.5 p-3.5 bg-amber-50/60 rounded-xl border border-amber-200/80 text-sm animate-fadeIn space-y-2">
                          {/* LMIA Official Notice Callout */}
                          {jobContact.lmiaNotice && (
                            <div className={`p-2.5 rounded-lg border text-xs flex items-start gap-2 ${
                              jobContact.lmiaNotice.type === 'approved'
                                ? 'bg-amber-100/70 border-amber-300 text-amber-950 font-medium'
                                : 'bg-blue-100/70 border-blue-300 text-blue-950 font-medium'
                            }`}>
                              <span className="text-sm">{jobContact.lmiaNotice.type === 'approved' ? '⭐' : '📋'}</span>
                              <div>
                                <span className="font-bold">{jobContact.lmiaNotice.badge}: </span>
                                <span>{jobContact.lmiaNotice.text}</span>
                              </div>
                            </div>
                          )}

                          <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                            <Phone className="w-4 h-4 text-amber-600" />
                            <span>Application & Contact Details</span>
                          </div>
                          <p className="text-xs sm:text-sm font-medium text-slate-700 whitespace-pre-wrap leading-relaxed">
                            {jobContact.data}
                          </p>
                        </div>
                      )}
                    </div>
                    
                    {/* Card Actions Side */}
                    <div className="flex flex-col lg:items-end justify-between gap-3 pt-3 lg:pt-0 lg:border-l lg:border-slate-100 lg:pl-6 min-w-[160px]">
                      <div className="flex gap-2 w-full lg:w-auto">
                        <button
                          onClick={() => fetchContactInfo(job.jobId, job.url)}
                          disabled={jobContact?.loading}
                          className="flex-1 lg:flex-none inline-flex justify-center items-center gap-1.5 px-3.5 py-2.5 bg-white border border-slate-300 hover:border-slate-400 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all shadow-sm active:scale-95 disabled:opacity-50 text-xs"
                          title="Reveal contact email / phone / address"
                        >
                          {jobContact?.loading ? (
                            <RefreshCw className="w-4 h-4 text-amber-600 animate-spin" />
                          ) : (
                            <Phone className="w-4 h-4 text-slate-500" />
                          )}
                          <span className="sm:inline">{jobContact ? 'Info' : 'Contact'}</span>
                        </button>
                        
                        <a 
                          href={job.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="flex-1 lg:flex-none inline-flex justify-center items-center gap-1.5 px-5 py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 active:from-amber-800 active:to-orange-800 text-white font-semibold text-xs rounded-xl shadow-xs hover:shadow transition-all active:scale-95"
                        >
                          <span>Apply</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                      
                      {/* Tracking Action Buttons: Checked, Not Required, Applied */}
                      <div className="flex flex-col items-start lg:items-end gap-2 w-full">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {/* Checked Button */}
                          <button
                            type="button"
                            onClick={() => toggleChecked(job)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                              jobIsChecked 
                                ? 'bg-blue-600 text-white border-blue-600 shadow-xs' 
                                : 'bg-white text-slate-600 border-slate-200 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200'
                            }`}
                            title={jobIsChecked ? 'Marked as Checked (click to unmark)' : 'Mark as Checked'}
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>{jobIsChecked ? 'Checked' : 'Check'}</span>
                          </button>

                          {/* Not Required Button */}
                          <button
                            type="button"
                            onClick={() => toggleNotRequired(job)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                              jobIsNotRequired 
                                ? 'bg-slate-700 text-white border-slate-700 shadow-xs' 
                                : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100 hover:text-slate-800'
                            }`}
                            title={jobIsNotRequired ? 'Marked as Not Required (click to unmark)' : 'Mark as Not Required'}
                          >
                            <Ban className="w-3.5 h-3.5" />
                            <span>Not Required</span>
                          </button>

                          {/* Mark Applied Button */}
                          <button
                            type="button"
                            onClick={() => openAppliedModal(job)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                              jobIsApplied 
                                ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs' 
                                : 'bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50'
                            }`}
                            title={jobIsApplied ? 'Click to edit applicant code & date' : 'Mark as Applied and enter applicant code'}
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                            <span>{jobIsApplied ? 'Applied ✓' : 'Mark Applied'}</span>
                          </button>
                        </div>

                        {/* Status indicators when both Checked + Applied */}
                        {jobIsChecked && jobIsApplied && (
                          <div className="flex items-center gap-1 text-[11px] text-slate-500 font-medium">
                            <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold">✓ Checked</span>
                            <span>+</span>
                            <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-semibold">✓ Applied</span>
                          </div>
                        )}

                        {/* If Applied: Display Applicant Code Pill with Team Attribution */}
                        {jobIsApplied && (() => {
                          const groups = groupApplicationsByAuthor(
                            jobApps, 
                            trackedJob?.username || currentUser?.username, 
                            trackedJob?.userCode || trackedJob?.userCodes
                          );
                          const statusDateStr = trackedJob?.statusDate || (jobApps[0]?.status_date || '');

                          return (
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600 mt-1 lg:justify-end">
                              <button
                                type="button"
                                onClick={() => openAppliedModal(job)}
                                className="inline-flex flex-wrap items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100/90 border border-emerald-200 text-emerald-900 font-mono text-xs font-bold transition-all shadow-2xs cursor-pointer group"
                                title="Click to view/edit applicant submissions"
                              >
                                <Tag className="w-3 h-3 text-emerald-600 shrink-0" />
                                {groups.map((grp, gIdx) => (
                                  <span key={gIdx} className="inline-flex items-center gap-1">
                                    {grp.codes.map((code, cIdx) => (
                                      <span key={cIdx} className="font-bold text-emerald-800">
                                        {code}
                                      </span>
                                    ))}
                                    <span className="text-[10px] font-sans font-semibold text-emerald-700/80 bg-emerald-100/70 px-1 py-0.2 rounded">
                                      by {grp.author}
                                    </span>
                                    {gIdx < groups.length - 1 && <span className="text-emerald-300 font-sans">&bull;</span>}
                                  </span>
                                ))}
                                {statusDateStr && (
                                  <span className="text-[10px] font-sans font-normal text-emerald-700 border-l border-emerald-200 pl-1.5">
                                    {statusDateStr}
                                  </span>
                                )}
                                <Edit3 className="w-3 h-3 text-emerald-500 opacity-60 group-hover:opacity-100 transition-opacity ml-0.5" />
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination Bar */}
        {totalPages > 1 && !loading && (
          <div className="flex items-center justify-between border-t border-slate-200 pt-6 px-1">
            <button
              onClick={() => handlePageChange(page - 1)}
              disabled={page <= 1}
              className="inline-flex items-center gap-1.5 px-4 py-2 border border-slate-300 text-xs font-semibold rounded-xl text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-xs"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Previous</span>
            </button>
            
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
              <span>Page</span>
              <span className="px-2 py-1 bg-white border border-slate-200 rounded-lg font-bold shadow-2xs">
                {page}
              </span>
              <span>of</span>
              <span className="font-bold">{totalPages}</span>
            </div>

            <button
              onClick={() => handlePageChange(page + 1)}
              disabled={page >= totalPages}
              className="inline-flex items-center gap-1.5 px-4 py-2 border border-slate-300 text-xs font-semibold rounded-xl text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-xs"
            >
              <span>Next</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
