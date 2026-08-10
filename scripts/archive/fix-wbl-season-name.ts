/**
 * One-off: apply supabase/migrations/20260809180000_fix_wbl_season_name.sql
 * against the live project via the Supabase JS client (mirrors the pattern in
 * scripts/grant-regular-admin.ts). Archived after use — the migration file is
 * the durable record.
 */
import { createClient } from '@supabase/supabase-js';
import { loadSbblCredentials } from '../lib/sbbl-env';

const SEASON_ID = '3baf922e-8f3d-475d-84a1-422b6915e945';

async function main() {
  const creds = loadSbblCredentials();
  const supabase = createClient(creds.supabaseUrl, creds.serviceRoleKey, {
    auth: { persistSession: false },
  });

  console.log(`Project: ${creds.projectRef}`);

  const { data: before } = await supabase
    .from('seasons')
    .select('id, name, league_id')
    .eq('id', SEASON_ID)
    .single();
  console.log('BEFORE:', before);

  if (before?.name !== 'Season 3') {
    console.log(`Skipping — expected name "Season 3", found ${JSON.stringify(before?.name)}. No change made.`);
    return;
  }

  const { data: after, error } = await supabase
    .from('seasons')
    .update({ name: 'Season 2' })
    .eq('id', SEASON_ID)
    .eq('name', 'Season 3')
    .select('id, name, league_id')
    .single();

  if (error) {
    console.error('Update failed:', error);
    process.exit(1);
  }

  console.log('AFTER:', after);
  console.log('✅ WBL season renamed to "Season 2".');
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
