-- Schema da tabela mapa_rede (mapa-campo + numeracao-ctos), Supabase/Postgres.
-- Rode isso uma vez no SQL Editor do projeto Supabase (Project → SQL Editor →
-- New query → colar → Run). Substitui o Firestore só pra esses dois apps -
-- ver CLAUDE.md e api/_lib/geogrid.js pro resto do portal (continua Firestore).

create table if not exists mapa_rede (
  id text primary key,
  item text not null,
  sigla text,
  latitude double precision,
  longitude double precision,
  municipio text,
  localidade text,
  status text,
  numero integer,
  splitter text,
  cabo text,
  fibra text,
  potencia text,
  tem_splitter boolean,
  atualizado_em timestamptz not null default now()
);

-- Rodar numa tabela mapa_rede já existente (criada antes desta coluna):
-- alter table mapa_rede add column if not exists tem_splitter boolean;
--
-- tem_splitter: null = ainda não verificado, true/false = resultado da
-- última verificação. Só terminal (CTO) é verificado - gravado pelo botão
-- "🔌 Verificar splitters" do mapa-campo (api/geogrid-manual-sync-splitter.js),
-- que consulta /diagrama/equipamentos/{id} no GeoGrid CTO por CTO (não faz
-- parte da sincronização normal - é uma chamada por CTO, rate limit
-- apertado, só roda quando alguém aperta o botão).

create index if not exists mapa_rede_item_idx on mapa_rede (item);

-- RLS: leitura pública (o mapa-campo usa senha própria fixa, sem conta
-- Supabase - não tem como exigir usuário autenticado aqui; mesmo trade-off
-- já aceito nas regras do Firestore, ver firestore.rules e cfo/README.md -
-- afasta acesso casual, não é proteção real pra quem souber o endpoint).
-- Gravação só pelo backend, com a service_role key (ignora RLS) - a chave
-- pública (anon/publishable) usada no navegador não tem permissão de escrita.
alter table mapa_rede enable row level security;

create policy "Leitura pública" on mapa_rede
  for select
  to anon, authenticated
  using (true);

-- Tempo real: sem isso, o mapa não atualiza sozinho quando o backend grava -
-- precisaria dar refresh manual pra ver itens novos.
alter publication supabase_realtime add table mapa_rede;
