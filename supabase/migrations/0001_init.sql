-- ===========================================================================
-- TJ SOCIAL — initial schema
-- PostgreSQL / Supabase. Run in the Supabase SQL editor or via `supabase db push`.
--
-- Design notes
--  * All application traffic goes through the Node API using the service role,
--    so RLS below protects direct anon/authenticated access to PostgREST.
--  * Foreign keys use the default constraint names PostgREST relies on for
--    embedded selects (e.g. friendships_requester_id_fkey).
--  * Every hot query path has an index; timeline reads are (created_at desc).
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- utilities
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ------------------------------------------------------------------- users
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  telegram_id text unique,
  handle text unique,
  name text not null check (char_length(name) between 1 and 80),
  username text,
  avatar_url text,
  is_admin boolean not null default false,
  suspended boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists users_created_at_idx on public.users (created_at desc);
create index if not exists users_name_trgm_idx on public.users (lower(name));
create index if not exists users_handle_idx on public.users (handle);

create table if not exists public.profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  cover_url text,
  bio text check (bio is null or char_length(bio) <= 500),
  location text,
  website text,
  privacy text not null default 'public' check (privacy in ('public','friends','private')),
  theme text not null default 'system' check (theme in ('light','dark','system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ groups
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  description text,
  cover_url text,
  privacy text not null default 'public' check (privacy in ('public','private')),
  owner_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists groups_owner_idx on public.groups (owner_id);
create index if not exists groups_created_at_idx on public.groups (created_at desc);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user_idx on public.group_members (user_id);

-- ------------------------------------------------------------------- posts
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.users(id) on delete cascade,
  content text not null default '',
  visibility text not null default 'public' check (visibility in ('public','friends','private')),
  group_id uuid references public.groups(id) on delete cascade,
  shared_post_id uuid references public.posts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint posts_body_present check (char_length(content) > 0 or group_id is not null)
);
create index if not exists posts_created_idx on public.posts (created_at desc) where deleted_at is null;
create index if not exists posts_author_idx on public.posts (author_id, created_at desc) where deleted_at is null;
create index if not exists posts_group_idx on public.posts (group_id, created_at desc) where deleted_at is null;
create index if not exists posts_shared_idx on public.posts (shared_post_id) where shared_post_id is not null;

create table if not exists public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  url text not null,
  type text not null default 'image' check (type in ('image','video')),
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists post_media_post_idx on public.post_media (post_id, position);

create table if not exists public.likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists likes_user_idx on public.likes (user_id, created_at desc);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.users(id) on delete cascade,
  parent_id uuid references public.comments(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 2000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists comments_post_idx on public.comments (post_id, created_at) where deleted_at is null;
create index if not exists comments_parent_idx on public.comments (parent_id) where parent_id is not null;

create table if not exists public.saved_posts (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists saved_posts_user_idx on public.saved_posts (user_id, created_at desc);

-- -------------------------------------------------------------- social graph
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.users(id) on delete cascade,
  addressee_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friendships_not_self check (requester_id <> addressee_id)
);
create unique index if not exists friendships_pair_idx
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists friendships_addressee_idx on public.friendships (addressee_id, status);
create index if not exists friendships_requester_idx on public.friendships (requester_id, status);

create table if not exists public.follows (
  follower_id uuid not null references public.users(id) on delete cascade,
  following_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_not_self check (follower_id <> following_id)
);
create index if not exists follows_following_idx on public.follows (following_id);

create table if not exists public.blocks (
  blocker_id uuid not null references public.users(id) on delete cascade,
  blocked_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);
create index if not exists blocks_blocked_idx on public.blocks (blocked_id);

-- ------------------------------------------------------------------ stories
create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.users(id) on delete cascade,
  media_url text,
  media_type text check (media_type in ('image','video')),
  caption text check (caption is null or char_length(caption) <= 300),
  background text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create index if not exists stories_expiry_idx on public.stories (expires_at desc);
create index if not exists stories_author_idx on public.stories (author_id, created_at desc);

create table if not exists public.story_views (
  story_id uuid not null references public.stories(id) on delete cascade,
  viewer_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (story_id, viewer_id)
);
create index if not exists story_views_viewer_idx on public.story_views (viewer_id);

create table if not exists public.story_reactions (
  story_id uuid not null references public.stories(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  emoji text not null default '❤️' check (char_length(emoji) <= 8),
  created_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

-- --------------------------------------------------------------- messaging
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.users(id) on delete cascade,
  user_b uuid not null references public.users(id) on delete cascade,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint conversations_ordered check (user_a <> user_b)
);
create unique index if not exists conversations_pair_idx
  on public.conversations (least(user_a, user_b), greatest(user_a, user_b));
create index if not exists conversations_user_a_idx on public.conversations (user_a, last_message_at desc);
create index if not exists conversations_user_b_idx on public.conversations (user_b, last_message_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.users(id) on delete cascade,
  body text,
  media_url text,
  media_type text check (media_type in ('image','video')),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint messages_payload check (body is not null or media_url is not null)
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at desc);
create index if not exists messages_unread_idx on public.messages (conversation_id) where read_at is null;

create table if not exists public.typing_indicators (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- ----------------------------------------------------------- notifications
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null check (type in (
    'like','comment','reply','friend_request','friend_accept','follow',
    'message','group_post','group_join','story_view','story_reaction','story_reply','mention','admin'
  )),
  actor_id uuid references public.users(id) on delete set null,
  entity_type text check (entity_type in ('post','comment','story','group','listing','user','conversation')),
  entity_id uuid,
  message text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

-- ------------------------------------------------------------- marketplace
create table if not exists public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '',
  price_cents integer not null default 0 check (price_cents >= 0),
  currency text not null default 'USD' check (char_length(currency) = 3),
  category text not null default 'other',
  location text,
  images jsonb not null default '[]'::jsonb,
  status text not null default 'active' check (status in ('active','sold','removed')),
  created_at timestamptz not null default now()
);
create index if not exists listings_status_idx on public.marketplace_listings (status, created_at desc);
create index if not exists listings_seller_idx on public.marketplace_listings (seller_id);
create index if not exists listings_category_idx on public.marketplace_listings (category, created_at desc);

-- ----------------------------------------------------------------- reports
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.users(id) on delete cascade,
  target_type text not null check (target_type in ('post','comment','user','story','group','listing','message')),
  target_id uuid not null,
  reason text not null check (char_length(reason) between 1 and 80),
  details text,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists reports_status_idx on public.reports (status, created_at desc);
create index if not exists reports_target_idx on public.reports (target_type, target_id);

-- ---------------------------------------------------------------- settings
create table if not exists public.app_settings (
  id integer primary key default 1 check (id = 1),
  site_name text not null default 'TJ SOCIAL',
  tagline text not null default 'Connect. Share. Discover.',
  registration_open boolean not null default true,
  max_upload_mb integer not null default 25 check (max_upload_mb between 1 and 200),
  maintenance_message text not null default '',
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- ------------------------------------------------------- updated_at triggers
drop trigger if exists posts_touch on public.posts;
create trigger posts_touch before update on public.posts
  for each row execute function public.touch_updated_at();
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
drop trigger if exists friendships_touch on public.friendships;
create trigger friendships_touch before update on public.friendships
  for each row execute function public.touch_updated_at();

-- ===========================================================================
-- Row Level Security
-- The Node API connects with the service role and is not restricted by these
-- policies. They exist so a leaked anon key cannot read private data directly.
-- ===========================================================================
alter table public.users                enable row level security;
alter table public.profiles             enable row level security;
alter table public.groups               enable row level security;
alter table public.group_members        enable row level security;
alter table public.posts                enable row level security;
alter table public.post_media           enable row level security;
alter table public.likes                enable row level security;
alter table public.comments             enable row level security;
alter table public.saved_posts          enable row level security;
alter table public.friendships          enable row level security;
alter table public.follows              enable row level security;
alter table public.blocks               enable row level security;
alter table public.stories              enable row level security;
alter table public.story_views          enable row level security;
alter table public.story_reactions      enable row level security;
alter table public.conversations        enable row level security;
alter table public.messages             enable row level security;
alter table public.typing_indicators    enable row level security;
alter table public.notifications        enable row level security;
alter table public.marketplace_listings enable row level security;
alter table public.reports              enable row level security;
alter table public.app_settings         enable row level security;

-- Public directory data is readable by signed-in users only.
create policy users_read on public.users for select to authenticated using (suspended = false);
create policy users_self_update on public.users for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

create policy profiles_read on public.profiles for select to authenticated
  using (privacy = 'public' or auth.uid() = user_id);
create policy profiles_self_write on public.profiles for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy groups_read on public.groups for select to authenticated using (true);
create policy groups_owner_write on public.groups for all to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

create policy group_members_read on public.group_members for select to authenticated using (true);
create policy group_members_join on public.group_members for insert to authenticated
  with check (auth.uid() = user_id);
create policy group_members_leave on public.group_members for delete to authenticated
  using (auth.uid() = user_id);

create policy posts_read on public.posts for select to authenticated
  using (deleted_at is null and (visibility = 'public' or auth.uid() = author_id));
create policy posts_author_write on public.posts for all to authenticated
  using (auth.uid() = author_id) with check (auth.uid() = author_id);

create policy post_media_read on public.post_media for select to authenticated using (true);
create policy post_media_write on public.post_media for all to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()))
  with check (exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));

create policy likes_read on public.likes for select to authenticated using (true);
create policy likes_self_write on public.likes for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy comments_read on public.comments for select to authenticated using (deleted_at is null);
create policy comments_author_write on public.comments for all to authenticated
  using (auth.uid() = author_id) with check (auth.uid() = author_id);

create policy saved_posts_self on public.saved_posts for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy friendships_involved on public.friendships for select to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);
create policy friendships_requester_insert on public.friendships for insert to authenticated
  with check (auth.uid() = requester_id);
create policy friendships_involved_update on public.friendships for update to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id)
  with check (auth.uid() = requester_id or auth.uid() = addressee_id);
create policy friendships_involved_delete on public.friendships for delete to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy follows_read on public.follows for select to authenticated using (true);
create policy follows_self_write on public.follows for all to authenticated
  using (auth.uid() = follower_id) with check (auth.uid() = follower_id);

create policy blocks_self on public.blocks for all to authenticated
  using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

create policy stories_read on public.stories for select to authenticated
  using (expires_at > now());
create policy stories_author_write on public.stories for all to authenticated
  using (auth.uid() = author_id) with check (auth.uid() = author_id);

create policy story_views_self on public.story_views for all to authenticated
  using (auth.uid() = viewer_id) with check (auth.uid() = viewer_id);
create policy story_views_author_read on public.story_views for select to authenticated
  using (exists (select 1 from public.stories s where s.id = story_id and s.author_id = auth.uid()));

create policy story_reactions_read on public.story_reactions for select to authenticated using (true);
create policy story_reactions_self on public.story_reactions for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy conversations_participant on public.conversations for select to authenticated
  using (auth.uid() = user_a or auth.uid() = user_b);
create policy conversations_insert on public.conversations for insert to authenticated
  with check (auth.uid() = user_a or auth.uid() = user_b);

create policy messages_participant on public.messages for select to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid())
  ));
create policy messages_send on public.messages for insert to authenticated
  with check (auth.uid() = sender_id and exists (
    select 1 from public.conversations c
    where c.id = conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid())
  ));
create policy messages_mark_read on public.messages for update to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = conversation_id and (c.user_a = auth.uid() or c.user_b = auth.uid())
  ));

create policy typing_self on public.typing_indicators for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy notifications_own on public.notifications for select to authenticated
  using (auth.uid() = user_id);
create policy notifications_mark_read on public.notifications for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy listings_read on public.marketplace_listings for select to authenticated
  using (status <> 'removed');
create policy listings_seller_write on public.marketplace_listings for all to authenticated
  using (auth.uid() = seller_id) with check (auth.uid() = seller_id);

create policy reports_insert on public.reports for insert to authenticated
  with check (auth.uid() = reporter_id);
create policy reports_own_read on public.reports for select to authenticated
  using (auth.uid() = reporter_id);

create policy app_settings_read on public.app_settings for select to authenticated using (true);

-- ===========================================================================
-- Storage: public bucket for post/story/profile media, writes restricted by
-- the API (service role). Reads are public so Telegram can cache images.
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media', 'media', true, 52428800,
  array['image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/webm','video/quicktime']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists media_public_read on storage.objects;
create policy media_public_read on storage.objects for select
  using (bucket_id = 'media');

-- Only the service role (used by the API) writes objects; anon/authenticated
-- clients cannot upload directly, so every upload passes server validation.
drop policy if exists media_service_write on storage.objects;
create policy media_service_write on storage.objects for insert
  to service_role with check (bucket_id = 'media');

-- ===========================================================================
-- Convenience: promote an administrator by Telegram id
--   select public.promote_admin('123456789');
-- ===========================================================================
create or replace function public.promote_admin(telegram text)
returns void language sql as $$
  update public.users set is_admin = true where telegram_id = telegram;
$$;

revoke all on function public.promote_admin(text) from anon, authenticated;
