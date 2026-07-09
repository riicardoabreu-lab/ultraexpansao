# CFO — Dashboard Infolink

Dashboard consolidado (Map Marker Coleta) com atualização automática
via GitHub Actions, integrando futuramente com a API do Voalle.

## Estrutura

```
CFO/
├── .github/
│   └── workflows/
│       ├── atualizar-dashboard.yml     → integração futura com API Voalle
│       └── gerar-relatorio.yml         → gera relatório ao subir CSV em csv-input/
├── scripts/
│   ├── buscar_dados.py                 → busca dados na API do Voalle
│   └── gerar_relatorio_bairro.py       → gera o .xlsx de provedores por bairro
├── csv-input/                          → você só coloca o CSV aqui
├── relatorios/                         → .xlsx gerado automaticamente aparece aqui
├── data/
│   └── dados.json                      → dados atualizados automaticamente
├── index.html                          → tela de login (abre na raiz do GitHub Pages)
└── dashboard.html                      → dashboard (só acessível após login)
```

## Relatório automático de provedores por bairro

1. Exporte o CSV do Map Marker (colunas: `Folder name`, `Latitude`,
   `Longitude`, `Title`, etc — mesmo formato que você já usa).
2. Suba o arquivo em **`csv-input/`** pelo GitHub (Add file → Upload
   files), sem precisar mexer em mais nada.
3. Em segundos, o GitHub Actions roda sozinho:
   - lê o CSV, calcula QTD. CAIXAS e QTD. CLIENTES por provedor, e
     salva um `.xlsx` estilizado em **`relatorios/NOME-DO-BAIRRO.xlsx`**;
   - injeta o mesmo bairro no `dashboard.html` (na cidade correta,
     recalculando os totais), então o gráfico e a tabela do painel já
     aparecem atualizados sem edição manual;
   - tudo é commitado automaticamente no repositório.
4. Para acompanhar o progresso, veja a aba **Actions** do
   repositório — o job se chama "Gerar Relatório de Bairro".

Convenção esperada no CSV: `Folder name` no padrão
`MUNICIPIO/BAIRRO/CAIXAS/PROVEDOR[/TIPO]` (mesmo padrão usado nos
relatórios manuais da Infolink). Se o município ainda não existir no
dashboard, ele é criado automaticamente.

## Login

O acesso é protegido por uma tela de usuário/senha em `index.html`.
As credenciais estão definidas diretamente no código (constante
`CREDENCIAIS`), e a senha padrão é `altere-esta-senha` — **troque
antes de divulgar o link**.

⚠️ **Importante:** essa proteção é apenas visual (roda no navegador
do usuário). Qualquer pessoa com um pouco de conhecimento técnico
consegue ver a senha no código-fonte da página ou acessar
`dashboard.html`/`data/dados.json` diretamente. Não é uma proteção
adequada para dados verdadeiramente sensíveis — serve apenas para
afastar acesso casual de quem não tem o link/senha. Para proteção
real, considere Cloudflare Access ou hospedagem com autenticação
no servidor.

## Como colocar no ar

1. Crie um repositório no GitHub chamado `CFO` (público ou **privado**,
   recomendado privado por conter dados de clientes/rede).
2. Faça upload de todos os arquivos desta pasta mantendo a estrutura
   (a pasta `.github` precisa estar na raiz do repositório).
3. Vá em **Settings → Pages** e ative o GitHub Pages na branch `main`.
   O dashboard ficará em algo como:
   `https://SEU-USUARIO.github.io/CFO/`
4. Quando tiver as credenciais da API do Voalle:
   - Vá em **Settings → Secrets and variables → Actions**
   - Adicione `VOALLE_CLIENT_ID` e `VOALLE_CLIENT_SECRET`
   - Edite `scripts/buscar_dados.py` com as URLs reais da API
     (autenticação e endpoint de dados), conforme a documentação
     fornecida pelo Voalle/TI da Infolink.
5. O workflow em `.github/workflows/atualizar-dashboard.yml` passará
   a rodar automaticamente a cada hora, atualizando `data/dados.json`
   e fazendo commit sozinho — sem necessidade de acessar o GitHub
   manualmente.

## Status atual

- ✅ Dashboard estático (`index.html`) pronto para publicar
- ⏳ Integração com API do Voalle pendente de credenciais/documentação
- ⏳ `data/dados.json` ainda não é consumido pelo `index.html` — isso
  será conectado assim que a API estiver configurada
