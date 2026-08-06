# ultraexpansao

Conjunto de ferramentas internas (HTML/JS estático, sem build step) para a
equipe de expansão da **Infolink Telecom** no Ceará: mapeamento de
concorrência por bairro, cadastro ANATEL, auditoria de campo, controle de KM
e outras planilhas viradas app. Cada pasta é um mini-app independente — não
há bundler, framework ou `package.json`; tudo é HTML/CSS/JS puro, alguns com
dados embutidos diretamente no arquivo (JSON dentro de uma `<script>`).

## Hospedagem

**Produção: https://ultraexpansao.vercel.app** (Vercel, projeto
`riicardoabreu-9783s-projects/ultraexpansao`, conectado ao GitHub — todo push
em `main` faz deploy automático em segundos).

O GitHub Pages (`riicardoabreu-lab.github.io/ultraexpansao`) foi
**desativado** em 2026-08-06 (os deploys estavam falhando/travando com
frequência) — não usar mais essa URL como referência do que está "no ar".

Fluxo de publicação: `git add` → `git commit` → `git push origin main` →
Vercel builda e publica sozinho. Não precisa rodar `vercel` manualmente
(mas o CLI está disponível via `npx vercel` se precisar inspecionar um
deploy específico: `npx vercel ls`, `npx vercel inspect <url>`).

## Estrutura

```
/
├── index.html              → login do portal raiz ("Setor Expansão" + Infolink,
│                              Firebase Auth, mesmo projeto do isp-manage)
├── home.html                → hub com links pros apps abaixo
├── assets/                  → logo, imagens compartilhadas
├── cfo/                     → dashboard de rede/concorrência (o mais complexo)
│   ├── index.html           → login (separado do portal raiz)
│   ├── dashboard.html       → dashboard principal (só acessível após login)
│   ├── kmz/*.kmz             → um KMZ por cidade, pontos de campo (Map Marker)
│   ├── scripts/*.py         → pipelines de importação/geração (ver abaixo)
│   ├── data/dados.json      → atualizado por GitHub Action (API Voalle, ainda não conectada)
│   ├── csv-input/ + relatorios/ → upload manual de CSV → gera .xlsx de bairro
│   └── README.md            → documentação própria desse subsistema
├── isp-manage/index.html    → cadastro de provedores por município (dados ANATEL)
│                              + tracking de visitas/prospecção (Firestore)
├── auditoria-lb/index.html  → auditoria de campo por OS/protocolo (Firestore)
├── controle-km/index.html   → controle de quilometragem
├── avaliacao-provedor/      → calculadora de avaliação de provedor
├── numeracao-ctos/          → numeração de CTOs
└── aquisicoes/               → plataforma de aquisições ISP
```

### `cfo/dashboard.html` — dashboard de rede

Estrutura de dados principal é um objeto JS gigante `let D = {...}` embutido
no próprio HTML (não é um arquivo `.json` separado): `D.fortaleza` (bairros
de Fortaleza, tratados à parte por serem ~110), `D.cidades` (demais
municípios do Ceará, cada um com `bairros`/`providers`/`total_cx`/
`total_clientes`), `D.provedores_geral`. Scripts em `cfo/scripts/` editam
esse objeto via regex (`extract_d_object` / `let D = ` marker) e regravam o
HTML inteiro — **não edite esse JSON à mão**, use os scripts.

A aba "KMZ do Map Marker" é independente do objeto `D`: lê arquivos
`.kmz` estáticos de `cfo/kmz/` via `JSZip` no navegador, registrados no
dicionário `KMZ_CATALOG` dentro do próprio `dashboard.html`. Tem uma opção
"🌎 Todas as cidades" que carrega e combina o KMZ de todas as cidades
cadastradas de uma vez (prefixando bairro com nome da cidade pra evitar
colisão), útil pra filtrar um provedor (ex: Infolink) no Ceará inteiro.

**Scripts (`cfo/scripts/`)**, todos operam direto em `cfo/dashboard.html`:
- `gerar_kmz_mapmarker.py` — gera um `.kmz` a partir do `content.json` bruto
  do Map Marker, para cidades cujo backup tem prefixo
  `CIDADE/bairro/categoria/provedor` (ex: Beberibe, Fortaleza).
- `gerar_kmz_mapmarker_flat.py` — mesma coisa, mas para cidades cujo backup
  **não** tem prefixo de cidade (`bairro/categoria/provedor` direto — a
  maioria dos municípios menores). Aceita `--only`/`--exclude` pra separar
  sub-áreas que vêm juntas no mesmo backup (ex: Redenção veio junto com
  Acarape). Trata variantes de nome de categoria tipo `"CAIXA"` (singular)
  vs `"CAIXAS"` — sempre checar variantes antes de rodar em cidade nova.
- `importar_cidade_mapmarker.py` / `importar_beberibe_mapmarker.py` /
  `importar_bairro_fortaleza.py` — atualizam os números (`D.cidades[...]`
  ou `D.fortaleza`) a partir de um JSON já processado do Map Marker.
- `atualizar_anatel_isp_manage.py` — **não mexe no dashboard.html**, atualiza
  o `isp-manage/index.html` (ver abaixo).
- `buscar_dados.py` / `atualizar_dashboard.py` — integração futura com API
  Voalle (rodada por `.github/workflows/atualizar-dashboard.yml`, hoje
  "placeholder": só roda se os secrets `VOALLE_CLIENT_ID`/`SECRET`
  estiverem configurados).

**Pipeline de importação de bairro/cidade** (Map Marker → Google Drive):
o app Map Marker sincroniza backups em `.zip` pro Google Drive. O jeito
confiável de puxar isso é pedir pro usuário baixar a pasta da cidade
manualmente (Drive → botão direito → baixar) pra
`C:\Users\ricar\Downloads\` e colar o caminho local — **não usar o MCP do
Google Drive pra isso**, ele historicamente retorna conteúdo corrompido/
incompleto pra esses zips grandes. O zip baixado é aninhado: zip externo →
pasta da cidade → vários `.zip` internos com timestamp no nome → pegar o
**lexicograficamente mais recente** (nome começa com `AAAA_MM_DD-HH_MM_SS`)
→ `content.json` lá dentro.

Rodar scripts Python neste repo sempre com `PYTHONUTF8=1` (ex:
`PYTHONUTF8=1 python3 cfo/scripts/algum_script.py ...`) — sem isso,
acentos (ç, á, ã, é) podem corromper silenciosamente no terminal do
git-bash no Windows.

### `isp-manage/index.html` — cadastro de provedores ANATEL

Objeto `const CITIES = {...}` embutido no HTML: por município,
`lat`/`lng`/`regiao` (fixos, definidos manualmente) + `provedores`
(substituído por inteiro a cada atualização da planilha ANATEL — "a
planilha nova é a fonte da verdade"). Atualizar com:

```
PYTHONUTF8=1 python3 cfo/scripts/atualizar_anatel_isp_manage.py "<planilha ANATEL.xlsx>"
```

O script deduplica outorgas repetidas da mesma empresa na mesma cidade
automaticamente. Municípios novos que aparecem na planilha mas não têm
lat/lng cadastrado precisam ser adicionados manualmente em
`NEW_CITIES_GEO` dentro do script antes de rodar (a planilha ANATEL não
traz coordenada nenhuma).

O **status de visita/prospecção** de cada provedor (`visitado`, `ativo`,
`prospectado`, `fechado`, fotos, observações) é um objeto **separado**
(`DB`), salvo em `localStorage` + sincronizado com Firestore
(`syncToCloud()`) — não fica no HTML, então atualizar `CITIES` via git
nunca apaga o progresso de campo da equipe. Existe um botão "🧹
Duplicados" no topo do painel pra juntar entradas duplicadas que esse `DB`
acumula quando a grafia de um provedor muda entre atualizações da ANATEL
(o merge automático compara nome exato).

### Login / autenticação

Vários apps (`index.html` raiz, `isp-manage`, `auditoria-lb`) usam o
**mesmo projeto Firebase** (`isp-manager-ce`) pra login e, em alguns casos,
sincronização de dados (Firestore). `cfo/index.html` tem um login
**separado**, com senha fixa no código (ver aviso em `cfo/README.md` — não
é proteção real, só afasta acesso casual).

## Convenções gerais

- Sem framework/build: edite os `.html` diretamente, sem transpilação.
- Dados "de negócio" grandes (lista de bairros, provedores) ficam
  embutidos como JSON dentro de um `<script>` no próprio HTML, não em
  arquivo separado — ao editar via script Python, sempre localizar o
  marcador (`let D = `, `const CITIES=`) e regravar o HTML inteiro
  preservando o resto do arquivo byte-a-byte.
- Nomes de provedor têm MUITAS variações de grafia/espaço/acento entre
  fontes (Map Marker, ANATEL) — scripts de importação normalmente têm um
  dicionário `PROVIDER_ALIASES` ou lógica de normalização
  (`strip_accents` + `.upper()`) pra evitar duplicar o mesmo provedor sob
  nomes diferentes.
- Arquivos HTML grandes (isp-manage e cfo/dashboard têm alguns MB, com
  linhas de milhões de caracteres) — ferramentas de leitura por linha
  (`Read` com offset/limit) podem estourar limite de tokens numa linha só
  que contém o JSON inteiro; use `grep`/regex por marcador de texto em vez
  de tentar ler a linha inteira.
