import { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Search, MapPin, Building2, Banknote, Calendar, ExternalLink, Globe2, 
  AlertCircle, CheckCircle, Download, ArrowDownUp, Phone, X, RefreshCw, 
  Briefcase, ChevronLeft, ChevronRight, Laptop, Sparkles 
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

export default function App() {
  const [keyword, setKeyword] = useState('');
  const debouncedKeyword = useDebounce(keyword, 350);
  const [searchQuery, setSearchQuery] = useState('');
  const [province, setProvince] = useState('');
  const [internationalOnly, setInternationalOnly] = useState(false);
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('D'); // 'D' for Date, 'M' for Match
  const [jobs, setJobs] = useState([]);
  const [totalJobs, setTotalJobs] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [appliedJobs, setAppliedJobs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('appliedJobs')) || [];
    } catch {
      return [];
    }
  });
  const [contactInfo, setContactInfo] = useState({});

  // Ref to cancel pending requests
  const abortControllerRef = useRef(null);

  // Sync debounced keyword to searchQuery and reset page
  useEffect(() => {
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
    // Abort any in-flight request
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
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Failed to fetch jobs (${response.status})`);
      }

      const data = await response.json();
      setJobs(data.jobs || []);
      setTotalJobs(data.totalJobs || 0);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      if (err.name === 'AbortError') return;
      setError(err.message || 'An error occurred while fetching jobs');
    } finally {
      if (abortControllerRef.current === controller) {
        setLoading(false);
      }
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

  const toggleApplied = (job) => {
    setAppliedJobs(prev => {
      const isApplied = prev.some(j => j.jobId === job.jobId);
      let newApplied;
      if (isApplied) {
        newApplied = prev.filter(j => j.jobId !== job.jobId);
      } else {
        newApplied = [...prev, job];
      }
      localStorage.setItem('appliedJobs', JSON.stringify(newApplied));
      return newApplied;
    });
  };

  const exportToCsv = () => {
    if (appliedJobs.length === 0) return;
    const headers = ['Title', 'Company', 'Location', 'Salary', 'Date Posted', 'URL'];
    const csvRows = [
      headers.join(','),
      ...appliedJobs.map(job => [
        `"${(job.title || '').replace(/"/g, '""')}"`,
        `"${(job.company || '').replace(/"/g, '""')}"`,
        `"${(job.location || '').replace(/"/g, '""')}"`,
        `"${(job.salary || '').replace(/"/g, '""')}"`,
        `"${(job.datePosted || '').replace(/"/g, '""')}"`,
        `"${job.url}"`
      ].join(','))
    ].join('\n');
    const blob = new Blob([csvRows], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'applied_jobs.csv';
    a.click();
  };

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

  const activeProvinceObj = CANADIAN_PROVINCES.find(p => p.code === province);

  // Generate pagination page numbers
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

              {/* Mobile Export Button */}
              <button 
                onClick={exportToCsv}
                disabled={appliedJobs.length === 0}
                className="lg:hidden flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Export applied jobs to CSV"
              >
                <Download className="w-3.5 h-3.5" />
                Export ({appliedJobs.length})
              </button>
            </div>
            
            {/* Search Input and Province Selector */}
            <form onSubmit={handleInstantSearch} className="flex flex-col sm:flex-row items-center gap-2 flex-1 max-w-2xl lg:ml-6">
              <div className="relative flex-1 w-full">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Search className="h-4 w-4" />
                </div>
                <input
                  type="text"
                  className="block w-full pl-10 pr-9 py-2.5 text-sm border border-slate-300 rounded-xl bg-slate-50 placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all shadow-sm"
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

              {/* Search Submit Button */}
              <button
                type="submit"
                className="w-full sm:w-auto px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2"
              >
                <span>Search</span>
              </button>
            </form>

            {/* Desktop Export Button */}
            <div className="hidden lg:flex items-center gap-3">
              <button 
                onClick={exportToCsv}
                disabled={appliedJobs.length === 0}
                className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 text-white text-xs font-semibold rounded-xl hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm"
                title="Export applied jobs to CSV"
              >
                <Download className="w-4 h-4" />
                Export Applied ({appliedJobs.length})
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
        {/* Results Counter & Active Filter Tags Bar */}
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

        {/* Error Alert */}
        {error && (
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
          {loading ? (
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
          ) : jobs.length === 0 && !error ? (
            /* Empty State */
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
          ) : (
            /* Job Results List */
            jobs.map((job, idx) => {
              const isApplied = appliedJobs.some(j => j.jobId === job.jobId);
              const jobContact = contactInfo[job.jobId];

              return (
                <div 
                  key={job.jobId || idx} 
                  className={`group bg-white rounded-2xl p-5 sm:p-6 shadow-sm border transition-all duration-200 ${
                    isApplied 
                      ? 'border-emerald-200 bg-emerald-50/20 shadow-emerald-100/50' 
                      : 'border-slate-200 hover:shadow-md hover:border-blue-300'
                  }`}
                >
                  <div className="flex flex-col lg:flex-row justify-between gap-5 lg:gap-6">
                    <div className="space-y-3 flex-1">
                      {/* Flags and Badges */}
                      {job.flags && job.flags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {job.flags.map((flag, fIdx) => {
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
                      )}

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
                      
                      {/* Mark Applied Checkbox */}
                      <label className="flex items-center gap-2 cursor-pointer select-none group/label">
                        <div className={`relative flex items-center justify-center w-5 h-5 rounded-md border transition-all ${
                          isApplied 
                            ? 'bg-emerald-600 border-emerald-600' 
                            : 'border-slate-300 group-hover/label:border-emerald-500 bg-white'
                        }`}>
                          <input 
                            type="checkbox" 
                            className="absolute opacity-0 w-full h-full cursor-pointer" 
                            checked={isApplied}
                            onChange={() => toggleApplied(job)}
                          />
                          {isApplied && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                        </div>
                        <span className={`text-xs font-semibold transition-colors ${
                          isApplied ? 'text-emerald-700' : 'text-slate-500 group-hover/label:text-slate-800'
                        }`}>
                          {isApplied ? 'Applied' : 'Mark Applied'}
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Enhanced Multi-Page Pagination */}
        {totalPages > 1 && !loading && (
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
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <p className="text-xs text-slate-500">
            Canadian Job Finder &bull; Powered by Job Bank Canada public listings &bull; &copy; {new Date().getFullYear()} Dulanja Abeysinghe
          </p>
        </div>
      </footer>
    </div>
  );
}
