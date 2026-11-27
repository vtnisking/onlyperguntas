-- Inteligência artificial (Chati Helpdesk): configurações e registro de uso
-- Rode uma vez no Supabase: SQL Editor > New query > colar > Run

-- Configurações por empresa: modelo, liga/desliga e limite de gasto do mês
create table if not exists public.ai_settings (
  company_id        text primary key,
  enabled           boolean      not null default true,
  model             text         not null default 'claude-haiku-5-5',
  monthly_limit_usd numeric(10,2) not null default 0,   -- 0 = sem limite
  updated_at        timestamptz  not null default now(),
  updated_by        text,
  updated_by_name   text
);

-- Cada uso da IA: quem usou, modelo, tokens e custo em dólar
create table if not exists public.ai_usage (
  id            bigint generated always as identity primary key,
  company_id    text        not null,
  user_id       text,
  user_name     text,
  feature       text        not null default 'melhorar_resposta',
  model         text,
  input_tokens  integer     not null default 0,
  output_tokens integer     not null default 0,
  cost_usd      numeric(14,8) not null default 0,
  ok            boolean     not null default true,
  error         text,
  created_at    timestamptz not null default now()
);

create index if not exists ai_usage_company_created_idx
  on public.ai_usage (company_id, created_at desc);

-- Só o servidor do Chati (chave secreta) lê e grava
alter table public.ai_settings enable row level security;
alter table public.ai_usage    enable row level security;

notify pgrst, 'reload schema';
