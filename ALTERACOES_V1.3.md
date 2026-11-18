# Gestão Financeira — V1.3 (18/11/2026)

Parte da V1.2 deste repositório (visual de vidro, site no GitHub Pages) e junta as novidades abaixo. O visual de vidro, a barra de abas do celular e o site da pasta `docs/` continuam como estavam.

## Novidades do(a) parceiro(a) no sino
- Quando alguém **lança, altera ou exclui** uma compra no cartão ou um pix/débito que entra no acerto, o outro recebe uma notificação no sino. Vale para lançamentos **Dividido** e **Todo do outro**.
- A notificação diz quem fez, o que, quanto, onde e **a parte de quem recebe**. Exemplos:
  - "Fulano lançou uma compra dividida — Mercado · R$ 350,40 no Nubank · dividido · sua parte R$ 175,20";
  - "Geladeira · 10x de R$ 360,00 · sua parte R$ 180,00 por mês (10x)".
- Também avisa quando alguém:
  - **altera** um lançamento dividido, dizendo o que mudou (descrição, valor, data, parcelas…). Mudar só a observação não gera aviso;
  - **tira um lançamento da divisão** ou **passa a dividir** um que era "Só meu";
  - **exclui** um lançamento dividido. Nesse caso, o aviso leva ao Acerto do mês.
- **Lançar vários de uma vez** (lote da fatura ou extrato importado) gera **uma** notificação só, com o resumo e a parte total.
- Lançamentos **"Só meu" não geram nada**: continuam privados.
- **No app:**
  - ao entrar, aparece um aviso rápido ("2 novidades de Fulana — veja no sino");
  - o sino ganha a seção **"Novidades de <nome>"** acima dos avisos;
  - abrir o sino marca as novidades como vistas: o ponto fica vazado e a lista continua lá;
  - tocar numa novidade abre a fatura ou o mês do lançamento;
  - com o app aberto, ele procura novidades a cada 3 minutos e ao voltar para a aba.
- A aba **NOTIFICACOES** é criada sozinha na primeira notificação. Não precisa rodar nada.
- **Arquivos:** `12_Notificacoes.js` (novo), `02_Dados`, `07_Rotas`, `08_Extrato`, `14_Instalar`, `JS_Inicio`, `JS_Base`, `Estilo` e `00_Config` (V1.3).
- **Testes:** 20 verificações novas, todas certas: lançar, alterar, só observação, tirar e voltar a dividir, excluir, "Só meu", pix, lote, lidas, privacidade e sessão. No celular, o aviso ao entrar, o sino e o toque na novidade funcionaram sem erros. As suítes da V1.2 (38) e a regressão contra a V1.1 (37 respostas idênticas) continuam certas.

## Nova logomarca: "Casa em alta"
- **O símbolo:** uma casa cujo telhado vira uma **seta subindo** (laranja), com uma **moeda no lugar da janela**: as finanças da casa crescendo.
  - Ele é a marca do app inteiro: ícone do iPhone e do Android, aba do navegador, menu, tela de entrada e tela de abertura.
  - O original fica em `icones/icone.svg`.
- **Tipografia:** os títulos passaram a usar a **Plus Jakarta Sans**, a fonte da marca (Google Fonts, gratuita). O texto corrido continua em Figtree.
- **Frase da marca na tela de entrada:** "Contas a dois, sem complicação".
- **Cores:** as mesmas do app: Petróleo #0E4D5B, Tangerina #F28C38, Noite #08303A e Névoa #F5F8F8.
- O ícone do Android (maskable) tem margem, porque o Android recorta em círculo.
- O iPhone guarda o ícone antigo: tire o atalho da tela inicial e adicione de novo pelo Safari.
- Saíram da raiz do repositório os 3 PNGs do brasão da Prefeitura (`apple-touch-icon.png`, `icone-192.png`, `icone-512.png`). Eles eram do SIG e foram enviados para cá por engano.

---

# Novidades trazidas do SIG (feitas sobre a V1.1 e juntadas à V1.2 de vidro deste repositório)

Esta versão traz para o app do casal as melhorias do **SIG - Infraestrutura (V6.3 a V6.13)** que fazem sentido aqui.
As regras de cálculo não mudaram: faturas, parcelas, acerto, painel, metas e privacidade dão os mesmos resultados da V1.1.
A planilha também não muda: nenhuma aba nova e nenhuma coluna nova.

## Abertura e navegação (do SIG V6.11.1 a V6.11.3)
- **Tela de abertura:** fundo petróleo com a logomarca.
  - Ela fica na tela até a primeira tela estar pronta. Acabou o "Carregando…" piscando.
  - Embaixo da roda aparece a etapa: "Verificando seu acesso…", depois "Carregando o seu mês…".
  - Ela nunca trava: aos 15 s avisa que está demorando e aos 30 s sai sozinha.
- **Retomar sem mostrar o login:** com "Manter-me conectado" marcado, a abertura diz **"Olá, <seu nome>!"** e "Retomando sua sessão…" e vai direto para o Início.
  - Se não der para retomar (senha trocada ou muito tempo sem usar), aparece o login com o aviso "Sua sessão neste aparelho expirou…". O e-mail já vem preenchido e o cursor fica na senha.
  - Vale também quando a sessão vence com o app aberto.
  - O nome e o e-mail ficam guardados no aparelho **só** com "Manter-me conectado". O botão Sair apaga os dois.
- **Carregamento entre as telas:** mostra o ícone da tela de destino, "Abrindo …", uma frase sobre dinheiro a dois e uma barra.
  - Só aparece se a tela demorar mais de 0,3 s.
  - A tela nova só entra quando estiver pronta, já com os dados.
  - As 25 frases ficam em `JS_Inicio.html`, na lista `FRASES_CARREGANDO`.
- **Erro ao abrir:** sem internet ou com o servidor fora do ar, o app mostra o motivo e o botão "Tentar novamente", em vez de uma tela vazia.
- O app sempre abre no **Início**. Só links com detalhe (por exemplo, `#/faturas?cartao=…`) abrem direto na tela do link.
- Ao trocar de tela, nenhuma janela fica aberta por cima.

## Avisos dentro do app (do SIG V6.5/V6.6: notificações e selos)
- **Sino no topo:** mostra na hora os mesmos lembretes do e-mail, mesmo com os avisos por e-mail desligados:
  - faturas dos seus cartões que vencem em até 3 dias;
  - faturas que venceram há até 10 dias e não foram marcadas como pagas;
  - gastos fixos de pix/débito que vencem em até 3 dias;
  - categorias acima de 80% do limite;
  - acerto pendente do mês que passou, e do mês atual nos 2 últimos dias.
- Os itens mais urgentes ficam em vermelho e no alto. Tocar num item abre a tela certa, já no mês e no cartão do aviso.
- **Selos no menu:** um número laranja ao lado de Início, Acerto do mês, Cartões e faturas e Gastos fixos.
- Privacidade: cada pessoa só vê os avisos das próprias contas.

## Nova tela: Conferência dos dados (do SIG: "Qualidade dos dados")
Fica em Conta ▸ Conferência dos dados. Ela procura nos **seus** lançamentos o que costuma ser erro:
- lançamentos que parecem repetidos (mesmo dia, valor e descrição);
- datas fora do esperado (ano trocado, compra "no futuro");
- lançamentos sem categoria nos últimos 12 meses;
- a mesma categoria escrita de jeitos diferentes ("Casa" e "casa");
- gastos fixos ainda ativos num cartão desativado;
- faturas vencidas que não foram marcadas como pagas;
- terceiros que não pagaram há mais de 60 dias.

A tela não altera nada sozinha: tocar no item abre a tela onde se corrige. "Não é erro" esconde o item, e "Mostrar de novo" traz de volta.

## Site do app nos e-mails
- O acesso pelo celular continua sendo o site da pasta `docs/` (GitHub Pages), como na V1.2 deste repositório.
- **Minha conta › Site do app:** guarda o endereço do site. A partir daí, os e-mails de aviso abrem o site, e não o link do Apps Script, que pede conta Google.
- Aberto pelo próprio site, o botão "Usar este endereço" já preenche.
- Quando não há endereço guardado, o link do Apps Script vai "limpo", sem `/a/macros/dominio/` nem `/u/1/`.

## Ícone da aba (do SIG V6.5)
- O ícone (a logomarca, com cantos arredondados) é publicado no Drive **sozinho**, na primeira abertura. Não precisa mais rodar `criarIcone()`.
- O endereço é conferido antes de ser usado (tem de devolver uma imagem de verdade) e fica guardado no cache. O link antigo (`uc?export=download`) às vezes não funcionava.
- Se não aparecer, rode `diagnosticarIcone()` no editor.
- Se você tinha posto um endereço próprio na propriedade `ICONE_URL`, ele continua valendo.

## Entrada e senha (do SIG V6.4)
- A senha é aceita mesmo com espaço ou quebra de linha nas pontas, o que é comum ao copiar do WhatsApp ou do e-mail.
- A senha também é aceita com a 1ª letra trocada entre maiúscula e minúscula. O corretor do celular costuma criar "Senha123" quando a pessoa digitou "senha123".
- Os campos de e-mail e senha não passam mais pelo corretor nem pela maiúscula automática.
- Nova opção "Mostrar senha" na entrada.

## Datas possíveis (do SIG V6.8)
- Datas e meses só são aceitos entre 2010 e 2100 e se existirem no calendário.
- A mensagem diz o motivo, por exemplo:
  - "Data da compra: ano 2002 muito antigo — confira o ano digitado.";
  - "esse dia não existe no calendário (30/02/2026)".
- Vale para compras, pix/débito, gastos fixos, ganhos, metas, depósitos e acertos.
- Os calendários das telas também só oferecem esse intervalo.

## Arquivos no celular (do SIG V6.4)
- No celular, o "Exportar" (CSV) abre a janela **"Arquivo pronto"**, com o botão Baixar. Antes, o navegador do celular bloqueava o download em silêncio.
- No computador, o arquivo continua baixando direto.

## Menu
- **Recolher menu** (só no computador): o botão no rodapé do menu deixa só os ícones, com os selos. A escolha fica guardada no aparelho.

## Por dentro (do SIG V6.3 e V6.5.6)
- Antes de liberar a vez para a próxima gravação, o app confirma na planilha o que escreveu (`SpreadsheetApp.flush`). Sem isso, duas gravações seguidas podiam disputar a mesma linha.
- As ordenações em português usam um comparador criado uma vez só (`ORD_PT_`). O resultado é igual e a ordenação fica mais rápida.
- Os IDs dos limites (LIM-…) passaram a ser conferidos com os que já existem. Antes, um contador zerado podia repetir um ID.
- **Fuso horário:**
  - o nome do arquivo de backup usa a hora do Recife (antes saía a de Londres);
  - a planilha de dados é acertada para America/Recife na instalação e no backup;
  - `diagnosticarFuso()` confere o fuso do projeto e o da planilha.

## O que ficou de fora (e por quê)
- **Do SIG, por não fazerem sentido num app de duas pessoas:** cargos e permissões, autorização de exclusões, arquivamento anual e todas as telas de chamados, obras, mapa e medição.
- **Cache em blocos e pré-carga por tela (SIG V6.3):** compensam com dezenas de milhares de linhas. No volume de um casal, o cache atual já responde numa ida só.
- **Identidade visual verde da Secretaria:** o app mantém a própria marca (petróleo e tangerina).
- **Campos de 16 px no celular e datas alinhadas no iPhone (SIG V6.5.5):** a V1.1 já tinha esses ajustes.

## Como atualizar
1. **Apps Script:** substitua os arquivos pelo conteúdo de `Contas/` (ou `clasp push`).
   - **Novos:** `01b_Icone.js`, `10_AcessoExterno.js`, `11_Conferencia.js`, `12_Notificacoes.js` e `JS_Conferencia.html`.
   - **Alterados:** `00_Config`, `01_Web`, `01a_Acesso`, `02_Dados`, `03_Regras`, `05_Metas`, `06_Painel`, `07_Rotas`, `08_Extrato`, `09_Avisos`, `14_Instalar`, `Estilo`, `Index`, `JS_Base`, `JS_Conta`, `JS_Inicio` e `appsscript.json`.
2. **Nova permissão:** rode `diagnostico()` no editor e aceite a autorização. A V1.3 usa `script.external_request` para conferir o ícone da aba.
3. **Implantar ▸ Gerenciar implantações ▸ editar ▸ Nova versão.** Assim o link `/exec` continua o mesmo e o `docs/config.js` não precisa mudar.
4. **GitHub:** a pasta `docs/` já foi gerada com `node build.mjs`. Envie `Contas/`, `docs/`, `icones/`, `README.md` e este arquivo. O `docs/config.js` não mudou.
5. As abas NOTIFICACOES (avisos do parceiro) e CONFIG ganham linhas sozinhas. Não precisa mexer na planilha.

## Testes
- **Regressão:** o mesmo cenário (2 pessoas, 3 cartões, compras parceladas, terceiro, pix, gastos fixos, ganhos, limite, meta e acerto) rodou na V1.1 e na V1.2. As **37 respostas** das telas (Início, painel, faturas, parcelamentos, pix, fixos, metas, ganhos, acerto, histórico, terceiros, evolução, reserva, limites e o CSV) saíram **idênticas**.
- **Novidades (38 verificações, todas certas):**
  - senha tolerante;
  - datas impossíveis;
  - sino, selos e privacidade dos avisos;
  - as 7 conferências e o "Não é erro";
  - link do Apps Script normalizado;
  - ícone validado;
  - e-mail de aviso com o link do site;
  - flush antes de soltar a trava;
  - IDs LIM;
  - rotas novas exigindo sessão.
- **No Chrome, pelo site gerado em `docs/` (computador e celular), sem erros de JavaScript:**
  - abertura, login, Início, sino e selos;
  - carregamento entre as telas;
  - Conferência e menu recolhido;
  - Minha conta;
  - retomada com "Olá, <seu nome>!";
  - sessão expirada (login com aviso e e-mail preenchido);
  - servidor fora do ar ("Tentar novamente");
  - "Arquivo pronto" no celular.
- **Os testes foram feitos num simulador do Apps Script.** O Google não foi testado de verdade: implantação, autorização, Drive e e-mail real. Confira o ícone da aba e o e-mail de teste depois de publicar.
