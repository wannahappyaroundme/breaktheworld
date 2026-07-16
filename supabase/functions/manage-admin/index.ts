import { withSupabase } from 'npm:@supabase/server'

import { createManageAdminHandler } from '../_shared/manage-admin-handler.ts'

export default {
  fetch: withSupabase(
    { auth: 'user' },
    async (request, context) => createManageAdminHandler({
      userClient: context.supabase,
      getAdminClient: () => context.supabaseAdmin,
    })(request),
  ),
}
