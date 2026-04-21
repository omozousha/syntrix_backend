-- Add explicit avatar reference for user profile.

alter table if exists public.app_users
  add column if not exists avatar_attachment_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'app_users_avatar_attachment_id_fkey'
  ) then
    alter table public.app_users
      add constraint app_users_avatar_attachment_id_fkey
      foreign key (avatar_attachment_id)
      references public.attachments(id)
      on update cascade
      on delete set null;
  end if;
end $$;

create index if not exists idx_app_users_avatar_attachment_id
  on public.app_users(avatar_attachment_id);
