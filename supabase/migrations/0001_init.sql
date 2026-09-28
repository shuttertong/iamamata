-- แผนที่น้ำท่วม — schema, access rules, storage.
-- Run once in Supabase: Dashboard → SQL Editor (or `supabase db push`).
--
-- Two report kinds share one table:
--   flood — a flooded spot (point) or a flooded stretch of road (path), with a depth level
--   help  — a request for help (point), with needs, people count and a private contact

create extension if not exists postgis with schema extensions;

-- ── Types ────────────────────────────────────────────────────────────
create type public.flood_status as enum ('pending', 'approved', 'rejected', 'expired', 'resolved');
create type public.report_kind as enum ('flood', 'help');
create type public.edit_kind as enum ('move', 'depth', 'receded', 'resolved');

-- ── Service area (keep in sync with CONFIG.map.bounds): AMATA City Chonburi / Phan Thong ──
create or replace function public.in_area(lat double precision, lng double precision) returns boolean
language sql immutable as $$
  select lat between 13.36 and 13.56 and lng between 100.88 and 101.25;
$$;

-- A path is a GeoJSON-order list [[lng, lat], ...] of 2–60 vertices, all inside the area.
create or replace function public.path_ok(p jsonb) returns boolean
language plpgsql immutable as $$
declare pt jsonb;
begin
  if p is null then return true; end if;
  if jsonb_typeof(p) <> 'array' or jsonb_array_length(p) not between 2 and 60 then return false; end if;
  for pt in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(pt) <> 'array' or jsonb_array_length(pt) <> 2
       or jsonb_typeof(pt -> 0) <> 'number' or jsonb_typeof(pt -> 1) <> 'number'
       or not public.in_area((pt ->> 1)::double precision, (pt ->> 0)::double precision) then
      return false;
    end if;
  end loop;
  return true;
end $$;

-- ── Admins ───────────────────────────────────────────────────────────
create table public.admins (
  user_id uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;   -- no policies: not readable through the API

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ── Reports ──────────────────────────────────────────────────────────
create table public.flood_reports (
  id uuid primary key default gen_random_uuid(),
  kind public.report_kind not null default 'flood',
  lat double precision not null,                -- the point, or the middle vertex of a path
  lng double precision not null,
  path jsonb constraint flood_reports_path_ok check (public.path_ok(path)),
  geom extensions.geography(Geometry, 4326),    -- Point or LineString, set by the trigger
  depth smallint check (depth between 1 and 4),
  needs text[] not null default '{}' check (needs <@ array['trapped', 'medical', 'vulnerable', 'food']),
  people smallint check (people between 1 and 500),
  note text check (char_length(note) <= 500),
  photos text[] not null default '{}' check (cardinality(photos) <= 3),
  photo_taken_at timestamptz,
  photo_hash text check (photo_hash ~ '^[0-9a-f]{16}$'),
  device_distance_m real,
  status public.flood_status not null default 'pending',
  reporter_id uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '12 hours',
  reviewed_by uuid references auth.users on delete set null,
  reviewed_at timestamptz,
  reject_reason text,
  constraint flood_reports_in_area check (public.in_area(lat, lng)),
  constraint flood_needs_depth check (kind = 'help' or depth is not null),
  constraint help_is_point check (kind = 'flood' or path is null)
);
create index flood_reports_geom_idx on public.flood_reports using gist (geom);
create index flood_reports_status_idx on public.flood_reports (status, expires_at);
create index flood_reports_reporter_idx on public.flood_reports (reporter_id, created_at);

create or replace function public.flood_reports_before_write() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.in_area(new.lat, new.lng) or not public.path_ok(new.path) then
    raise exception 'outside_area' using errcode = 'P0001';
  end if;
  if new.path is null then
    new.geom := st_setsrid(st_makepoint(new.lng, new.lat), 4326)::geography;
  else
    new.geom := st_setsrid(st_geomfromgeojson(jsonb_build_object('type', 'LineString', 'coordinates', new.path)::text), 4326)::geography;
    if st_length(new.geom) > 5000 then
      raise exception 'path_too_long' using errcode = 'P0001';
    end if;
  end if;
  -- No limit on how often people report (the user's choice): admins sort out duplicates and spam.
  if tg_op = 'INSERT' and not public.is_admin() then
    if exists (select 1 from unnest(new.photos) p where p not like auth.uid()::text || '/%') then
      raise exception 'bad_photo_path' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

create trigger flood_reports_before_write
  before insert or update of lat, lng, path on public.flood_reports
  for each row execute function public.flood_reports_before_write();

alter table public.flood_reports enable row level security;

create policy "public reads approved" on public.flood_reports
  for select to anon, authenticated
  using (status = 'approved' and expires_at > now());

create policy "reporter reads own" on public.flood_reports
  for select to authenticated
  using (reporter_id = auth.uid());

create policy "admin reads all" on public.flood_reports
  for select to authenticated
  using (public.is_admin());

create policy "reporter inserts pending" on public.flood_reports
  for insert to authenticated
  with check (reporter_id = auth.uid() and status = 'pending');

create policy "reporter edits own pending" on public.flood_reports
  for update to authenticated
  using (reporter_id = auth.uid() and status = 'pending')
  with check (reporter_id = auth.uid() and status = 'pending');

create policy "reporter deletes own pending" on public.flood_reports
  for delete to authenticated
  using (reporter_id = auth.uid() and status = 'pending');

-- Column grants: clients may only write these columns. Status, expiry and
-- review fields change only through the functions below.
revoke insert, update, delete on public.flood_reports from anon, authenticated;
grant insert (kind, lat, lng, path, depth, needs, people, note, photos, photo_taken_at, photo_hash, device_distance_m)
  on public.flood_reports to authenticated;
grant update (lat, lng, path, depth, needs, people, note) on public.flood_reports to authenticated;
grant delete on public.flood_reports to authenticated;

-- ── Help contacts: private; only the reporter and admins can read them ──
create table public.help_contacts (
  report_id uuid primary key references public.flood_reports on delete cascade,
  name text check (char_length(name) <= 80),
  phone text not null check (phone ~ '^[0-9+() -]{6,20}$'),
  created_at timestamptz not null default now()
);
alter table public.help_contacts enable row level security;

create policy "reporter adds contact" on public.help_contacts
  for insert to authenticated
  with check (exists (select 1 from public.flood_reports r
                      where r.id = report_id and r.reporter_id = auth.uid() and r.kind = 'help'));

create policy "reporter reads own contact" on public.help_contacts
  for select to authenticated
  using (exists (select 1 from public.flood_reports r where r.id = report_id and r.reporter_id = auth.uid()));

create policy "admin reads contacts" on public.help_contacts
  for select to authenticated using (public.is_admin());

revoke all on public.help_contacts from anon, authenticated;
grant select on public.help_contacts to authenticated;
grant insert (report_id, name, phone) on public.help_contacts to authenticated;

-- ── Edit suggestions (against approved reports) ──────────────────────
create table public.report_edits (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.flood_reports on delete cascade,
  kind public.edit_kind not null,
  lat double precision,
  lng double precision,
  path jsonb constraint report_edits_path_ok check (public.path_ok(path)),
  depth smallint check (depth between 1 and 4),
  status public.flood_status not null default 'pending',
  proposer_id uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users on delete set null,
  reviewed_at timestamptz,
  constraint report_edits_in_area check (lat is null or public.in_area(lat, lng)),
  check (kind <> 'move' or (lat is not null and lng is not null)),
  check (kind <> 'depth' or depth is not null)
);
create index report_edits_status_idx on public.report_edits (status, created_at);

alter table public.report_edits enable row level security;

create policy "proposer reads own" on public.report_edits
  for select to authenticated using (proposer_id = auth.uid());

create policy "admin reads edits" on public.report_edits
  for select to authenticated using (public.is_admin());

create policy "suggest on approved" on public.report_edits
  for insert to authenticated
  with check (
    proposer_id = auth.uid() and status = 'pending'
    and exists (select 1 from public.flood_reports r
                where r.id = report_id and r.status = 'approved' and r.expires_at > now())
  );

revoke insert, update, delete on public.report_edits from anon, authenticated;
grant insert (report_id, kind, lat, lng, path, depth) on public.report_edits to authenticated;

-- ── Admin / owner actions ────────────────────────────────────────────
create or replace function public.review_report(
  p_id uuid, p_approve boolean, p_reason text default null, p_hours int default 12
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  update public.flood_reports set
    status        = case when p_approve then 'approved' else 'rejected' end::public.flood_status,
    reviewed_by   = auth.uid(),
    reviewed_at   = now(),
    reject_reason = case when p_approve then null else left(p_reason, 200) end,
    expires_at    = case when p_approve then now() + make_interval(hours => greatest(1, least(p_hours, 72)))
                         else expires_at end,
    photos        = case when p_approve then photos else '{}' end   -- the admin page deletes the files
  where id = p_id and status = 'pending';
  if not found then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;
  if not p_approve then
    delete from public.help_contacts where report_id = p_id;         -- don't keep contacts of rejected requests
  end if;
end $$;

-- Owner or admin closes a report: help → resolved (ช่วยเหลือแล้ว), flood → expired (น้ำลดแล้ว).
create or replace function public.close_report(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.flood_reports set
    status = case when kind = 'help' then 'resolved' else 'expired' end::public.flood_status,
    expires_at = now()
  where id = p_id and status in ('pending', 'approved')
    and (public.is_admin() or reporter_id = auth.uid());
  if not found then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
end $$;

create or replace function public.review_edit(p_id uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare e public.report_edits;
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  select * into e from public.report_edits where id = p_id and status = 'pending' for update;
  if not found then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;
  update public.report_edits set
    status = case when p_approve then 'approved' else 'rejected' end::public.flood_status,
    reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_id;
  if p_approve then
    if e.kind = 'move' then
      update public.flood_reports set lat = e.lat, lng = e.lng, path = e.path where id = e.report_id;
    elsif e.kind = 'depth' then
      update public.flood_reports set depth = e.depth where id = e.report_id;
    elsif e.kind in ('receded', 'resolved') then
      perform public.close_report(e.report_id);
    end if;
  end if;
end $$;

-- Admin edits a report directly (pending or approved). p_patch may hold any of:
-- lat, lng, path (null = a point), depth, note, needs, people. The trigger re-checks area and path.
create or replace function public.admin_update_report(p_id uuid, p_patch jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  update public.flood_reports set
    lat    = coalesce((p_patch ->> 'lat')::double precision, lat),
    lng    = coalesce((p_patch ->> 'lng')::double precision, lng),
    path   = case when p_patch ? 'path' then nullif(p_patch -> 'path', 'null'::jsonb) else path end,
    depth  = case when p_patch ? 'depth' then (p_patch ->> 'depth')::smallint else depth end,
    note   = case when p_patch ? 'note' then left(p_patch ->> 'note', 500) else note end,
    people = case when p_patch ? 'people' then (p_patch ->> 'people')::smallint else people end,
    needs  = case when p_patch ? 'needs'
                  then array(select jsonb_array_elements_text(p_patch -> 'needs')) else needs end
  where id = p_id and status in ('pending', 'approved');
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end $$;

-- Admin takes a report off the map (wrong, duplicate, abusive). The admin page deletes the photo files.
create or replace function public.admin_remove_report(p_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  update public.flood_reports set
    status = 'rejected', reject_reason = left(p_reason, 200), photos = '{}',
    reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_id and status in ('pending', 'approved');
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  delete from public.help_contacts where report_id = p_id;
end $$;

revoke execute on function public.admin_update_report(uuid, jsonb) from public, anon;
revoke execute on function public.admin_remove_report(uuid, text) from public, anon;
grant execute on function public.admin_update_report(uuid, jsonb) to authenticated;
grant execute on function public.admin_remove_report(uuid, text) to authenticated;

revoke execute on function public.review_report(uuid, boolean, text, int) from public, anon;
revoke execute on function public.review_edit(uuid, boolean) from public, anon;
revoke execute on function public.close_report(uuid) from public, anon;
grant execute on function public.review_report(uuid, boolean, text, int) to authenticated;
grant execute on function public.review_edit(uuid, boolean) to authenticated;
grant execute on function public.close_report(uuid) to authenticated;
grant execute on function public.is_admin() to anon, authenticated;

-- ── Places: factory names for the search box ─────────────────────────
-- OSM names only a few dozen factories here (data/factories.json); admins add the rest here,
-- one by one on the map or by CSV import. Everyone can read; only admins write.
create table public.places (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 160),
  name_en text check (char_length(name_en) <= 160),
  lat double precision not null,
  lng double precision not null,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  constraint places_in_area check (public.in_area(lat, lng))
);
alter table public.places enable row level security;

create policy "anyone reads places" on public.places
  for select to anon, authenticated using (true);
create policy "admin writes places" on public.places
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

revoke insert, update, delete on public.places from anon, authenticated;
grant insert (name, name_en, lat, lng), update (name, name_en, lat, lng), delete on public.places to authenticated;

-- ── Realtime ─────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.flood_reports, public.report_edits;

-- ── Storage: photos ──────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('flood-photos', 'flood-photos', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;

create policy "upload into own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'flood-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "read own, admin, or approved" on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'flood-photos' and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
      or exists (select 1 from public.flood_reports r
                 where r.status = 'approved' and r.expires_at > now()
                   and objects.name = any (r.photos))
    )
  );

create policy "delete own or admin" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'flood-photos'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- ── Scheduled jobs (optional) ────────────────────────────────────────
-- Enable pg_cron first (Dashboard → Database → Extensions), then run:
-- select cron.schedule('flood-expire', '*/15 * * * *', $$
--   update public.flood_reports set status = 'expired'
--   where status in ('pending', 'approved') and expires_at < now();
-- $$);
-- select cron.schedule('help-contact-retention', '0 3 * * *', $$
--   delete from public.help_contacts c using public.flood_reports r
--   where r.id = c.report_id and r.status in ('resolved', 'expired', 'rejected')
--     and r.expires_at < now() - interval '30 days';
-- $$);
-- The public policy already hides expired rows; the first job only tidies the status.
-- Photo retention (delete files 30 days after expiry) needs a scheduled Edge Function
-- using the Storage API — deleting rows from storage.objects does not delete the files.
