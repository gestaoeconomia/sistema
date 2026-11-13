# Gestão Financeira

Controle de custos do casal: Google Apps Script + Google Planilhas, agora com visual de vidro no estilo iPhone e um site no GitHub Pages que pode ser adicionado à Tela de Início com ícone próprio.

```
Contas/      código do Apps Script (o mesmo que vai para o script.google.com)
icones/      ícone do app (SVG original + PNGs para iPhone/Android/navegador)
docs/        site publicado pelo GitHub Pages (gerado pelo build.mjs)
build.mjs    gera a pasta docs/ a partir de Contas/
```

## 1. Atualizar o Apps Script

1. No editor do Apps Script, substitua estes arquivos pelo conteúdo da pasta `Contas/`
   (ou rode `clasp push` dentro dela):
   `Estilo.html`, `JS_Inicio.html`, `00_Config.js`, `14_Instalar.js`.
2. Execute `criarIcone()` uma vez (troca o ícone da aba do navegador pelo novo).
3. **Implantar › Gerenciar implantações › ✏️ editar › Versão: Nova versão › Implantar.**
   Editar a implantação existente mantém o mesmo link.
4. Copie o **URL do app da Web**, que termina em `/exec`.

> A implantação precisa continuar como *Executar como: eu* e *Quem pode acessar: qualquer pessoa*,
> porque o site do GitHub conversa com o Apps Script por esse link.

## 2. Publicar no GitHub Pages

1. Em github.com, crie um repositório (ex.: `gestao-financeira`).
   No plano gratuito o GitHub Pages só funciona com repositório **público**.
2. **Add file › Upload files** e arraste todo o conteúdo desta pasta (Contas, docs, icones, build.mjs, README.md). Clique em **Commit changes**.
3. Abra `docs/config.js`, clique no lápis ✏️ e cole o link `/exec` entre as aspas:
   ```js
   window.API_URL = 'https://script.google.com/macros/s/AKfy.../exec';
   ```
   Clique em **Commit changes**.
4. **Settings › Pages › Build and deployment**: Source = *Deploy from a branch*, Branch = `main`, pasta = `/docs` › **Save**.
5. Depois de 1 a 2 minutos o site fica no ar em `https://SEU-USUARIO.github.io/gestao-financeira/`.

## 3. Colocar na Tela de Início do iPhone

1. Abra o link do site no **Safari**.
2. Toque em **Compartilhar** (quadrado com a seta) › **Adicionar à Tela de Início** › **Adicionar**.
3. O ícone da casa-cofrinho aparece na tela inicial. O app abre em tela cheia, sem a barra do Safari.

Na primeira vez, entre com e-mail e senha e deixe marcado "Manter-me conectado". O app da Tela de Início guarda a sessão separada da do Safari.

## Atualizações futuras

Altere os arquivos em `Contas/` e envie ao Apps Script como sempre. Para o site acompanhar:

```bash
node build.mjs     # regenera docs/ (não mexe no seu config.js)
```

Depois envie o `docs/index.html` novo para o GitHub. Para o iPhone baixar a versão nova logo, aumente `VERSAO` em `00_Config.js`.

## O que é público

Num repositório público, qualquer pessoa vê o código e o link `/exec`. **Os dados não ficam expostos:** eles ficam na planilha do seu Google Drive, e a API só responde depois do login. As senhas ficam só como hash nas propriedades do script.
