import { useState, useEffect, useCallback } from 'react';
import { Search, MapPin, Building2, Banknote, Calendar, ExternalLink, Globe2, AlertCircle, CheckCircle, Download, ArrowDownUp, Phone } from 'lucide-react';

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
  const debouncedKeyword = useDebounce(keyword, 500);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('D'); // 'D' for Date, 'M' for Match
  const [jobs, setJobs] = useState([]);
  const [appliedJobs, setAppliedJobs] = useState(() => JSON.parse(localStorage.getItem('appliedJobs')) || []);
  const [contactInfo, setContactInfo] = useState({});
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
      const response = await fetch(`${apiUrl}/jobs?keywords=${encodeURIComponent(debouncedKeyword)}&page=${page}&sort=${sort}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch jobs');
      }
      
      const data = await response.json();
      setJobs(data.jobs || []);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      setError(err.message || 'An error occurred while fetching jobs');
    } finally {
      setLoading(false);
    }
  }, [debouncedKeyword, page, sort]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Reset page to 1 when keyword or sort changes
  useEffect(() => {
    setPage(1);
  }, [debouncedKeyword, sort]);

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
    const blob = new Blob([csvRows], { type: 'text/csv' });
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
    } catch (err) {
      setContactInfo(prev => ({ ...prev, [jobId]: { loading: false, data: 'Failed to load info.' } }));
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 text-gray-900 font-sans selection:bg-blue-200">
      <header className="bg-white border-b sticky top-0 z-10 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex flex-col items-center md:items-start">
              <h1 className="text-2xl font-bold text-blue-900 tracking-tight flex items-center gap-2">
                Canadian Job Finder
              </h1>
              <div className="inline-flex items-center gap-1.5 mt-2 bg-green-100 text-green-800 text-xs font-semibold px-2.5 py-1 rounded-full border border-green-200">
                <Globe2 className="w-3.5 h-3.5" />
                Canadians & International Candidates Only
              </div>
            </div>
            
            <div className="w-full md:w-96 relative group">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 group-focus-within:text-blue-500 transition-colors">
                <Search className="h-5 w-5" />
              </div>
              <input
                type="text"
                className="block w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-xl leading-5 bg-gray-50 placeholder-gray-500 focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all shadow-sm"
                placeholder="Search job title or keyword..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
          </div>

          {/* Tools Bar (Sort & Export) */}
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mt-4 pt-4 border-t border-gray-100">
            <div className="flex items-center gap-2 text-sm">
              <ArrowDownUp className="w-4 h-4 text-gray-500" />
              <span className="text-gray-600 font-medium">Sort by:</span>
              <select 
                value={sort} 
                onChange={(e) => setSort(e.target.value)}
                className="bg-transparent border-none text-blue-600 font-semibold focus:ring-0 cursor-pointer p-0"
              >
                <option value="D">Date Posted (Latest First)</option>
                <option value="M">Best Match</option>
              </select>
            </div>
            
            <button 
              onClick={exportToCsv}
              disabled={appliedJobs.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Download className="w-4 h-4" />
              Export Applied ({appliedJobs.length})
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {error && (
          <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="font-semibold">Unable to load jobs</h3>
              <p className="text-sm mt-1">{error}</p>
            </div>
          </div>
        )}

        <div className="space-y-4">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 animate-pulse">
                <div className="flex flex-col sm:flex-row justify-between gap-4">
                  <div className="space-y-3 flex-1">
                    <div className="h-6 bg-gray-200 rounded-md w-3/4"></div>
                    <div className="h-4 bg-gray-200 rounded-md w-1/2"></div>
                    <div className="flex gap-4 pt-2">
                      <div className="h-4 bg-gray-200 rounded-md w-24"></div>
                      <div className="h-4 bg-gray-200 rounded-md w-24"></div>
                    </div>
                  </div>
                  <div className="h-10 bg-gray-200 rounded-lg w-full sm:w-32"></div>
                </div>
              </div>
            ))
          ) : jobs.length === 0 && !error ? (
            <div className="text-center py-20 bg-white rounded-2xl border border-gray-100 shadow-sm">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-50 mb-4">
                <Search className="h-8 w-8 text-gray-400" />
              </div>
              <h3 className="text-lg font-medium text-gray-900">No jobs found</h3>
              <p className="mt-1 text-gray-500 max-w-sm mx-auto">
                Try adjusting your search keywords to find what you're looking for.
              </p>
            </div>
          ) : (
            jobs.map((job, idx) => (
              <div 
                key={job.jobId || idx} 
                className="group bg-white rounded-2xl p-5 sm:p-6 shadow-sm border border-gray-200 hover:shadow-md hover:border-blue-200 transition-all duration-200"
              >
                <div className="flex flex-col sm:flex-row justify-between gap-5 sm:gap-4">
                  <div className="space-y-3 flex-1">
                    {job.flags && job.flags.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-1">
                        {job.flags.map((flag, fIdx) => (
                          <span key={fIdx} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                            {flag}
                          </span>
                        ))}
                      </div>
                    )}
                    <h2 className="text-xl font-semibold text-gray-900 group-hover:text-blue-600 transition-colors line-clamp-2">
                      {job.title}
                    </h2>
                    
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-600">
                      <div className="flex items-center gap-1.5">
                        <Building2 className="w-4 h-4 text-gray-400" />
                        <span className="font-medium text-gray-700">{job.company}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-4 h-4 text-gray-400" />
                        <span>{job.location}</span>
                      </div>
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-600">
                      <div className="flex items-center gap-1.5">
                        <Banknote className="w-4 h-4 text-emerald-500" />
                        <span className="font-medium text-gray-900">{job.salary}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-4 h-4 text-gray-400" />
                        <span>{job.datePosted}</span>
                      </div>
                    </div>
                    
                    {/* Contact Info Section */}
                    {contactInfo[job.jobId] && !contactInfo[job.jobId].loading && (
                      <div className="mt-3 p-3 bg-blue-50/50 rounded-lg border border-blue-100/50">
                        <p className="text-sm font-medium text-blue-900 whitespace-pre-wrap">
                          {contactInfo[job.jobId].data}
                        </p>
                      </div>
                    )}
                  </div>
                  
                  <div className="flex flex-col sm:items-end gap-3 pt-4 sm:pt-0 min-w-[120px]">
                    <div className="flex gap-2 w-full sm:w-auto">
                      <button
                        onClick={() => fetchContactInfo(job.jobId, job.url)}
                        disabled={contactInfo[job.jobId]?.loading}
                        className="flex-1 sm:flex-none inline-flex justify-center items-center gap-2 px-4 py-2.5 bg-white border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-colors active:scale-95 disabled:opacity-50"
                        title="Reveal Phone / Email"
                      >
                        {contactInfo[job.jobId]?.loading ? (
                          <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                          <Phone className="w-4 h-4" />
                        )}
                      </button>
                      
                      <a 
                        href={job.url} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex-1 sm:flex-none inline-flex justify-center items-center gap-2 px-6 py-2.5 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors active:scale-95"
                      >
                        Apply
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </div>
                    
                    <label className="flex items-center gap-2 cursor-pointer group/label">
                      <div className={`relative flex items-center justify-center w-5 h-5 rounded border transition-colors ${appliedJobs.some(j => j.jobId === job.jobId) ? 'bg-green-500 border-green-500' : 'border-gray-300 group-hover/label:border-green-500'}`}>
                        <input 
                          type="checkbox" 
                          className="absolute opacity-0 w-full h-full cursor-pointer" 
                          checked={appliedJobs.some(j => j.jobId === job.jobId)}
                          onChange={() => toggleApplied(job)}
                        />
                        {appliedJobs.some(j => j.jobId === job.jobId) && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                      </div>
                      <span className={`text-sm font-medium select-none ${appliedJobs.some(j => j.jobId === job.jobId) ? 'text-green-600' : 'text-gray-500 group-hover/label:text-gray-700'}`}>
                        {appliedJobs.some(j => j.jobId === job.jobId) ? 'Applied' : 'Mark Applied'}
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Pagination */}
        {jobs.length > 0 && !loading && (
          <div className="mt-10 flex items-center justify-between border-t border-gray-200 pt-6">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <div className="text-sm text-gray-500">
              Page <span className="font-semibold text-gray-900">{page}</span> of{' '}
              <span className="font-semibold text-gray-900">{totalPages || page}</span>
            </div>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= totalPages && totalPages > 1}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </main>

      <footer className="bg-white border-t py-8 mt-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-sm text-gray-500 font-medium">
            &copy; {new Date().getFullYear()} Dulanja Abeysinghe. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
