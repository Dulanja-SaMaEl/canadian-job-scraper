import { useState, useEffect, useCallback } from 'react';
import { Search, MapPin, Building2, Banknote, Calendar, ExternalLink, Globe2, AlertCircle } from 'lucide-react';

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
  const [jobs, setJobs] = useState([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
      const response = await fetch(`${apiUrl}/jobs?keywords=${encodeURIComponent(debouncedKeyword)}&page=${page}`);
      
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
  }, [debouncedKeyword, page]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Reset page to 1 when keyword changes
  useEffect(() => {
    setPage(1);
  }, [debouncedKeyword]);

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
                  </div>
                  
                  <div className="flex items-center sm:items-start pt-2 sm:pt-0">
                    <a 
                      href={job.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="w-full sm:w-auto inline-flex justify-center items-center gap-2 px-6 py-2.5 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors active:scale-95"
                    >
                      Apply
                      <ExternalLink className="w-4 h-4" />
                    </a>
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
