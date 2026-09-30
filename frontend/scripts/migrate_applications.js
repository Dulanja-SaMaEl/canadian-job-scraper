import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://xyezqzdpifgjztdgtsum.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh5ZXpxemRwaWZnanp0ZGd0c3VtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNzIyNDAsImV4cCI6MjEwNTg0ODI0MH0.sCldp0mFTSoqKPHjV7IDUR5_PAZsAcjJNSJ6nrjdQ80';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

function parseCodes(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.flatMap(c => parseCodes(c));
  return String(raw).split(/[\s,/|;]+/).map(c => c.trim().toUpperCase()).filter(Boolean);
}

async function migrate() {
  console.log('--- STARTING JOB APPLICATIONS MIGRATION ---');

  // Check if table exists
  const { error: testErr } = await supabase.from('job_applications').select('id').limit(1);
  if (testErr) {
    console.error('Table job_applications error:', testErr.message);
    return;
  }

  // 1. Fetch all tracked_jobs
  let allRows = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase.from('tracked_jobs').select('*').range(from, from + 999).order('updated_at', { ascending: false });
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }

  console.log(`Fetched ${allRows.length} jobs from tracked_jobs.`);

  // 2. Parse and build applications
  const applicationsToMigrate = [];
  const seen = new Set();

  allRows.forEach(job => {
    if (!job.is_applied && (!job.user_codes || job.user_codes.length === 0)) return;
    const codes = parseCodes(job.user_codes);
    const dateStr = job.status_date || (job.updated_at ? job.updated_at.split('T')[0] : new Date().toISOString().split('T')[0]);
    const appliedAt = job.updated_at || (dateStr ? `${dateStr}T12:00:00.000Z` : new Date().toISOString());
    const appliedBy = job.username || 'Unknown';

    codes.forEach(code => {
      const key = `${job.job_id}_${code}`;
      if (!seen.has(key)) {
        seen.add(key);
        applicationsToMigrate.push({
          job_id: String(job.job_id),
          applicant_code: code,
          applied_by: appliedBy,
          applied_at: appliedAt,
          status_date: dateStr
        });
      }
    });
  });

  console.log(`Prepared ${applicationsToMigrate.length} distinct application records to backfill.`);

  // 3. Batch upsert into job_applications in chunks of 50
  const chunkSize = 50;
  let inserted = 0;
  for (let i = 0; i < applicationsToMigrate.length; i += chunkSize) {
    const chunk = applicationsToMigrate.slice(i, i + chunkSize);
    const { error: upsertErr } = await supabase
      .from('job_applications')
      .upsert(chunk, { onConflict: 'job_id,applicant_code' });

    if (upsertErr) {
      console.error(`Error at chunk ${i}:`, upsertErr);
      throw upsertErr;
    }
    inserted += chunk.length;
    if (inserted % 200 === 0 || inserted === applicationsToMigrate.length) {
      console.log(`Progress: ${inserted} / ${applicationsToMigrate.length} applications saved...`);
    }
  }

  // 4. Verify count in job_applications
  const { count, error: countErr } = await supabase
    .from('job_applications')
    .select('*', { count: 'exact', head: true });

  console.log('--- MIGRATION COMPLETE ---');
  console.log('Total verified records in job_applications:', count, countErr || 'OK');
}

migrate().catch(console.error);
