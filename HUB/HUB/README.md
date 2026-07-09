# Infolink · Portal (Hub)

Página única de entrada para as ferramentas internas da Infolink.

## Como publicar

1. Crie um repositório novo no GitHub, ex: `riicardoabreu-lab/hub` (pode ser
   público, igual aos outros).
2. Suba os arquivos `index.html` e `home.html` (e este README, opcional)
   na raiz do repositório.
3. Em **Settings → Pages**, ative o GitHub Pages a partir da branch `main`,
   pasta raiz (`/`).
4. A página vai ficar em algo como
   `https://riicardoabreu-lab.github.io/hub/`.

## Login único (SSO simples)

O hub usa `sessionStorage` com a chave **`infolink_hub_auth`**. Como todas
as suas páginas (`cfo`, `controle-km`, `ISP-Manage`, `hub`) vivem no mesmo
domínio (`riicardoabreu-lab.github.io`), o navegador compartilha esse
`sessionStorage` entre elas — **desde que você navegue na mesma aba**
(não abra em aba/janela nova, senão a sessão não é compartilhada).

- O CFO já foi atualizado (`index.html` e `dashboard.html`) para aceitar
  tanto a chave antiga `cfo_auth` quanto a nova `infolink_hub_auth`. Ou
  seja: login pelo hub → clicar em "Abrir CFO" → **não pede senha de novo**.
- **Controle KM** e **ISP Manage** ainda usam login próprio, separado.
  Para integrá-los também, é só adicionar a mesma checagem no topo da
  página deles:

  ```html
  <script>
    if (sessionStorage.getItem('SUA_CHAVE_ATUAL_AQUI') !== 'ok'
        && sessionStorage.getItem('infolink_hub_auth') !== 'ok') {
      window.location.href = 'index.html'; // ou a página de login deles
    }
  </script>
  ```

  E, no formulário de login deles, adicionar
  `sessionStorage.setItem('infolink_hub_auth', 'ok');` junto com o que já
  salvam hoje.

  Manda os arquivos de login dessas duas ferramentas que eu já deixo isso
  pronto — só não tenho o código-fonte delas aqui ainda.

## Automação de cada ferramenta

O objetivo é que **cada ferramenta se atualize sozinha** (upload de
arquivo → GitHub Actions → publica sem você voltar aqui no chat):

- **CFO**: já automatizado — sobe CSV em `csv-input/`, o Actions gera o
  `.xlsx` e atualiza o dashboard sozinho.
- **Controle KM**: já sincroniza com Google Sheets via Apps Script
  (conforme configurado anteriormente).
- **ISP Manage**: ainda não sei qual é o fluxo de atualização de dados
  hoje (upload manual? planilha? outra fonte?). Me conta como você
  atualiza os dados lá hoje que eu desenho a automação certa.
