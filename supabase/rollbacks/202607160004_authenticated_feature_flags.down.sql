drop policy if exists "feature_flags_read_public" on public.feature_flags;

create policy "feature_flags_read_public"
on public.feature_flags
for select
to anon
using (true);
