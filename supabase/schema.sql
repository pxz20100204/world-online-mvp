create table if not exists public.world_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  channel text not null check (channel in ('world', 'guild', 'peace')),
  author text not null check (char_length(author) between 1 and 16),
  village text not null check (char_length(village) between 1 and 20),
  content text not null check (char_length(content) between 1 and 120),
  translation text not null default '' check (char_length(translation) <= 120),
  language text not null check (language in ('common', 'gold')),
  created_at timestamptz not null default now()
);

create index if not exists world_messages_created_at_idx
  on public.world_messages (created_at desc);

create index if not exists world_messages_channel_created_at_idx
  on public.world_messages (channel, created_at desc);

alter table public.world_messages enable row level security;

drop policy if exists "Authenticated players can read chat" on public.world_messages;
create policy "Authenticated players can read chat"
  on public.world_messages for select
  to authenticated
  using (true);

drop policy if exists "Players can send as themselves" on public.world_messages;
create policy "Players can send as themselves"
  on public.world_messages for insert
  to authenticated
  with check (auth.uid() = user_id);

create or replace function public.enforce_world_message_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.world_messages
    where user_id = new.user_id
      and created_at > now() - interval '3 seconds'
  ) then
    raise exception 'Please wait before sending another message';
  end if;

  if (
    select count(*) from public.world_messages
    where user_id = new.user_id
      and created_at > now() - interval '1 minute'
  ) >= 10 then
    raise exception 'Message rate limit reached';
  end if;

  new.author := trim(new.author);
  new.content := trim(new.content);
  new.translation := trim(new.translation);
  return new;
end;
$$;

drop trigger if exists world_messages_limits on public.world_messages;
create trigger world_messages_limits
  before insert on public.world_messages
  for each row execute function public.enforce_world_message_limits();

do $$
begin
  alter publication supabase_realtime add table public.world_messages;
exception
  when duplicate_object then null;
end $$;
