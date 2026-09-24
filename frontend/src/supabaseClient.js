import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * PostgREST / Supabase limits any single .select() query to 1,000 records by default.
 * This helper paginates through all records in chunks of 1,000 so that datasets
 * with >1,000 records (e.g. 1,037 or 10,000) are fetched completely without truncation.
 */
export async function fetchAllTrackedJobs() {
  const allRows = [];
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from('tracked_jobs')
      .select('*')
      .range(from, from + pageSize - 1)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      allRows.push(...data);
      if (data.length < pageSize) {
        hasMore = false;
      } else {
        from += pageSize;
      }
    }
  }

  return allRows;
}
