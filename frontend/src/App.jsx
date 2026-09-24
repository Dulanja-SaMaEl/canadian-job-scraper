import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Search, MapPin, Building2, Banknote, Calendar, ExternalLink, Globe2, 
  AlertCircle, CheckCircle, Download, ArrowDownUp, Phone, X, RefreshCw, 
  Briefcase, ChevronLeft, ChevronRight, Laptop, Sparkles, Check, Ban, Tag, 
  Edit3, CalendarDays, UserCheck, FileText, ArrowLeft, LogOut, User,
  CloudUpload, Hash, Mail
} from 'lucide-react';
import { supabase } from './supabaseClient';

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

const POPULAR_SEARCHES = [
  'Software Developer',
  'Driver',
  'Registered Nurse',
  'Cook',
  'Accountant',
  'Administrative Assistant',
  'Electrician',
  'Customer Service'
];

// Debounce hook
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

// Parse applicant codes from any format: "CA596 CA3927", "CA596,CA3927", "CA596, CA3927", or "CA596"
function parseApplicantCodes(rawCode) {
  if (!rawCode || !rawCode.trim()) return [];
  return rawCode.split(/[\s,]+/).map(c => c.trim().toUpperCase()).filter(Boolean);
}

// Migrate old single-status format to new boolean-flag format (zero data loss)
function migrateJobEntry(job) {
  if (job.isApplied !== undefined) return job; // already migrated
  return {
    ...job,
    isApplied: job.status === 'applied',
    isChecked: job.status === 'checked',
    isNotRequired: job.status === 'not_required',
  };
}

// Derive a display status string from boolean flags (for CSV export compat)
function getDerivedStatus(job) {
  if (job.isApplied && job.isChecked) return 'applied+checked';
  if (job.isApplied) return 'applied';
  if (job.isChecked) return 'checked';
  if (job.isNotRequired) return 'not_required';
  return '';
}

export default function App({ currentUser, onLogout }) {
  const [keyword, setKeyword] = useState('');
  const debouncedKeyword = useDebounce(keyword, 350);
  const [searchQuery, setSearchQuery] = useState('');
  const [province, setProvince] = useState('');
  const [internationalOnly, setInternationalOnly] = useState(false);
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('D');
  const [jobs, setJobs] = useState([]);
  const [totalJobs, setTotalJobs] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Tracked jobs with boolean status flags (migrated from old single-status format)
  const [trackedJobs, setTrackedJobs] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('trackedJobs'));
      if (stored && Array.isArray(stored)) {
        return stored.map(migrateJobEntry);
      }
      // Backward compatibility migration from legacy appliedJobs
      const legacyApplied = JSON.parse(localStorage.getItem('appliedJobs'));
      if (legacyApplied && Array.isArray(legacyApplied)) {
        const todayStr = new Date().toISOString().split('T')[0];
        const migrated = legacyApplied.map(item => ({
          ...item,
          status: 'applied',
          isApplied: true,
          isChecked: false,
          isNotRequired: false,
          userCode: item.userCode || '',
          statusDate: item.statusDate || todayStr,
          updatedAt: item.updatedAt || new Date().toISOString()
        }));
        localStorage.setItem('trackedJobs', JSON.stringify(migrated));
        return migrated;
      }
      return [];
    } catch {
      return [];
    }
  });

  // Modal state for marking applied
  const [appliedModalJob, setAppliedModalJob] = useState(null);
  const [modalUserCode, setModalUserCode] = useState('');
  const [modalStatusDate, setModalStatusDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Date range & status filter for Export
  const [exportStartDate, setExportStartDate] = useState('');
  const [exportEndDate, setExportEndDate] = useState('');
  const [exportStatusFilter, setExportStatusFilter] = useState('all');

  // Applicant Code search/filter & review view
  const [selectedApplicantCode, setSelectedApplicantCode] = useState('');
  const [isApplicantViewActive, setIsApplicantViewActive] = useState(false);

  const [contactInfo, setContactInfo] = useState({});

  // Upload state
  const [uploadStatus, setUploadStatus] = useState(null); // null | 'loading' | 'success' | 'error'
  const [uploadMessage, setUploadMessage] = useState('');

  const abortControllerRef = useRef(null);

  // Sync debounced keyword → searchQuery. Skip the very first mount run (value unchanged).
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

  const handleSelectQuickChip = (term) => {
    setKeyword(term);
    setSearchQuery(term);
    setPage(1);
  };

  const fetchJobs = useCallback(async () => {
    // Abort any previous in-flight request
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
      // Guard: if this request was superseded while awaiting, bail silently
      if (controller.signal.aborted) return;
      setJobs(data.jobs || []);
      setTotalJobs(data.totalJobs || 0);
      setTotalPages(data.totalPages || 1);
      setLoading(false);
    } catch (err) {
      // AbortError = a newer request replaced this one.
      // Do NOT clear loading — the newer request will handle it when it settles.
      if (err.name === 'AbortError' || controller.signal.aborted) return;
      setError(err.message || 'Failed to fetch jobs.');
      setJobs([]);
      setLoading(false);
    }
  }, [searchQuery, page, sort, province, internationalOnly, remoteOnly]);

  useEffect(() => {
    fetchJobs();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchJobs]);

  // ─────────────────────────────────────────────────────────────────────
  // STATUS COUNTS (boolean flags)
  // ─────────────────────────────────────────────────────────────────────
  const statusCounts = {
    applied: trackedJobs.filter(j => j.isApplied).length,
    checked: trackedJobs.filter(j => j.isChecked).length,
    notRequired: trackedJobs.filter(j => j.isNotRequired).length,
    total: trackedJobs.length
  };

  const getTrackedJob = (jobId) => trackedJobs.find(j => j.jobId === jobId);

  // ─────────────────────────────────────────────────────────────────────
  // PERSIST helper
  // ─────────────────────────────────────────────────────────────────────
  const persistJobs = (updated) => {
    localStorage.setItem('trackedJobs', JSON.stringify(updated));
    localStorage.setItem('appliedJobs', JSON.stringify(updated.filter(j => j.isApplied)));
  };

  // ─────────────────────────────────────────────────────────────────────
  // TOGGLE CHECKED (independent — coexists with Applied)
  // ─────────────────────────────────────────────────────────────────────
  const toggleChecked = (job) => {
    setTrackedJobs(prev => {
      const existing = prev.find(j => j.jobId === job.jobId);
      const todayStr = new Date().toISOString().split('T')[0];
      let updated;

      if (existing) {
        const newIsChecked = !existing.isChecked;
        // If all flags would become false, remove the entry
        if (!newIsChecked && !existing.isApplied && !existing.isNotRequired) {
          updated = prev.filter(j => j.jobId !== job.jobId);
        } else {
          updated = prev.map(j => j.jobId !== job.jobId ? j : {
            ...j,
            isChecked: newIsChecked,
            isNotRequired: newIsChecked ? false : j.isNotRequired, // checked clears notRequired
            updatedAt: new Date().toISOString()
          });
        }
      } else {
        updated = [...prev, {
          ...job,
          isApplied: false,
          isChecked: true,
          isNotRequired: false,
          userCode: '',
          statusDate: todayStr,
          updatedAt: new Date().toISOString()
        }];
      }

      persistJobs(updated);
      return updated;
    });
  };

  // ─────────────────────────────────────────────────────────────────────
  // TOGGLE NOT REQUIRED (exclusive — clears applied & checked)
  // ─────────────────────────────────────────────────────────────────────
  const toggleNotRequired = (job) => {
    setTrackedJobs(prev => {
      const existing = prev.find(j => j.jobId === job.jobId);
      const todayStr = new Date().toISOString().split('T')[0];
      let updated;

      if (existing && existing.isNotRequired) {
        // Toggle off
        updated = prev.filter(j => j.jobId !== job.jobId);
      } else if (existing) {
        updated = prev.map(j => j.jobId !== job.jobId ? j : {
          ...j,
          isApplied: false,
          isChecked: false,
          isNotRequired: true,
          updatedAt: new Date().toISOString()
        });
      } else {
        updated = [...prev, {
          ...job,
          isApplied: false,
          isChecked: false,
          isNotRequired: true,
          userCode: '',
          statusDate: todayStr,
          updatedAt: new Date().toISOString()
        }];
      }

      persistJobs(updated);
      return updated;
    });
  };

  // ─────────────────────────────────────────────────────────────────────
  // APPLIED MODAL
  // ─────────────────────────────────────────────────────────────────────
  const openAppliedModal = (job) => {
    const existing = getTrackedJob(job.jobId);
    const todayStr = new Date().toISOString().split('T')[0];
    setAppliedModalJob(job);
    setModalUserCode(existing?.userCode || '');
    setModalStatusDate(existing?.statusDate || todayStr);
  };

  const closeAppliedModal = () => {
    setAppliedModalJob(null);
    setModalUserCode('');
  };

  const handleSaveAppliedModal = (e) => {
    if (e) e.preventDefault();
    if (!appliedModalJob) return;

    setTrackedJobs(prev => {
      const existing = prev.find(j => j.jobId === appliedModalJob.jobId);
      const todayStr = new Date().toISOString().split('T')[0];
      let updated;

      if (existing) {
        updated = prev.map(j => j.jobId !== appliedModalJob.jobId ? j : {
          ...j,
          ...appliedModalJob,
          isApplied: true,
          isNotRequired: false, // can't be not-required and applied
          userCode: modalUserCode.trim().toUpperCase(),
          statusDate: modalStatusDate || todayStr,
          updatedAt: new Date().toISOString()
        });
      } else {
        updated = [...prev, {
          ...appliedModalJob,
          isApplied: true,
          isChecked: false,
          isNotRequired: false,
          userCode: modalUserCode.trim().toUpperCase(),
          statusDate: modalStatusDate || todayStr,
          updatedAt: new Date().toISOString()
        }];
      }

      persistJobs(updated);
      return updated;
    });

    closeAppliedModal();
  };

  const handleRemoveAppliedFromModal = () => {
    if (!appliedModalJob) return;
    setTrackedJobs(prev => {
      const existing = prev.find(j => j.jobId === appliedModalJob.jobId);
      let updated;
      if (existing && (existing.isChecked || existing.isNotRequired)) {
        // Keep the job but remove Applied flag
        updated = prev.map(j => j.jobId !== appliedModalJob.jobId ? j : {
          ...j,
          isApplied: false,
          userCode: '',
          updatedAt: new Date().toISOString()
        });
      } else {
        updated = prev.filter(j => j.jobId !== appliedModalJob.jobId);
      }
      persistJobs(updated);
      return updated;
    });
    closeAppliedModal();
  };

  // ─────────────────────────────────────────────────────────────────────
  // EXPORT (standard)
  // ─────────────────────────────────────────────────────────────────────
  const getExportFilteredJobs = () => {
    return trackedJobs.filter(job => {
      if (exportStatusFilter === 'applied' && !job.isApplied) return false;
      if (exportStatusFilter === 'checked' && !job.isChecked) return false;
      if (exportStatusFilter === 'not_required' && !job.isNotRequired) return false;
      const jobDate = job.statusDate || (job.updatedAt ? job.updatedAt.split('T')[0] : '');
      if (exportStartDate && jobDate && jobDate < exportStartDate) return false;
      if (exportEndDate && jobDate && jobDate > exportEndDate) return false;
      return true;
    });
  };

  const exportFilteredJobs = getExportFilteredJobs();

  const exportToCsv = () => {
    if (exportFilteredJobs.length === 0) return;
    const headers = [
      'Job ID', 'Title', 'Company', 'Location', 'Salary', 'Date Posted',
      'Status', 'Applicant Code', 'Status Date', 'Saved By', 'Job URL'
    ];
    const csvRows = [
      headers.join(','),
      ...exportFilteredJobs.map(job => [
        `"${job.jobId || ''}"`,
        `"${(job.title || '').replace(/"/g, '""')}"`,
        `"${(job.company || '').replace(/"/g, '""')}"`,
        `"${(job.location || '').replace(/"/g, '""')}"`,
        `"${(job.salary || '').replace(/"/g, '""')}"`,
        `"${(job.datePosted || '').replace(/"/g, '""')}"`,
        `"${getDerivedStatus(job).toUpperCase()}"`,
        `"${(job.userCode || '').replace(/"/g, '""')}"`,
        `"${job.statusDate || ''}"`,
        `"${currentUser?.username || ''}"`,
        `"${job.url}"`
      ].join(','))
    ].join('\n');
    const blob = new Blob([csvRows], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateTag = exportStartDate || exportEndDate ? `_${exportStartDate || 'start'}_to_${exportEndDate || 'end'}` : '';
    const statusTag = exportStatusFilter !== 'all' ? `_${exportStatusFilter}` : '';
    a.download = `job_tracking${statusTag}${dateTag}.csv`;
    a.click();
  };

  // ─────────────────────────────────────────────────────────────────────
  // APPLICANT CODE HELPERS (multi-format parser)
  // ─────────────────────────────────────────────────────────────────────
  const uniqueApplicantCodes = Array.from(
    new Set(
      trackedJobs
        .filter(j => j.isApplied && j.userCode && j.userCode.trim() !== '')
        .flatMap(j => parseApplicantCodes(j.userCode))
    )
  ).sort();

  const getApplicantJobs = (code = selectedApplicantCode) => {
    const trimmed = (code || '').trim().toUpperCase();
    if (!trimmed) return [];
    return trackedJobs.filter(j => {
      if (!j.isApplied) return false;
      const codes = parseApplicantCodes(j.userCode);
      if (!codes.includes(trimmed)) return false;
      const jobDate = j.statusDate || (j.updatedAt ? j.updatedAt.split('T')[0] : '');
      if (exportStartDate && jobDate && jobDate < exportStartDate) return false;
      if (exportEndDate && jobDate && jobDate > exportEndDate) return false;
      return true;
    });
  };

  const currentApplicantJobs = getApplicantJobs(selectedApplicantCode);

  const exportApplicantReport = (code = selectedApplicantCode) => {
    const trimmed = (code || '').trim().toUpperCase();
    const jobsToExport = getApplicantJobs(trimmed);
    if (jobsToExport.length === 0) return;

    const headers = [
      'Applicant Code', 'Job ID', 'Title', 'Company', 'Location', 'Salary',
      'Date Applied', 'Date Posted', 'Status', 'Cover Letter Required', 'Saved By', 'Job URL'
    ];
    const csvRows = [
      headers.join(','),
      ...jobsToExport.map(job => {
        const jobContact = contactInfo[job.jobId];
        const hasCoverLetter = jobContact?.data
          ? jobContact.data.toLowerCase().includes('cover letter')
          : '';
        return [
          `"${(job.userCode || trimmed).replace(/"/g, '""')}"`,
          `"${job.jobId || ''}"`,
          `"${(job.title || '').replace(/"/g, '""')}"`,
          `"${(job.company || '').replace(/"/g, '""')}"`,
          `"${(job.location || '').replace(/"/g, '""')}"`,
          `"${(job.salary || '').replace(/"/g, '""')}"`,
          `"${job.statusDate || ''}"`,
          `"${(job.datePosted || '').replace(/"/g, '""')}"`,
          `"${getDerivedStatus(job).toUpperCase()}"`,
          `"${hasCoverLetter === true ? 'Yes' : hasCoverLetter === false ? 'No' : 'Unknown'}"`,
          `"${currentUser?.username || ''}"`,
          `"${job.url}"`
        ].join(',');
      })
    ].join('\n');

    const blob = new Blob([csvRows], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateTag = exportStartDate || exportEndDate ? `_${exportStartDate || 'start'}_to_${exportEndDate || 'end'}` : '';
    a.download = `applicant_report_${trimmed}${dateTag}.csv`;
    a.click();
  };

  // ─────────────────────────────────────────────────────────────────────
  // CONTACT INFO
  // ─────────────────────────────────────────────────────────────────────
  const fetchContactInfo = async (jobId, jobUrl) => {
    if (contactInfo[jobId]) return;
    setContactInfo(prev => ({ ...prev, [jobId]: { loading: true } }));
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
      const response = await fetch(`${apiUrl}/job-details?url=${encodeURIComponent(jobUrl)}`);
      const data = await response.json();
      setContactInfo(prev => ({ ...prev, [jobId]: { loading: false, data: data.applyInfo } }));
    } catch (fetchErr) {
      setContactInfo(prev => ({
        ...prev,
        [jobId]: { loading: false, data: fetchErr.message ? `Error: ${fetchErr.message}` : 'Failed to load info.' }
      }));
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // UPLOAD TO SUPABASE (temporary migration button)
  // ─────────────────────────────────────────────────────────────────────
  const uploadToSupabase = async () => {
    setUploadStatus('loading');
    setUploadMessage('');
    try {
      // Ensure stable browser session ID
      let sessionId = localStorage.getItem('browserSessionId');
      if (!sessionId) {
        sessionId = crypto.randomUUID();
        localStorage.setItem('browserSessionId', sessionId);
      }

      const jobs = trackedJobs;
      if (jobs.length === 0) {
        setUploadStatus('error');
        setUploadMessage('No tracked jobs to upload.');
        return;
      }

      const rows = jobs.map(job => ({
        browser_session_id: sessionId,
        username: currentUser?.username || null,
        user_id: null, // we don't store user UUID in localStorage session currently
        job_id: job.jobId,
        title: job.title || null,
        company: job.company || null,
        location: job.location || null,
        salary: job.salary || null,
        date_posted: job.datePosted || null,
        url: job.url || null,
        flags: job.flags || [],
        is_applied: job.isApplied || false,
        is_checked: job.isChecked || false,
        is_not_required: job.isNotRequired || false,
        user_codes: parseApplicantCodes(job.userCode || ''),
        status_date: job.statusDate || null,
        updated_at: job.updatedAt || new Date().toISOString(),
        uploaded_at: new Date().toISOString(),
      }));

      const { error: upsertErr } = await supabase
        .from('tracked_jobs')
        .upsert(rows, { onConflict: 'browser_session_id,job_id' });

      if (upsertErr) throw upsertErr;

      setUploadStatus('success');
      setUploadMessage(`✅ ${jobs.length} jobs uploaded to cloud successfully!`);
    } catch (err) {
      console.error('Upload error:', err);
      setUploadStatus('error');
      setUploadMessage(`❌ Upload failed: ${err.message || 'Unknown error'}`);
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // PAGINATION / UTILS
  // ─────────────────────────────────────────────────────────────────────
  const activeProvinceObj = CANADIAN_PROVINCES.find(p => p.code === province);

  const getPaginationPages = () => {
    const pages = [];
    const maxVisible = 5;
    if (totalPages <= maxVisible + 2) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push('...');
      const start = Math.max(2, page - 1);
      const end = Math.min(totalPages - 1, page + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (page < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  };

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages && newPage !== page) {
      setPage(newPage);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const hasActiveFilters = Boolean(searchQuery || province || internationalOnly || remoteOnly);

  const resetAllFilters = () => {
    setKeyword('');
    setSearchQuery('');
    setProvince('');
    setInternationalOnly(false);
    setRemoteOnly(false);
    setPage(1);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans selection:bg-blue-200">
      {/* Top Navigation */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-sm backdrop-blur-md bg-white/95">
        <div className="max-w-6xl mx-auto px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            
            {/* Logo and Brand */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-700 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
                  <Briefcase className="w-5 h-5" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                    Canadian Job Finder
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-100 text-blue-800">
                      Live
                    </span>
                  </h1>
                  <p className="text-xs text-slate-500 hidden sm:block">
                    Real-time search across government & employer postings
                  </p>
                </div>
              </div>

              {/* Mobile Export + Logout */}
              <div className="flex items-center gap-2 lg:hidden">
                <button 
                  onClick={isApplicantViewActive ? () => exportApplicantReport(selectedApplicantCode) : exportToCsv}
                  disabled={isApplicantViewActive ? currentApplicantJobs.length === 0 : exportFilteredJobs.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  title={isApplicantViewActive ? `Export report for applicant ${selectedApplicantCode}` : "Export tracked jobs to CSV"}
                >
                  <Download className="w-3.5 h-3.5" />
                  Export ({isApplicantViewActive ? currentApplicantJobs.length : exportFilteredJobs.length})
                </button>
              </div>
            </div>
            
            {/* Search Input and Province Selector */}
            <form onSubmit={handleInstantSearch} className="flex flex-col sm:flex-row items-center gap-2 flex-1 max-w-2xl lg:ml-6">
              <div className="relative flex-1 w-full">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Search className="h-4 w-4" />
                </div>
                <input
                  type="text"
                  className="block w-full pl-10 pr-9 py-2.5 text-sm text-slate-900 border border-slate-300 rounded-xl bg-slate-50 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all shadow-sm"
                  placeholder="Job title, NOC code, or skill (e.g. Software, Nurse, Driver)..."
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                />
                {keyword && (
                  <button
                    type="button"
                    onClick={handleClearSearch}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
                    title="Clear search"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Province Dropdown */}
              <div className="relative w-full sm:w-48">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <MapPin className="h-4 w-4" />
                </div>
                <select
                  value={province}
                  onChange={(e) => {
                    setProvince(e.target.value);
                    setPage(1);
                  }}
                  className="block w-full pl-9 pr-8 py-2.5 text-sm border border-slate-300 rounded-xl bg-slate-50 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-medium text-slate-700 transition-all shadow-sm cursor-pointer"
                >
                  {CANADIAN_PROVINCES.map(p => (
                    <option key={p.code} value={p.code}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                className="w-full sm:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2"
              >
                <span>Search</span>
              </button>
            </form>

            {/* Desktop: Export + User info + Logout */}
            <div className="hidden lg:flex items-center gap-3">
              <button 
                onClick={isApplicantViewActive ? () => exportApplicantReport(selectedApplicantCode) : exportToCsv}
                disabled={isApplicantViewActive ? currentApplicantJobs.length === 0 : exportFilteredJobs.length === 0}
                className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 text-white text-xs font-semibold rounded-xl hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
                title={isApplicantViewActive ? `Export report for applicant ${selectedApplicantCode}` : "Export tracked jobs to CSV"}
              >
                <Download className="w-4 h-4" />
                {isApplicantViewActive 
                  ? `Export ${selectedApplicantCode.toUpperCase() || 'Applicant'} (${currentApplicantJobs.length})` 
                  : `Export CSV (${exportFilteredJobs.length})`}
              </button>

              {/* User info pill */}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-xl border border-slate-200">
                <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-white text-[10px] font-bold uppercase">
                  {currentUser?.username?.[0] || 'U'}
                </div>
                <span className="text-xs font-semibold text-slate-700 capitalize">
                  {currentUser?.username || 'User'}
                </span>
              </div>

              <button
                onClick={onLogout}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-xl border border-slate-200 hover:border-red-200 transition-all"
                title="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
                Logout
              </button>
            </div>
          </div>

          {/* Filter Bar & Toggles */}
          <div className="flex flex-wrap items-center justify-between gap-3 mt-3 pt-3 border-t border-slate-100 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              {/* International vs All Jobs Toggle */}
              <button
                type="button"
                onClick={() => {
                  setInternationalOnly(!internationalOnly);
                  setPage(1);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-medium transition-all ${
                  internationalOnly 
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-300 ring-1 ring-emerald-400'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                }`}
                title="Filter for employers recruiting international candidates (LMIA eligible)"
              >
                <Globe2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Canadians & International (LMIA)</span>
                {internationalOnly && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>}
              </button>

              {/* Remote Only Toggle */}
              <button
                type="button"
                onClick={() => {
                  setRemoteOnly(!remoteOnly);
                  setPage(1);
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-medium transition-all ${
                  remoteOnly 
                    ? 'bg-purple-100 text-purple-800 border border-purple-300 ring-1 ring-purple-400'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                }`}
              >
                <Laptop className="w-3.5 h-3.5 text-purple-600" />
                <span>Remote Work</span>
                {remoteOnly && <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>}
              </button>
            </div>

            {/* Sort Control */}
            <div className="flex items-center gap-2">
              <ArrowDownUp className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-slate-500 font-medium">Sort:</span>
              <select 
                value={sort} 
                onChange={(e) => {
                  setSort(e.target.value);
                  setPage(1);
                }}
                className="bg-transparent border-none text-blue-600 font-semibold focus:ring-0 cursor-pointer p-0 text-xs"
              >
                <option value="D">Latest Posted</option>
                <option value="M">Best Match</option>
              </select>
            </div>
          </div>

          {/* Quick Suggestions Chips */}
          <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-slate-100 overflow-x-auto no-scrollbar pb-0.5">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-500" />
              Popular:
            </span>
            <div className="flex items-center gap-1.5">
              {POPULAR_SEARCHES.map((term) => (
                <button
                  key={term}
                  onClick={() => handleSelectQuickChip(term)}
                  className={`px-2.5 py-0.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                    searchQuery.toLowerCase() === term.toLowerCase()
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-blue-50 hover:text-blue-600'
                  }`}
                >
                  {term}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full">
        {/* Results Counter (Live Search mode only) */}
        {!isApplicantViewActive && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              {loading ? (
                <span className="flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
                  <span>Searching Job Bank Canada...</span>
                </span>
              ) : (
                <span>
                  Found <strong className="text-slate-900 font-semibold">{totalJobs.toLocaleString()}</strong> jobs{' '}
                  {activeProvinceObj?.code ? (
                    <>in <strong className="text-blue-600 font-semibold">{activeProvinceObj.label}</strong></>
                  ) : (
                    'across Canada'
                  )}
                  {searchQuery && (
                    <> for &ldquo;<strong className="text-slate-900">{searchQuery}</strong>&rdquo;</>
                  )}
                </span>
              )}
            </div>

            {hasActiveFilters && !loading && (
              <button
                onClick={resetAllFilters}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 underline underline-offset-2"
              >
                Reset all filters
              </button>
            )}
          </div>
        )}

        {/* Job Tracking Status Counters & Export Panel */}
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-sm mb-6 space-y-4">
          {/* Top Row: Live Status Counts & Recent Applicant Code Chips */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 mr-1">
                <Tag className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Tracking:</span>
              </div>

              {/* Applied Counter */}
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold shadow-xs">
                <CheckCircle className="w-4 h-4 text-emerald-600" />
                <span>Applied:</span>
                <span className="px-1.5 py-0.5 rounded-md bg-emerald-600 text-white font-bold text-[11px]">
                  {statusCounts.applied}
                </span>
              </div>

              {/* Checked Counter */}
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-xs font-semibold shadow-xs">
                <Check className="w-4 h-4 text-blue-600" />
                <span>Checked:</span>
                <span className="px-1.5 py-0.5 rounded-md bg-blue-600 text-white font-bold text-[11px]">
                  {statusCounts.checked}
                </span>
              </div>

              {/* Not Required Counter */}
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 text-xs font-semibold shadow-xs">
                <Ban className="w-4 h-4 text-slate-500" />
                <span>Not Required:</span>
                <span className="px-1.5 py-0.5 rounded-md bg-slate-600 text-white font-bold text-[11px]">
                  {statusCounts.notRequired}
                </span>
              </div>
            </div>

            {/* Quick Applicant Code Chips */}
            {uniqueApplicantCodes.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-slate-500 flex-wrap">
                <span className="font-medium text-slate-400">Applicant Codes:</span>
                <div className="flex flex-wrap items-center gap-1">
                  {uniqueApplicantCodes.slice(0, 6).map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        setSelectedApplicantCode(c);
                        setIsApplicantViewActive(true);
                      }}
                      className={`px-2 py-0.5 rounded-md text-xs font-mono font-bold transition-all ${
                        isApplicantViewActive && selectedApplicantCode.toUpperCase() === c
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 border border-slate-200/60'
                      }`}
                      title={`View all jobs applied for applicant ${c}`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Bottom Row: Applicant Filter Input & Date Range Export Controls */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            
            {/* Left: Applicant Code Filter Input & View Switch */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <UserCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="font-semibold text-slate-700">Applicant Code:</span>
              </div>

              <div className="relative flex items-center">
                <input
                  type="text"
                  list="applicant-codes-list"
                  value={selectedApplicantCode}
                  onChange={(e) => setSelectedApplicantCode(e.target.value.toUpperCase())}
                  placeholder="e.g. CG102"
                  className="w-32 sm:w-36 pl-2.5 pr-6 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono font-bold text-slate-900 uppercase placeholder:normal-case placeholder:font-normal placeholder:text-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500 shadow-2xs"
                />
                <datalist id="applicant-codes-list">
                  {uniqueApplicantCodes.map(c => (
                    <option key={c} value={c} />
                  ))}
                </datalist>

                {selectedApplicantCode && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedApplicantCode('');
                      setIsApplicantViewActive(false);
                    }}
                    className="absolute right-1.5 text-slate-400 hover:text-slate-600 p-0.5 rounded"
                    title="Clear applicant code"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* View Applicant Jobs Toggle */}
              <button
                type="button"
                disabled={!selectedApplicantCode.trim()}
                onClick={() => setIsApplicantViewActive(!isApplicantViewActive)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all border ${
                  isApplicantViewActive 
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs' 
                    : 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed'
                }`}
                title="View all jobs applied for this applicant"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>{isApplicantViewActive ? 'Viewing Applicant Jobs' : `View Applied (${currentApplicantJobs.length})`}</span>
              </button>

              {isApplicantViewActive && (
                <button
                  type="button"
                  onClick={() => setIsApplicantViewActive(false)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-all border border-slate-200"
                  title="Switch back to Job Bank Canada live search"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Live Search</span>
                </button>
              )}
            </div>

            {/* Right: Date Range Selector & Export Controls */}
            <div className="flex flex-wrap items-center gap-2.5 pt-3 lg:pt-0 border-t lg:border-t-0 border-slate-100">
              {/* Date Range Selector */}
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <CalendarDays className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="font-medium text-slate-500">From:</span>
                <input
                  type="date"
                  value={exportStartDate}
                  onChange={(e) => setExportStartDate(e.target.value)}
                  className="px-2 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white"
                  title="Filter export starting from this date"
                />
                <span className="font-medium text-slate-500">To:</span>
                <input
                  type="date"
                  value={exportEndDate}
                  onChange={(e) => setExportEndDate(e.target.value)}
                  className="px-2 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white"
                  title="Filter export up to this date"
                />
                {(exportStartDate || exportEndDate) && (
                  <button
                    onClick={() => { setExportStartDate(''); setExportEndDate(''); }}
                    className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded"
                    title="Clear date range filter"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Status Filter Dropdown for Standard Export */}
              {!isApplicantViewActive && (
                <select
                  value={exportStatusFilter}
                  onChange={(e) => setExportStatusFilter(e.target.value)}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                  title="Filter by status for export"
                >
                  <option value="all">All Statuses ({trackedJobs.length})</option>
                  <option value="applied">Applied ({statusCounts.applied})</option>
                  <option value="checked">Checked ({statusCounts.checked})</option>
                  <option value="not_required">Not Required ({statusCounts.notRequired})</option>
                </select>
              )}

              {/* Export Button */}
              {isApplicantViewActive || (selectedApplicantCode.trim() && currentApplicantJobs.length > 0) ? (
                <button
                  type="button"
                  onClick={() => exportApplicantReport(selectedApplicantCode)}
                  disabled={currentApplicantJobs.length === 0}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white text-xs font-semibold rounded-lg shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  title={`Export CSV report for applicant ${selectedApplicantCode.toUpperCase()}`}
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export {selectedApplicantCode.toUpperCase()} Report ({currentApplicantJobs.length})</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={exportToCsv}
                  disabled={exportFilteredJobs.length === 0}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 active:bg-slate-950 text-white text-xs font-semibold rounded-lg shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  title="Export filtered records to CSV"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export ({exportFilteredJobs.length})</span>
                </button>
              )}
            </div>
          </div>

          {/* ─── Upload to Cloud Button (temporary migration) ─── */}
          <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={uploadToSupabase}
                disabled={uploadStatus === 'loading' || trackedJobs.length === 0}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-xs font-semibold rounded-lg shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                title="Upload your current tracked jobs to the cloud database"
              >
                {uploadStatus === 'loading' ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CloudUpload className="w-3.5 h-3.5" />
                )}
                <span>
                  {uploadStatus === 'loading' ? 'Uploading...' : `Upload My Data ☁️ (${trackedJobs.length} jobs)`}
                </span>
              </button>
              <span className="text-[11px] text-slate-400 italic">Temporary — saves your local data to cloud</span>
            </div>
            {uploadMessage && (
              <span className={`text-xs font-medium ${uploadStatus === 'success' ? 'text-emerald-600' : 'text-red-500'}`}>
                {uploadMessage}
              </span>
            )}
          </div>
        </div>

        {/* Applicant View Mode Header Banner */}
        {isApplicantViewActive && (
          <div className="mb-6 p-4 sm:p-5 bg-gradient-to-r from-slate-900 via-blue-950 to-indigo-950 text-white rounded-2xl shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border border-blue-900/50">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-xl bg-blue-600/30 flex items-center justify-center text-white border border-blue-400/30 shrink-0">
                <UserCheck className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs uppercase tracking-wider text-blue-300 font-semibold">Applicant Review Mode</span>
                  <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                    {selectedApplicantCode.toUpperCase() || 'ALL'}
                  </span>
                </div>
                <h2 className="text-lg font-bold text-white mt-0.5">
                  {currentApplicantJobs.length} {currentApplicantJobs.length === 1 ? 'Job' : 'Jobs'} Applied for {selectedApplicantCode.toUpperCase() || 'this applicant'}
                </h2>
                <p className="text-xs text-slate-300 mt-0.5">
                  Reviewing all saved applications in local browser storage {exportStartDate || exportEndDate ? `(filtered by date)` : ''}.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => exportApplicantReport(selectedApplicantCode)}
                disabled={currentApplicantJobs.length === 0}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-xl shadow transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                title="Download CSV report for this applicant"
              >
                <Download className="w-4 h-4" />
                <span>Export Report ({currentApplicantJobs.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setIsApplicantViewActive(false)}
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-white/10 hover:bg-white/20 active:bg-white/30 text-white text-xs font-semibold rounded-xl border border-white/20 transition-all"
                title="Return to Job Bank Canada live job search"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Live Search</span>
              </button>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {error && !isApplicantViewActive && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 mt-0.5 text-red-600 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-red-900">Search Error</h3>
                <p className="text-sm text-red-700 mt-0.5">{error}</p>
              </div>
            </div>
            <button
              onClick={fetchJobs}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-xl transition-colors shadow-sm self-end sm:self-auto flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Try Again
            </button>
          </div>
        )}

        {/* Job Cards List */}
        <div className="space-y-4">
          {!isApplicantViewActive && loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 animate-pulse">
                <div className="flex flex-col sm:flex-row justify-between gap-4">
                  <div className="space-y-3 flex-1">
                    <div className="flex gap-2">
                      <div className="h-4 bg-slate-200 rounded w-16"></div>
                      <div className="h-4 bg-slate-200 rounded w-20"></div>
                    </div>
                    <div className="h-6 bg-slate-200 rounded-md w-3/4"></div>
                    <div className="flex gap-4 pt-1">
                      <div className="h-4 bg-slate-200 rounded w-32"></div>
                      <div className="h-4 bg-slate-200 rounded w-28"></div>
                    </div>
                    <div className="flex gap-4">
                      <div className="h-4 bg-slate-200 rounded w-24"></div>
                      <div className="h-4 bg-slate-200 rounded w-28"></div>
                    </div>
                  </div>
                  <div className="flex gap-2 sm:self-start">
                    <div className="h-10 bg-slate-200 rounded-xl w-10"></div>
                    <div className="h-10 bg-slate-200 rounded-xl w-28"></div>
                  </div>
                </div>
              </div>
            ))
          ) : (isApplicantViewActive ? currentApplicantJobs : jobs).length === 0 && !error ? (
            /* Empty State */
            isApplicantViewActive ? (
              <div className="text-center py-16 px-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 mb-4 shadow-inner">
                  <UserCheck className="h-8 w-8" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">
                  No applied jobs found for applicant code &ldquo;{selectedApplicantCode}&rdquo;
                </h3>
                <p className="mt-1.5 text-sm text-slate-500 max-w-md mx-auto">
                  {exportStartDate || exportEndDate 
                    ? 'No applications match the selected date range. Try clearing or adjusting the From/To dates.'
                    : 'You have not marked any vacancies as applied with this applicant code yet. Return to live search and mark jobs as applied to assign them to this applicant.'}
                </p>
                <div className="mt-6 flex items-center justify-center gap-2">
                  <button
                    onClick={() => setIsApplicantViewActive(false)}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition-colors shadow-sm inline-flex items-center gap-1.5"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back to Live Job Search</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-16 px-4 bg-white rounded-2xl border border-slate-200 shadow-sm">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-50 text-blue-600 mb-4 shadow-inner">
                  <Search className="h-8 w-8" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">No matching jobs found</h3>
                <p className="mt-1.5 text-sm text-slate-500 max-w-md mx-auto">
                  {internationalOnly 
                    ? 'No international-eligible jobs found for this query. Try toggling "Canadians & International" off to search all 65,000+ Canadian jobs.'
                    : 'Try adjusting your search keywords, clearing province filters, or searching for broader terms.'}
                </p>

                <div className="mt-6 flex flex-wrap items-center justify-center gap-2 max-w-lg mx-auto">
                  {POPULAR_SEARCHES.slice(0, 5).map((term) => (
                    <button
                      key={term}
                      onClick={() => handleSelectQuickChip(term)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-700 hover:bg-blue-50 hover:text-blue-600 transition-colors"
                    >
                      Search &ldquo;{term}&rdquo;
                    </button>
                  ))}
                </div>

                {hasActiveFilters && (
                  <div className="mt-6">
                    <button
                      onClick={resetAllFilters}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-xl transition-colors shadow-sm"
                    >
                      Clear All Filters
                    </button>
                  </div>
                )}
              </div>
            )
          ) : (
            /* Job Results List */
            (isApplicantViewActive ? currentApplicantJobs : jobs).map((job, idx) => {
              const trackedJob = getTrackedJob(job.jobId) || job;
              const jobIsApplied = trackedJob?.isApplied || false;
              const jobIsChecked = trackedJob?.isChecked || false;
              const jobIsNotRequired = trackedJob?.isNotRequired || false;
              const jobContact = contactInfo[job.jobId];
              const hasCoverLetter = jobContact?.data
                ? jobContact.data.toLowerCase().includes('cover letter')
                : false;

              // Card border styling: applied takes priority, then checked, then not-required
              // Both applied+checked shows the emerald border with blue tint
              const cardBorderClass = jobIsApplied && jobIsChecked
                ? 'border-emerald-300 bg-emerald-50/25 shadow-emerald-100/50 ring-1 ring-emerald-200/50'
                : jobIsApplied
                ? 'border-emerald-300 bg-emerald-50/25 shadow-emerald-100/50 ring-1 ring-emerald-200/50'
                : jobIsChecked
                ? 'border-blue-300 bg-blue-50/20 ring-1 ring-blue-200/40'
                : jobIsNotRequired
                ? 'border-slate-200 bg-slate-50/70 opacity-65'
                : 'border-slate-200 hover:shadow-md hover:border-blue-300';

              return (
                <div 
                  key={job.jobId || idx} 
                  className={`group bg-white rounded-2xl p-5 sm:p-6 shadow-sm border transition-all duration-200 ${cardBorderClass}`}
                >
                  <div className="flex flex-col lg:flex-row justify-between gap-5 lg:gap-6">
                    <div className="space-y-3 flex-1">
                      {/* Top Row: Job ID + Flags + Cover Letter badge */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {/* Job ID badge */}
                        {job.jobId && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-slate-100 text-slate-500 border border-slate-200">
                            <Hash className="w-3 h-3" />
                            {job.jobId}
                          </span>
                        )}

                        {/* Cover Letter badge (shown once contact info is loaded) */}
                        {hasCoverLetter && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-100 text-rose-700 border border-rose-200">
                            <Mail className="w-3 h-3" />
                            Cover Letter Required
                          </span>
                        )}

                        {/* Regular flags */}
                        {job.flags && job.flags.length > 0 && job.flags.map((flag, fIdx) => {
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
                      <h2 className="text-xl font-bold text-slate-900 group-hover:text-blue-600 transition-colors line-clamp-2">
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
                        <div className="mt-3.5 p-3.5 bg-blue-50/70 rounded-xl border border-blue-200 text-sm animate-fadeIn">
                          <div className="font-semibold text-blue-900 mb-1 flex items-center gap-1.5">
                            <Phone className="w-4 h-4 text-blue-600" />
                            <span>Application & Contact Details</span>
                          </div>
                          <p className="text-xs sm:text-sm font-medium text-slate-700 whitespace-pre-wrap leading-relaxed">
                            {jobContact.data}
                          </p>
                        </div>
                      )}
                    </div>
                    
                    {/* Card Actions Side */}
                    <div className="flex flex-col lg:items-end justify-between gap-3 pt-3 lg:pt-0 lg:border-l lg:border-slate-100 lg:pl-6 min-w-[150px]">
                      <div className="flex gap-2 w-full lg:w-auto">
                        <button
                          onClick={() => fetchContactInfo(job.jobId, job.url)}
                          disabled={jobContact?.loading}
                          className="flex-1 lg:flex-none inline-flex justify-center items-center gap-1.5 px-3.5 py-2.5 bg-white border border-slate-300 hover:border-slate-400 text-slate-700 font-medium rounded-xl hover:bg-slate-50 transition-all shadow-sm active:scale-95 disabled:opacity-50 text-xs"
                          title="Reveal contact email / phone / address"
                        >
                          {jobContact?.loading ? (
                            <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />
                          ) : (
                            <Phone className="w-4 h-4 text-slate-500" />
                          )}
                          <span className="sm:inline">{jobContact ? 'Info' : 'Contact'}</span>
                        </button>
                        
                        <a 
                          href={job.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="flex-1 lg:flex-none inline-flex justify-center items-center gap-1.5 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-xs rounded-xl shadow-sm hover:shadow transition-all active:scale-95"
                        >
                          <span>Apply</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                      
                      {/* 3 Tracking Action Buttons: Checked, Not Required, Applied */}
                      <div className="flex flex-col items-start lg:items-end gap-2 w-full">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {/* Checked Button (independent — coexists with Applied) */}
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

                          {/* Not Required Button (exclusive) */}
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

                        {/* If Applied: Display Applicant Code Pill */}
                        {jobIsApplied && (
                          <div className="flex items-center gap-1.5 text-xs text-slate-600 mt-0.5">
                            <button
                              type="button"
                              onClick={() => openAppliedModal(job)}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 hover:bg-emerald-100 font-mono text-xs font-bold transition-colors cursor-pointer"
                              title="Click to edit applicant code or date"
                            >
                              <Tag className="w-3 h-3 text-emerald-600" />
                              <span>Code: {trackedJob?.userCode || 'None'}</span>
                              <Edit3 className="w-2.5 h-2.5 ml-0.5 text-emerald-600" />
                            </button>
                            {trackedJob?.statusDate && (
                              <span className="text-[11px] text-slate-400 font-medium">
                                ({trackedJob.statusDate})
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Pagination (Live Search mode only) */}
        {!isApplicantViewActive && totalPages > 1 && !loading && (
          <nav className="mt-10 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-slate-200 pt-6">
            <div className="text-xs text-slate-500 order-2 sm:order-1">
              Page <strong className="text-slate-900 font-semibold">{page}</strong> of{' '}
              <strong className="text-slate-900 font-semibold">{totalPages}</strong>{' '}
              ({totalJobs.toLocaleString()} total jobs)
            </div>

            <div className="flex items-center gap-1.5 order-1 sm:order-2">
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1}
                className="flex items-center gap-1 px-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
              >
                <ChevronLeft className="w-4 h-4" />
                <span className="hidden sm:inline">Previous</span>
              </button>

              <div className="flex items-center gap-1">
                {getPaginationPages().map((pNum, pIdx) => {
                  if (pNum === '...') {
                    return (
                      <span key={`ellipsis-${pIdx}`} className="px-2 text-slate-400 text-xs">
                        &hellip;
                      </span>
                    );
                  }
                  return (
                    <button
                      key={pNum}
                      onClick={() => handlePageChange(pNum)}
                      className={`w-8 h-8 rounded-xl text-xs font-semibold transition-all ${
                        page === pNum
                          ? 'bg-blue-600 text-white shadow-sm shadow-blue-500/30'
                          : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {pNum}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= totalPages}
                className="flex items-center gap-1 px-3 py-2 border border-slate-300 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
              >
                <span className="hidden sm:inline">Next</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </nav>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-6 mt-auto text-center">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-xs text-slate-500">
            Canadian Job Finder &bull; Powered by Job Bank Canada public listings &bull; &copy; {new Date().getFullYear()} Dulanja Abeysinghe
          </p>
          {/* Mobile logout */}
          <button
            onClick={onLogout}
            className="lg:hidden flex items-center gap-1.5 text-xs text-slate-500 hover:text-red-600 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Logout ({currentUser?.username})</span>
          </button>
        </div>
      </footer>

      {/* Modal Dialog for Entering Applicant Code & Application Date */}
      {appliedModalJob && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeAppliedModal();
          }}
        >
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-start justify-between gap-4 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                  <CheckCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {getTrackedJob(appliedModalJob.jobId)?.isApplied 
                      ? 'Edit Application Code' 
                      : 'Mark Job as Applied'}
                  </h3>
                  <p className="text-xs text-slate-500 line-clamp-1">
                    {appliedModalJob.title} &bull; {appliedModalJob.company}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeAppliedModal}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveAppliedModal} className="mt-4 space-y-4">
              {/* Applicant Code Input */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-blue-600" />
                  <span>Applicant / Vacancy Code</span>
                  <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  autoFocus
                  required
                  value={modalUserCode}
                  onChange={(e) => setModalUserCode(e.target.value)}
                  placeholder="e.g. CG102 or CA596 CA3927"
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 uppercase tracking-wider transition-all shadow-inner"
                />
                <p className="text-[11px] text-slate-500 mt-1.5 leading-normal">
                  Enter one or more codes (e.g. <strong className="text-slate-800">CG102</strong> or <strong className="text-slate-800">CA596 CA3927</strong>). Separate multiple codes with a space or comma.
                </p>
              </div>

              {/* Status Date Input */}
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <CalendarDays className="w-3.5 h-3.5 text-blue-600" />
                  <span>Application Date</span>
                </label>
                <input
                  type="date"
                  value={modalStatusDate}
                  onChange={(e) => setModalStatusDate(e.target.value)}
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-700 focus:outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all cursor-pointer"
                />
              </div>

              {/* Action Buttons */}
              <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
                {getTrackedJob(appliedModalJob.jobId)?.isApplied ? (
                  <button
                    type="button"
                    onClick={handleRemoveAppliedFromModal}
                    className="px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-xl transition-colors"
                  >
                    Unmark Applied
                  </button>
                ) : (
                  <div></div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={closeAppliedModal}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 rounded-xl shadow-sm transition-all"
                  >
                    Save
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
