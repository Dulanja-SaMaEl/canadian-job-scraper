import { useState, useEffect, useRef } from 'react';
import { AlertTriangle, Lock, Clock, RefreshCw } from 'lucide-react';

export const CLIENT_VERSION = '2026.11.20.v2';

// Fixed global shutdown deadline: 24 hours from deployment (2026-11-21T11:55:00+05:30)
// Using a fixed timestamp ensures refreshing the browser or switching PCs never resets the countdown.
const SHUTDOWN_DEADLINE_MS = new Date('2026-11-21T11:55:00+05:30').getTime();

function computeTimeLeft() {
  const now = Date.now();
  const diff = Math.max(0, SHUTDOWN_DEADLINE_MS - now);

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const totalHours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);

  return {
    diff,
    days,
    hours,
    totalHours,
    minutes,
    seconds,
    formatted: `${String(totalHours).padStart(2, '0')}h : ${String(minutes).padStart(2, '0')}m : ${String(seconds).padStart(2, '0')}s`
  };
}

// Extract the active Vite JS bundle path from the current DOM
function getCurrentScriptSrc() {
  try {
    const scripts = document.querySelectorAll('script[src*="/assets/index-"]');
    if (scripts.length > 0) {
      const src = scripts[0].getAttribute('src') || '';
      const match = src.match(/\/assets\/index-[^"'\s?]+\.js/);
      return match ? match[0] : null;
    }
  } catch {
    // ignore
  }
  return null;
}

export default function ShutdownBanner() {
  const [timeLeft, setTimeLeft] = useState(() => computeTimeLeft());
  const [updateDetected, setUpdateDetected] = useState(false);
  const initialBundleRef = useRef(null);

  useEffect(() => {
    initialBundleRef.current = getCurrentScriptSrc();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(computeTimeLeft());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 15-second Live Deployment & Backend Version Watcher:
  // Checks BOTH:
  // 1. Vercel's /index.html bundle hash (detects ANY Vercel redeploy automatically)
  // 2. Render's /api/health version string
  // When either changes, displays a mandatory refresh notice and reloads automatically.
  useEffect(() => {
    const checkDeploymentUpdate = async () => {
      try {
        // 1. Check Vercel index.html for a new JS bundle hash
        const currentBundle = initialBundleRef.current || getCurrentScriptSrc();
        if (currentBundle) {
          const htmlRes = await fetch(`/?_t=${Date.now()}`, {
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
          });
          if (htmlRes.ok) {
            const htmlText = await htmlRes.text();
            const match = htmlText.match(/\/assets\/index-[^"'\s?]+\.js/);
            if (match && match[0] && match[0] !== currentBundle) {
              setUpdateDetected(true);
              setTimeout(() => window.location.reload(), 2500);
              return;
            }
          }
        }

        // 2. Check Backend /api/health version
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
        const res = await fetch(`${apiUrl}/health?t=${Date.now()}`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data.version && data.version !== CLIENT_VERSION) {
            setUpdateDetected(true);
            setTimeout(() => window.location.reload(), 2500);
          }
        }
      } catch {
        // Ignore transient network errors
      }
    };

    checkDeploymentUpdate();
    const interval = setInterval(checkDeploymentUpdate, 15000);
    return () => clearInterval(interval);
  }, []);

  // Global security lockdown: block Ctrl+P (Print to PDF) and Ctrl+S (Save Webpage)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P' || e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  return (
    <>
      {/* Hard CSS Print Blocker: Prevents saving page data via browser Print-to-PDF */}
      <style>{`
        @media print {
          body * {
            display: none !important;
            visibility: hidden !important;
          }
          body::before {
            content: "🔒 SECURITY LOCK: Printing, PDF saving, and data export are disabled by the Administrator.";
            display: block !important;
            visibility: visible !important;
            padding: 40px !important;
            font-size: 18px !important;
            font-weight: bold !important;
            color: #991b1b !important;
            text-align: center !important;
          }
        }
      `}</style>

      {/* Full-Screen Mandatory Refresh Modal when a new deployment is detected */}
      {updateDetected && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 select-none">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border-2 border-red-500 text-center space-y-4">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-red-100 text-red-600 mx-auto">
              <RefreshCw className="w-7 h-7 animate-spin" />
            </div>
            <h3 className="text-lg font-extrabold text-slate-900">
              System Update Applied
            </h3>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              A new security update has been deployed by the Administrator. Please refresh your browser to continue using the site.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white font-bold text-sm rounded-xl shadow-md transition-all cursor-pointer"
            >
              Refresh Now ( Auto-reloading... )
            </button>
          </div>
        </div>
      )}

      <div className="bg-gradient-to-r from-red-700 via-red-600 to-rose-700 text-white px-4 py-2.5 shadow-md border-b border-red-800 relative z-50 select-none">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs sm:text-sm">
          <div className="flex items-center gap-2.5 text-center sm:text-left">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-white/15 text-amber-300 shrink-0 animate-pulse">
              <AlertTriangle className="w-4 h-4" />
            </span>
            <div>
              <span className="font-extrabold uppercase tracking-wider bg-amber-400 text-red-950 px-2 py-0.5 rounded text-[11px] mr-2">
                URGENT NOTICE
              </span>
              <span className="font-semibold">
                This site will be taken offline in <span className="underline decoration-amber-300 font-extrabold">1 Day</span>.
              </span>
              <span className="hidden md:inline text-red-100 ml-1.5">
                All backup, download, and Excel/CSV export options have been disabled.
              </span>
            </div>
          </div>

          {/* Live Synchronized Countdown Timer */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="inline-flex items-center gap-1.5 bg-red-950/70 border border-red-400/40 px-3 py-1 rounded-xl font-mono text-xs sm:text-sm font-bold text-amber-300 shadow-inner">
              <Clock className="w-3.5 h-3.5 text-amber-400 animate-spin" style={{ animationDuration: '8s' }} />
              <span>Shutdown in:</span>
              <span className="text-white tracking-wider">{timeLeft.formatted}</span>
            </div>
            <span
              className="hidden sm:inline-flex items-center gap-1 bg-red-900/80 border border-red-400/30 px-2.5 py-1 rounded-xl text-[11px] font-semibold text-red-100"
              title="All data exports and backups are locked"
            >
              <Lock className="w-3 h-3 text-amber-300" />
              <span>Exports Locked</span>
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
