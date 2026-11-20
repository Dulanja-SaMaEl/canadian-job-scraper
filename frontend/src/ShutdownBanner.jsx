import { useState, useEffect } from 'react';
import { AlertTriangle, Lock, Clock } from 'lucide-react';

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

export default function ShutdownBanner() {
  const [timeLeft, setTimeLeft] = useState(() => computeTimeLeft());

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(computeTimeLeft());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 30-second Auto-Reload Heartbeat:
  // If the backend version ever changes (e.g. when shutting down tomorrow or pushing a policy change),
  // every open browser tab automatically reloads itself within 30 seconds without user action.
  useEffect(() => {
    const checkVersionHeartbeat = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
        const res = await fetch(`${apiUrl}/health?t=${Date.now()}`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data.version && data.version !== CLIENT_VERSION) {
            window.location.reload();
          }
        }
      } catch {
        // Ignore transient network errors
      }
    };

    checkVersionHeartbeat();
    const interval = setInterval(checkVersionHeartbeat, 30000);
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
