-- Reserva de resposta (Chati Helpdesk)
-- Rode uma vez no Supabase: SQL Editor > New query > colar > Run
create table if not exists public.question_reservations (
  id          bigint generated always as identity primary key,
  company_id  text        not null,
  question_id text        not null,
  user_id     text        not null,
  user_name   text,
  created_at  timestamptz not null default now(),
  unique (company_id, question_id)
);

-- Só o servidor do Chati (chave secreta) lê e grava
alter table public.question_reservations enable row level security;

notify pgrst, 'reload schema';
