import { useState, useMemo, useEffect } from 'react';
import { 
  BarChart3, PieChart, Users, CheckCircle2, Check, Ban, Calendar, 
  Download, Printer, RefreshCw, Search, ArrowUpDown, ArrowUp, ArrowDown, 
  Tag, ExternalLink, FileSpreadsheet, ChevronLeft, ChevronRight, X, 
  Building2, MapPin, User, Cloud, HardDrive, ArrowLeft, Briefcase, Hash
} from 'lucide-react';
import { supabase, fetchAllTrackedJobs } from './supabaseClient';

// Helper to parse applicant codes from any raw text format
function parseApplicantCodes(rawCode) {
  if (!rawCode || !rawCode.trim()) return [];
  return rawCode.split(/[\s,]+/).map(c => c.trim().toUpperCase()).filter(Boolean);
}

export default function ReportsPage({ localTrackedJobs, currentUser, onBackToSearch }) {
  // Data source: 'all' (cloud + unsynced local), 'cloud', 'local' (unsynced local only)
  const [dataSource, setDataSource] = useState('all');
  const [cloudJobs, setCloudJobs] = useState([]);
  const [loadingCloud, setLoadingCloud] = useState(false);
  const [cloudError, setCloudError] = useState(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // all, applied, checked, not_required, applied_checked
  const [userFilter, setUserFilter] = useState('all'); // all, or username
  const [applicantFilter, setApplicantFilter] = useState('all'); // all, or applicant code
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Sorting
  const [sortField, setSortField] = useState('statusDate'); // statusDate, jobId, title, company, status, username, userCode
  const [sortDirection, setSortDirection] = useState('desc'); // 'asc' | 'desc'

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Active chart tab: 'overview' | 'applicants' | 'users' | 'timeline'
  const [chartView, setChartView] = useState('overview');

  // Fetch complete cloud data from Supabase using paginated fetch
  const fetchCloudJobs = async () => {
    setLoadingCloud(true);
    setCloudError(null);
    try {
      const data = await fetchAllTrackedJobs();

      const normalized = (data || []).map(row => ({
        id: row.id,
        jobId: row.job_id,
        jobNumber: row.job_id,
        title: row.title || 'Untitled Job',
        company: row.company || 'Unknown Company',
        location: row.location || 'Canada',
        salary: row.salary || 'Not listed',
        datePosted: row.date_posted || '',
        url: row.url || '',
        isApplied: Boolean(row.is_applied),
        isChecked: Boolean(row.is_checked),
        isNotRequired: Boolean(row.is_not_required),
        userCodes: row.user_codes || [],
        userCode: (row.user_codes || []).join(' '),
        statusDate: row.status_date || (row.updated_at ? row.updated_at.split('T')[0] : ''),
        username: row.username || 'Anonymous',
        updatedAt: row.updated_at,
        source: 'cloud'
      }));

      setCloudJobs(normalized);
    } catch (err) {
      console.error('Error loading cloud reports data:', err);
      setCloudError(err.message || 'Failed to fetch cloud records.');
    } finally {
      setLoadingCloud(false);
    }
  };

  useEffect(() => {
    fetchCloudJobs();
  }, []);

  // Compute truly unsynced local jobs (jobs in local state not yet in cloud)
  const unsyncedLocalJobs = useMemo(() => {
    const cloudIds = new Set(cloudJobs.map(j => String(j.jobId)));
    return (localTrackedJobs || [])
      .filter(j => !cloudIds.has(String(j.jobNumber || j.jobId)))
      .map(j => ({
        ...j,
        jobNumber: j.jobNumber || j.jobId,
        username: currentUser?.username || 'Current Device',
        userCodes: parseApplicantCodes(j.userCode || ''),
        source: 'local'
      }));
  }, [localTrackedJobs, cloudJobs, currentUser]);

  // Merge datasets according to selected data source
  const allJobs = useMemo(() => {
    if (dataSource === 'local') return unsyncedLocalJobs;
    if (dataSource === 'cloud') return cloudJobs;

    // 'all': Cloud master + any unsynced local items
    const map = new Map();
    cloudJobs.forEach(j => map.set(j.jobId, j));
    unsyncedLocalJobs.forEach(j => {
      if (!map.has(j.jobId)) {
        map.set(j.jobId, j);
      }
    });

    return Array.from(map.values());
  }, [unsyncedLocalJobs, cloudJobs, dataSource]);

  // Extract unique users
  const uniqueUsers = useMemo(() => {
    const users = new Set(allJobs.map(j => j.username).filter(Boolean));
    return Array.from(users).sort();
  }, [allJobs]);

  // Extract unique applicant codes
  const uniqueApplicantCodes = useMemo(() => {
    const codes = new Set();
    allJobs.forEach(j => {
      (j.userCodes || []).forEach(c => codes.add(c.toUpperCase()));
    });
    return Array.from(codes).sort();
  }, [allJobs]);

  // Filtered dataset
  const filteredJobs = useMemo(() => {
    return allJobs.filter(job => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesQuery = 
          (job.title && job.title.toLowerCase().includes(q)) ||
          (job.company && job.company.toLowerCase().includes(q)) ||
          (job.location && job.location.toLowerCase().includes(q)) ||
          (job.jobNumber && String(job.jobNumber).toLowerCase().includes(q)) ||
          (job.userCode && job.userCode.toLowerCase().includes(q));
        if (!matchesQuery) return false;
      }

      // Status
      if (statusFilter === 'applied' && !job.isApplied) return false;
      if (statusFilter === 'checked' && !job.isChecked) return false;
      if (statusFilter === 'not_required' && !job.isNotRequired) return false;
      if (statusFilter === 'applied_checked' && (!job.isApplied || !job.isChecked)) return false;

      // User
      if (userFilter !== 'all' && job.username !== userFilter) return false;

      // Applicant Code
      if (applicantFilter !== 'all') {
        const codes = job.userCodes || [];
        if (!codes.includes(applicantFilter.toUpperCase())) return false;
      }

      // Date Range
      const d = job.statusDate || '';
      if (startDate && d && d < startDate) return false;
      if (endDate && d && d > endDate) return false;

      return true;
    });
  }, [allJobs, searchQuery, statusFilter, userFilter, applicantFilter, startDate, endDate]);

  // Sorted dataset
  const sortedJobs = useMemo(() => {
    return [...filteredJobs].sort((a, b) => {
      let valA = a[sortField] || '';
      let valB = b[sortField] || '';

      if (sortField === 'statusDate') {
        valA = a.statusDate || a.updatedAt || '';
        valB = b.statusDate || b.updatedAt || '';
      }

      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredJobs, sortField, sortDirection]);

  // Pagination
  const totalPages = Math.ceil(sortedJobs.length / pageSize) || 1;
  const paginatedJobs = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedJobs.slice(start, start + pageSize);
  }, [sortedJobs, currentPage, pageSize]);

  // Handle Sort Click
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // KPIs
  const stats = useMemo(() => {
    const total = filteredJobs.length;
    const applied = filteredJobs.filter(j => j.isApplied).length;
    const checked = filteredJobs.filter(j => j.isChecked).length;
    const notRequired = filteredJobs.filter(j => j.isNotRequired).length;
    const both = filteredJobs.filter(j => j.isApplied && j.isChecked).length;

    // Applicant counts
    const applicantCounts = {};
    filteredJobs.forEach(j => {
      (j.userCodes || []).forEach(c => {
        applicantCounts[c] = (applicantCounts[c] || 0) + 1;
      });
    });

    // User counts
    const userCounts = {};
    filteredJobs.forEach(j => {
      const u = j.username || 'Unknown';
      userCounts[u] = (userCounts[u] || 0) + 1;
    });

    // Date counts for timeline
    const dateCounts = {};
    filteredJobs.forEach(j => {
      const date = j.statusDate || 'No Date';
      dateCounts[date] = (dateCounts[date] || 0) + 1;
    });

    return { total, applied, checked, notRequired, both, applicantCounts, userCounts, dateCounts };
  }, [filteredJobs]);

  // Export to CSV
  const handleExportCsv = () => {
    if (sortedJobs.length === 0) return;
    const headers = [
      'Job Number', 'Job Title', 'Company', 'Location', 'Salary', 
      'Date Posted', 'Status', 'Applicant Codes', 'Status Date', 'Saved By User', 'Job URL'
    ];

    const getStatusText = (j) => {
      if (j.isApplied && j.isChecked) return 'APPLIED + CHECKED';
      if (j.isApplied) return 'APPLIED';
      if (j.isChecked) return 'CHECKED';
      if (j.isNotRequired) return 'NOT REQUIRED';
      return 'UNSPECIFIED';
    };

    const rows = sortedJobs.map(job => [
      `"${job.jobNumber || job.jobId || ''}"`,
      `"${(job.title || '').replace(/"/g, '""')}"`,
      `"${(job.company || '').replace(/"/g, '""')}"`,
      `"${(job.location || '').replace(/"/g, '""')}"`,
      `"${(job.salary || '').replace(/"/g, '""')}"`,
      `"${(job.datePosted || '').replace(/"/g, '""')}"`,
      `"${getStatusText(job)}"`,
      `"${(job.userCode || '').replace(/"/g, '""')}"`,
      `"${job.statusDate || ''}"`,
      `"${(job.username || '').replace(/"/g, '""')}"`,
      `"${job.url || ''}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const timeTag = new Date().toISOString().split('T')[0];
    link.download = `canadian_job_report_${timeTag}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Quick Preset Date Ranges
  const handleDatePreset = (preset) => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    if (preset === 'today') {
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (preset === '7days') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      setStartDate(d.toISOString().split('T')[0]);
      setEndDate(todayStr);
    } else if (preset === '30days') {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      setStartDate(d.toISOString().split('T')[0]);
      setEndDate(todayStr);
    } else {
      setStartDate('');
      setEndDate('');
    }
  };

  // Top applicants sorted by application count
  const topApplicants = useMemo(() => {
    return Object.entries(stats.applicantCounts)
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [stats.applicantCounts]);

  // Top users sorted by jobs saved
  const topUsers = useMemo(() => {
    return Object.entries(stats.userCounts)
      .map(([user, count]) => ({ user, count }))
      .sort((a, b) => b.count - a.count);
  }, [stats.userCounts]);

  // Top dates sorted chronologically
  const timelineData = useMemo(() => {
    return Object.entries(stats.dateCounts)
      .filter(([date]) => date !== 'No Date')
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14); // last 14 active days
  }, [stats.dateCounts]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-16">
      {/* Top Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                onClick={onBackToSearch}
                className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200"
                title="Back to Live Job Search"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-blue-600" />
                  Analytics & Reports Dashboard
                </h1>
                <p className="text-xs text-slate-500">
                  Full visibility into tracked jobs, applicant codes, team activity, and exports
                </p>
              </div>
            </div>

            {/* Actions: Source switcher + Sync + Export + Print */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Data source toggle */}
              <div className="inline-flex rounded-xl bg-slate-100 p-0.5 border border-slate-200 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setDataSource('all')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    dataSource === 'all' 
                      ? 'bg-white text-blue-700 shadow-2xs font-bold' 
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Combine Cloud DB and Local Browser records"
                >
                  All ({allJobs.length})
                </button>
                <button
                  type="button"
                  onClick={() => setDataSource('cloud')}
                  className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${
                    dataSource === 'cloud' 
                      ? 'bg-white text-blue-700 shadow-2xs font-bold' 
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="View records synced to Cloud DB across all users"
                >
                  <Cloud className="w-3 h-3 text-blue-600" />
                  <span>Cloud ({cloudJobs.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDataSource('local')}
                  className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${
                    dataSource === 'local' 
                      ? 'bg-white text-blue-700 shadow-2xs font-bold' 
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="View records stored in this browser that have not been synced to the cloud"
                >
                  <HardDrive className="w-3 h-3 text-slate-600" />
                  <span>Unsynced Local ({unsyncedLocalJobs.length})</span>
                </button>
              </div>

              {/* Refresh Cloud Button */}
              <button
                type="button"
                onClick={fetchCloudJobs}
                disabled={loadingCloud}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold rounded-xl shadow-2xs transition-all disabled:opacity-50"
                title="Fetch latest updates from Cloud database"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-blue-600 ${loadingCloud ? 'animate-spin' : ''}`} />
                <span className="hidden sm:inline">Refresh</span>
              </button>

              {/* Export CSV */}
              <button
                type="button"
                onClick={handleExportCsv}
                disabled={sortedJobs.length === 0}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-xl shadow-xs transition-all disabled:opacity-40"
                title="Export filtered records to CSV"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Export CSV ({sortedJobs.length})</span>
              </button>

              {/* Print Report */}
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl shadow-2xs transition-all"
                title="Print or save as PDF"
              >
                <Printer className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Print</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {cloudError && (
          <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-center justify-between">
            <span>⚠️ Could not fetch latest cloud database records: {cloudError}. Showing local records.</span>
            <button onClick={fetchCloudJobs} className="font-semibold underline ml-2">Retry</button>
          </div>
        )}

        {/* ─── KPI Cards ─── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          {/* Total */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Total Tracked</span>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-2xl font-black text-slate-900">{stats.total}</span>
              <Briefcase className="w-4 h-4 text-slate-400" />
            </div>
            <span className="text-[11px] text-slate-400 mt-1 block">Active dataset</span>
          </div>

          {/* Applied */}
          <div className="bg-white rounded-2xl p-4 border border-emerald-200 bg-emerald-50/20 shadow-xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Applied</span>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-2xl font-black text-emerald-700">{stats.applied}</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            </div>
            <span className="text-[11px] text-emerald-600 font-medium mt-1 block">
              {stats.total > 0 ? Math.round((stats.applied / stats.total) * 100) : 0}% of total
            </span>
          </div>

          {/* Checked */}
          <div className="bg-white rounded-2xl p-4 border border-blue-200 bg-blue-50/20 shadow-xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-blue-700">Checked</span>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-2xl font-black text-blue-700">{stats.checked}</span>
              <Check className="w-4 h-4 text-blue-600" />
            </div>
            <span className="text-[11px] text-blue-600 font-medium mt-1 block">
              {stats.total > 0 ? Math.round((stats.checked / stats.total) * 100) : 0}% of total
            </span>
          </div>

          {/* Both Checked + Applied */}
          <div className="bg-white rounded-2xl p-4 border border-indigo-200 bg-indigo-50/20 shadow-xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">Checked & Applied</span>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-2xl font-black text-indigo-700">{stats.both}</span>
              <Tag className="w-4 h-4 text-indigo-600" />
            </div>
            <span className="text-[11px] text-indigo-600 font-medium mt-1 block">Dual verified</span>
          </div>

          {/* Not Required */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Not Required</span>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-2xl font-black text-slate-700">{stats.notRequired}</span>
              <Ban className="w-4 h-4 text-slate-400" />
            </div>
            <span className="text-[11px] text-slate-400 mt-1 block">Excluded jobs</span>
          </div>

          {/* Unique Applicants */}
          <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-xs">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Applicants</span>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-2xl font-black text-purple-700">{uniqueApplicantCodes.length}</span>
              <Users className="w-4 h-4 text-purple-500" />
            </div>
            <span className="text-[11px] text-purple-600 font-medium mt-1 block">{uniqueUsers.length} team members</span>
          </div>
        </div>

        {/* ─── Visual Charts Section ─── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <PieChart className="w-4 h-4 text-blue-600" />
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Visual Analytics</h2>
            </div>
            {/* Chart View selector */}
            <div className="inline-flex rounded-xl bg-slate-100 p-0.5 border border-slate-200 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setChartView('overview')}
                className={`px-3 py-1 rounded-lg transition-all ${chartView === 'overview' ? 'bg-white text-blue-700 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'}`}
              >
                Status Distribution
              </button>
              <button
                type="button"
                onClick={() => setChartView('applicants')}
                className={`px-3 py-1 rounded-lg transition-all ${chartView === 'applicants' ? 'bg-white text-blue-700 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'}`}
              >
                Top Applicants ({topApplicants.length})
              </button>
              <button
                type="button"
                onClick={() => setChartView('users')}
                className={`px-3 py-1 rounded-lg transition-all ${chartView === 'users' ? 'bg-white text-blue-700 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'}`}
              >
                Team Activity ({topUsers.length})
              </button>
              <button
                type="button"
                onClick={() => setChartView('timeline')}
                className={`px-3 py-1 rounded-lg transition-all ${chartView === 'timeline' ? 'bg-white text-blue-700 shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'}`}
              >
                Timeline Trend
              </button>
            </div>
          </div>

          <div className="pt-5">
            {/* View 1: Status Distribution (Visual Percentage Bars & Donut breakdown) */}
            {chartView === 'overview' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center">
                {/* Visual Progress Bars */}
                <div className="md:col-span-2 space-y-4">
                  <div>
                    <div className="flex justify-between text-xs font-bold mb-1.5">
                      <span className="text-emerald-700 flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                        Applied Vacancies
                      </span>
                      <span>{stats.applied} jobs ({stats.total > 0 ? Math.round((stats.applied / stats.total) * 100) : 0}%)</span>
                    </div>
                    <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-emerald-500 rounded-full transition-all duration-500" 
                        style={{ width: `${stats.total > 0 ? (stats.applied / stats.total) * 100 : 0}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs font-bold mb-1.5">
                      <span className="text-blue-700 flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                        Checked Vacancies
                      </span>
                      <span>{stats.checked} jobs ({stats.total > 0 ? Math.round((stats.checked / stats.total) * 100) : 0}%)</span>
                    </div>
                    <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-blue-500 rounded-full transition-all duration-500" 
                        style={{ width: `${stats.total > 0 ? (stats.checked / stats.total) * 100 : 0}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs font-bold mb-1.5">
                      <span className="text-slate-700 flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-slate-400"></span>
                        Not Required
                      </span>
                      <span>{stats.notRequired} jobs ({stats.total > 0 ? Math.round((stats.notRequired / stats.total) * 100) : 0}%)</span>
                    </div>
                    <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-slate-400 rounded-full transition-all duration-500" 
                        style={{ width: `${stats.total > 0 ? (stats.notRequired / stats.total) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Summary Ring Indicator */}
                <div className="flex flex-col items-center justify-center p-6 bg-slate-50 rounded-2xl border border-slate-200 text-center">
                  <div className="text-4xl font-black text-slate-900 tracking-tight">{stats.total}</div>
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mt-1">Total Decisions</div>
                  <p className="text-xs text-slate-400 mt-2 max-w-xs">
                    {stats.both} jobs have been verified as both <strong>Checked</strong> and <strong>Applied</strong> simultaneously.
                  </p>
                </div>
              </div>
            )}

            {/* View 2: Top Applicants */}
            {chartView === 'applicants' && (
              <div className="space-y-3">
                {topApplicants.length === 0 ? (
                  <p className="text-xs text-slate-400 py-6 text-center">No applicant codes recorded in current filter selection.</p>
                ) : (
                  topApplicants.map(({ code, count }) => {
                    const maxCount = topApplicants[0].count || 1;
                    const percent = Math.round((count / maxCount) * 100);
                    return (
                      <div key={code} className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setApplicantFilter(code)}
                          className="w-24 text-left font-mono text-xs font-bold text-slate-800 hover:text-blue-600 transition-colors shrink-0"
                          title={`Filter table by ${code}`}
                        >
                          {code}
                        </button>
                        <div className="flex-1 h-6 bg-slate-100 rounded-lg overflow-hidden flex items-center p-1">
                          <div
                            className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 rounded-md transition-all duration-500 flex items-center justify-end pr-2 text-white font-mono text-[11px] font-bold"
                            style={{ width: `${Math.max(12, percent)}%` }}
                          >
                            {count}
                          </div>
                        </div>
                        <span className="text-xs font-semibold text-slate-500 w-16 text-right shrink-0">
                          {count} {count === 1 ? 'job' : 'jobs'}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* View 3: Team Activity / Users */}
            {chartView === 'users' && (
              <div className="space-y-3">
                {topUsers.length === 0 ? (
                  <p className="text-xs text-slate-400 py-6 text-center">No user activity recorded yet.</p>
                ) : (
                  topUsers.map(({ user, count }) => {
                    const maxCount = topUsers[0].count || 1;
                    const percent = Math.round((count / maxCount) * 100);
                    return (
                      <div key={user} className="flex items-center gap-3">
                        <div className="w-32 flex items-center gap-1.5 shrink-0">
                          <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold uppercase">
                            {user[0] || 'U'}
                          </div>
                          <button
                            type="button"
                            onClick={() => setUserFilter(user)}
                            className="text-xs font-bold text-slate-800 hover:text-blue-600 truncate transition-colors text-left"
                            title={`Filter table by ${user}`}
                          >
                            {user}
                          </button>
                        </div>
                        <div className="flex-1 h-6 bg-slate-100 rounded-lg overflow-hidden flex items-center p-1">
                          <div
                            className="h-full bg-gradient-to-r from-blue-600 to-indigo-600 rounded-md transition-all duration-500 flex items-center justify-end pr-2 text-white font-mono text-[11px] font-bold"
                            style={{ width: `${Math.max(12, percent)}%` }}
                          >
                            {count}
                          </div>
                        </div>
                        <span className="text-xs font-semibold text-slate-500 w-16 text-right shrink-0">
                          {count} {count === 1 ? 'job' : 'jobs'}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* View 4: Timeline Trend */}
            {chartView === 'timeline' && (
              <div className="space-y-3">
                {timelineData.length === 0 ? (
                  <p className="text-xs text-slate-400 py-6 text-center">No dated application activity in current range.</p>
                ) : (
                  <div className="flex items-end gap-2 h-44 pt-6 px-2 overflow-x-auto no-scrollbar">
                    {timelineData.map(({ date, count }) => {
                      const maxCount = Math.max(...timelineData.map(d => d.count), 1);
                      const heightPercent = Math.max(15, Math.round((count / maxCount) * 100));
                      return (
                        <div key={date} className="flex-1 flex flex-col items-center min-w-[40px] group">
                          <span className="text-[10px] font-bold text-slate-700 mb-1 opacity-80 group-hover:opacity-100">
                            {count}
                          </span>
                          <div className="w-full bg-slate-100 rounded-t-lg h-32 flex items-end">
                            <div
                              className="w-full bg-blue-600 group-hover:bg-blue-700 rounded-t-lg transition-all duration-300"
                              style={{ height: `${heightPercent}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-mono text-slate-400 mt-1 whitespace-nowrap transform -rotate-45 sm:rotate-0 origin-top-left sm:origin-center">
                            {date.slice(5)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ─── Filter & Search Bar ─── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-4 sm:p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* Search Input */}
            <div className="relative lg:col-span-2">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Search className="w-4 h-4" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                placeholder="Search job title, company, ID, or location..."
                className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Status Filter */}
            <div>
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setCurrentPage(1); }}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-700 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                <option value="all">All Statuses ({allJobs.length})</option>
                <option value="applied">Applied ({allJobs.filter(j => j.isApplied).length})</option>
                <option value="checked">Checked ({allJobs.filter(j => j.isChecked).length})</option>
                <option value="applied_checked">Both Checked & Applied ({allJobs.filter(j => j.isApplied && j.isChecked).length})</option>
                <option value="not_required">Not Required ({allJobs.filter(j => j.isNotRequired).length})</option>
              </select>
            </div>

            {/* User Filter */}
            <div>
              <select
                value={userFilter}
                onChange={(e) => { setUserFilter(e.target.value); setCurrentPage(1); }}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-700 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                <option value="all">All Users ({uniqueUsers.length})</option>
                {uniqueUsers.map(u => (
                  <option key={u} value={u}>Saved by: {u}</option>
                ))}
              </select>
            </div>

            {/* Applicant Filter */}
            <div>
              <select
                value={applicantFilter}
                onChange={(e) => { setApplicantFilter(e.target.value); setCurrentPage(1); }}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-700 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 cursor-pointer"
              >
                <option value="all">All Applicant Codes ({uniqueApplicantCodes.length})</option>
                {uniqueApplicantCodes.map(c => (
                  <option key={c} value={c}>Code: {c}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Date Range & Quick Presets */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-500 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                Date Range:
              </span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setCurrentPage(1); }}
                className="px-2.5 py-1 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 focus:outline-none focus:bg-white focus:ring-1 focus:ring-blue-500"
              />
              <span className="text-slate-400">to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setCurrentPage(1); }}
                className="px-2.5 py-1 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 focus:outline-none focus:bg-white focus:ring-1 focus:ring-blue-500"
              />
              {(startDate || endDate) && (
                <button
                  onClick={() => { setStartDate(''); setEndDate(''); }}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded"
                  title="Clear dates"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Presets */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 font-medium">Quick:</span>
              <button
                type="button"
                onClick={() => handleDatePreset('today')}
                className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => handleDatePreset('7days')}
                className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
              >
                Last 7d
              </button>
              <button
                type="button"
                onClick={() => handleDatePreset('30days')}
                className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
              >
                Last 30d
              </button>
              <button
                type="button"
                onClick={() => handleDatePreset('all')}
                className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
              >
                All
              </button>
            </div>
          </div>
        </div>

        {/* ─── Interactive Reports Table ─── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Detailed Records ({sortedJobs.length} {sortedJobs.length === 1 ? 'record' : 'records'})
              </h3>
              <p className="text-xs text-slate-500">
                Click any column header to sort. Hover on rows to see detailed metadata.
              </p>
            </div>

            {/* Page size dropdown */}
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span>Show:</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-xs font-semibold focus:outline-none"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span>per page</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100/75 border-b border-slate-200 text-slate-600 uppercase tracking-wider font-bold">
                  {/* Job ID */}
                  <th 
                    onClick={() => handleSort('jobId')} 
                    className="py-3 px-4 cursor-pointer hover:bg-slate-200/60 transition-colors whitespace-nowrap"
                  >
                    <div className="flex items-center gap-1">
                      <span>Job #</span>
                      {sortField === 'jobId' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-blue-600" /> : <ArrowDown className="w-3 h-3 text-blue-600" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      )}
                    </div>
                  </th>

                  {/* Title */}
                  <th 
                    onClick={() => handleSort('title')} 
                    className="py-3 px-4 cursor-pointer hover:bg-slate-200/60 transition-colors min-w-[200px]"
                  >
                    <div className="flex items-center gap-1">
                      <span>Job Title & Company</span>
                      {sortField === 'title' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-blue-600" /> : <ArrowDown className="w-3 h-3 text-blue-600" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      )}
                    </div>
                  </th>

                  {/* Location */}
                  <th 
                    onClick={() => handleSort('location')} 
                    className="py-3 px-4 cursor-pointer hover:bg-slate-200/60 transition-colors whitespace-nowrap"
                  >
                    <div className="flex items-center gap-1">
                      <span>Location</span>
                      {sortField === 'location' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-blue-600" /> : <ArrowDown className="w-3 h-3 text-blue-600" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      )}
                    </div>
                  </th>

                  {/* Salary */}
                  <th className="py-3 px-4 whitespace-nowrap">Salary</th>

                  {/* Status */}
                  <th 
                    onClick={() => handleSort('isApplied')} 
                    className="py-3 px-4 cursor-pointer hover:bg-slate-200/60 transition-colors whitespace-nowrap"
                  >
                    <div className="flex items-center gap-1">
                      <span>Status</span>
                      {sortField === 'isApplied' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-blue-600" /> : <ArrowDown className="w-3 h-3 text-blue-600" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      )}
                    </div>
                  </th>

                  {/* Applicant Code */}
                  <th 
                    onClick={() => handleSort('userCode')} 
                    className="py-3 px-4 cursor-pointer hover:bg-slate-200/60 transition-colors whitespace-nowrap"
                  >
                    <div className="flex items-center gap-1">
                      <span>Applicant Code</span>
                      {sortField === 'userCode' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-blue-600" /> : <ArrowDown className="w-3 h-3 text-blue-600" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      )}
                    </div>
                  </th>

                  {/* Date */}
                  <th 
                    onClick={() => handleSort('statusDate')} 
                    className="py-3 px-4 cursor-pointer hover:bg-slate-200/60 transition-colors whitespace-nowrap"
                  >
                    <div className="flex items-center gap-1">
                      <span>Date</span>
                      {sortField === 'statusDate' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-blue-600" /> : <ArrowDown className="w-3 h-3 text-blue-600" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      )}
                    </div>
                  </th>

                  {/* Saved By (User) */}
                  <th 
                    onClick={() => handleSort('username')} 
                    className="py-3 px-4 cursor-pointer hover:bg-slate-200/60 transition-colors whitespace-nowrap"
                  >
                    <div className="flex items-center gap-1">
                      <span>Saved By</span>
                      {sortField === 'username' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-blue-600" /> : <ArrowDown className="w-3 h-3 text-blue-600" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-slate-400" />
                      )}
                    </div>
                  </th>

                  {/* Action Link */}
                  <th className="py-3 px-4 text-right whitespace-nowrap">Link</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100 font-medium">
                {paginatedJobs.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-400">
                      No records match the current filter criteria.
                    </td>
                  </tr>
                ) : (
                  paginatedJobs.map((job, idx) => {
                    const isApplied = job.isApplied;
                    const isChecked = job.isChecked;
                    const isNotRequired = job.isNotRequired;

                    return (
                      <tr 
                        key={job.id || job.jobId || idx} 
                        className="hover:bg-blue-50/30 transition-colors"
                      >
                        {/* Job ID */}
                        <td className="py-3 px-4 font-mono font-bold text-slate-700 whitespace-nowrap">
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                            <Hash className="w-3 h-3 text-slate-400" />
                            {job.jobNumber || job.jobId}
                          </span>
                        </td>

                        {/* Title & Company */}
                        <td className="py-3 px-4">
                          <a 
                            href={job.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="font-bold text-slate-900 hover:text-blue-600 transition-colors line-clamp-1"
                          >
                            {job.title}
                          </a>
                          <div className="text-[11px] text-slate-500 flex items-center gap-1 mt-0.5">
                            <Building2 className="w-3 h-3 text-slate-400" />
                            <span>{job.company}</span>
                          </div>
                        </td>

                        {/* Location */}
                        <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                            <span>{job.location}</span>
                          </div>
                        </td>

                        {/* Salary */}
                        <td className="py-3 px-4 text-slate-600 whitespace-nowrap font-mono text-[11px]">
                          {job.salary || 'Not listed'}
                        </td>

                        {/* Status Badges */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="flex flex-wrap items-center gap-1">
                            {isApplied && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                Applied
                              </span>
                            )}
                            {isChecked && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                                <Check className="w-3 h-3 text-blue-600" />
                                Checked
                              </span>
                            )}
                            {isNotRequired && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                <Ban className="w-3 h-3 text-slate-400" />
                                Not Required
                              </span>
                            )}
                            {!isApplied && !isChecked && !isNotRequired && (
                              <span className="text-slate-400 italic">None</span>
                            )}
                          </div>
                        </td>

                        {/* Applicant Codes */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          {job.userCodes && job.userCodes.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-1">
                              {job.userCodes.map(code => (
                                <button
                                  key={code}
                                  type="button"
                                  onClick={() => setApplicantFilter(code)}
                                  className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors"
                                  title={`Filter table by applicant ${code}`}
                                >
                                  {code}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-400 italic text-[11px]">None</span>
                          )}
                        </td>

                        {/* Date */}
                        <td className="py-3 px-4 text-slate-600 whitespace-nowrap font-mono text-[11px]">
                          {job.statusDate || '—'}
                        </td>

                        {/* Saved By (Username) */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setUserFilter(job.username)}
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-700 font-semibold text-[11px] transition-colors"
                            title={`Filter table by ${job.username}`}
                          >
                            <User className="w-3 h-3 text-blue-600" />
                            <span>{job.username}</span>
                          </button>
                        </td>

                        {/* Link */}
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <a
                            href={job.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-semibold transition-colors"
                            title="Open Job Posting on Job Bank Canada"
                          >
                            <span>Open</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Table Pagination Bar */}
          {totalPages > 1 && (
            <div className="px-5 py-3.5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 bg-slate-50/50">
              <div>
                Showing <strong>{((currentPage - 1) * pageSize) + 1}</strong> to <strong>{Math.min(currentPage * pageSize, sortedJobs.length)}</strong> of <strong>{sortedJobs.length}</strong> records
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1.5 border border-slate-200 rounded-lg hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="px-2 font-bold text-slate-700">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="p-1.5 border border-slate-200 rounded-lg hover:bg-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
