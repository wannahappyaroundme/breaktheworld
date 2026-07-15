import { withSupabase } from 'npm:@supabase/server'

import { createIngestHandler } from '../_shared/ingest-handler.ts'

export default {
  fetch: withSupabase(
    { auth: 'publishable' },
    async (request, context) => createIngestHandler(context.supabaseAdmin)(request),
  ),
}
