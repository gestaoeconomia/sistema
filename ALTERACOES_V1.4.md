# Gestão Financeira — V1.4 (20/11/2026)

Esta versão traz para o app as melhorias de desempenho e de uso que foram feitas no SIG - Infraestrutura, da V6.3 à V6.17, adaptadas às tabelas deste app. A principal é a **planilha mais leve**, com o formato compactado.

Para o uso do dia a dia, as telas e as regras de cálculo continuam iguais. Rodando o mesmo roteiro de 122 chamadas na V1.3 e na V1.4, as respostas e a planilha final saíram idênticas.

## 1. Planilha mais leve: formato compactado (do SIG V6.16)

### O que muda
- As abas que mais crescem podem ficar com **2 colunas** em vez de 11 a 17:
  - **COMPRAS_CARTAO** (17 colunas);
  - **GASTOS_PIX_DEBITO** (14 colunas);
  - **NOTIFICACOES** (11 colunas).
- Nesse formato, a **coluna A** guarda o ID e a **coluna B** guarda o resto do registro, compactado pelo app.
- O Google cobra o tempo de leitura por célula. Com 3 mil compras e 3 mil pix, abrir o Painel com o cache vencido passou a ler **12 mil células em vez de 94 mil** (87% a menos).
- No SIG, isso levou a leitura de 3,5 s para 0,8 s.
- O app **reconhece o formato pelo cabeçalho** de cada aba, sem nenhuma configuração. Por isso, uma cópia de segurança antiga, em colunas, continua funcionando se for restaurada.

### Como ativar (uma vez, opcional)
Vá em **Minha conta ▸ Planilha de dados ▸ Compactar agora**. Também dá para rodar `compactarPlanilha()` no editor.

1. O app faz uma **cópia de segurança da planilha inteira** na pasta "Backups — Gestão Financeira", com nome `antes_da_compactacao_…`. Se a cópia falhar, nada é alterado.
2. Para cada aba:
   - monta a aba nova ao lado da atual;
   - relê a aba nova e **confere campo a campo** com o que o app enxergava;
   - só então troca as abas.
3. Se a conferência não bater, aquela aba fica exatamente como estava e a mensagem diz o motivo.

O botão **Voltar ao formato de colunas** faz o caminho inverso, com o mesmo cuidado. Pelo editor, use `descompactarPlanilha()`.

### Cuidados
- Abas compactadas **não devem ser editadas à mão**. Se uma linha for estragada, o app mostra um erro com o número da linha, em vez de gravar por cima.
- Cada registro pode ter até **49 mil caracteres**. Acima disso, a gravação é recusada e nada é gravado. Hoje a tela já corta a observação em 300 caracteres.
- As cópias `antes_…` **não são apagadas** pela limpeza dos backups diários.
- O `instalar()` agora deixa as abas compactadas como estão. Antes, ele reescreveria o cabeçalho em colunas.

## 2. Cache e planilha mais rápidos (do SIG V6.3)

### Uma ida ao cache por tela
- Cada tabela fica no cache dividida em blocos de linhas.
- O app aprende quais tabelas cada tela usa. A partir da segunda vez, traz todas elas, junto com a sessão de quem chama, **numa única ida ao cache**.
- No Painel com dados grandes, passaram a ser **2 idas ao cache em vez de 17**.

### Gravar não obriga a reler
- Ao lançar, editar ou excluir, só o bloco alterado é regravado.
- A próxima tela não precisa reler a aba da planilha.

### Propriedades lidas de uma vez
- Versões, contadores e senhas eram lidos com uma chamada por chave: 1.266 leituras no roteiro de teste.
- Agora há **uma leitura por chamada ao servidor**, e as gravações saem juntas, antes de liberar a vez.

### Tabelas que passaram a usar o cache
USUARIOS, FATURAS, ACERTOS e CONFIG. USUARIOS vale 2 minutos, como no SIG.

### Gravações em lote
- O lote de compras e a importação de extrato reservam todos os IDs de uma vez.
- "Marcar notificações como vistas" grava todas juntas.
- Excluir uma meta apaga os depósitos vizinhos de uma vez.

### Medido no roteiro completo (V1.3 → V1.4)
| | V1.3 | V1.4 |
|---|---|---|
| Células lidas da planilha | 12.370 | 2.025 |
| Leituras da planilha | 353 | 111 |
| Idas ao cache | 721 | 297 |
| Chamadas às propriedades | 1.468 | 294 |

Esses números são de chamadas e de volume de dados. O ganho em segundos depende dos serviços do Google e não dá para medir fora deles.

### Opcional: cache sempre pronto
- Rode `criarAcionadorCache()` uma vez no editor.
- A cada 5 minutos, **das 7h às 23h, todos os dias**, o app relê as tabelas cujo cache está para vencer. O horário é diferente do SIG porque este app também é usado à noite e no fim de semana.
- Ninguém espera a planilha ao abrir o app, e o que for alterado à mão aparece em 5 a 10 minutos.
- Para desligar: `removerAcionadorCache()`.
- O `diagnostico()` mostra se o acionador está ligado e quais abas estão compactadas.

## 3. Abrir e entrar com menos idas ao servidor (do SIG V6.3)

| Situação | V1.3 | V1.4 |
|---|---|---|
| Entrar (do botão "Entrar" até o Início pronto) | **8** chamadas | **4** |
| Abrir o app já logado | 5 | 4 |

- **Início em dobro:** ao entrar, o Início era montado duas vezes e pedia resumo e painel em dobro. Agora é montado uma vez.
- **Listas dos formulários:** entrar, retomar a sessão e "quem sou eu" (`/api/eu?dom=1`) já trazem cartões, categorias e pessoas. Isso elimina as duas chamadas a `/api/dominios`.
- **Trocar entre "Entrar" e "Criar conta"** não pergunta de novo ao servidor quem está conectado.

## 4. Tela de abertura (do SIG V6.15.1)
- **"Olá, nome!" sempre que o app abre já logado.**
  - Com "Manter conectado", a saudação aparece desde o primeiro instante.
  - Sem ele, aparece assim que o servidor confirma o acesso.
- **Aviso de demora só quando demora de verdade:**
  - O app guarda a duração das últimas 6 aberturas deste aparelho.
  - O aviso aparece depois de cerca de 2 vezes esse tempo, entre 25 e 50 s. Antes, aparecia sempre aos 15 s e culpava a internet.
  - **Sem internet de verdade**, o aviso aparece na hora e some quando a conexão volta.
  - A tela de abertura espera até 75 s (antes, 30 s).

## 5. Arquivos no celular e impressão (do SIG V6.16.1 e V6.16.2)
- **Arquivo pronto:** no celular, aparece o botão **"Compartilhar"**, que abre o menu do aparelho (Salvar em Arquivos, WhatsApp, e-mail, Imprimir).
- **App aberto pelo atalho da tela inicial:** o botão "Abrir" não aparece mais. Ele levava a uma tela sem barra e sem como voltar.
- **Impressão / salvar PDF:** sai com as cores da tela. Antes, barras, faixas e cabeçalhos sumiam.

## 6. Correção encontrada nos testes
**Minha conta ▸ Site do app:** aparecia um "null" solto na tela quando o app era aberto pelo link do Google. Corrigido.

## O que não veio do SIG, e por quê
Não vieram as funções que só existem no SIG porque dependem do domínio da manutenção predial: chamados, Medição, obras, MPM, permissões por cargo, fornecedores e o painel de demandas com projeção da V6.17.

Algumas melhorias genéricas do SIG **já estavam** na V1.3 e não precisaram vir:
- datas impossíveis;
- senha com espaço ou maiúscula trocada;
- máscara de valor;
- tela de abertura e carregamento;
- horário do Recife;
- `flush` antes de liberar a trava;
- comparação de textos rápida.

## Arquivos alterados
| Arquivo | O que mudou |
|---|---|
| `02_Dados.js` | Reescrito com a camada de dados do SIG: retrato das propriedades, cache em blocos, pré-carga por rota, gravações em lote, formato compactado. |
| `15_Compactar.js` (novo) | Conversão com cópia e conferência; rotas `GET`/`POST /api/banco/formato`; `compactarPlanilha()` e `descompactarPlanilha()`. |
| `01_Web.js` | `api()` com pré-carga e gravações adiadas até antes de soltar a trava. |
| `01a_Acesso.js` | Sessão lida na ida única ao cache; propriedades pelo retrato. |
| `07_Rotas.js` | Listas no login, na retomada e em `/api/eu?dom=1`; IDs em lote; exclusão de depósitos em lote. |
| `08_Extrato.js`, `12_Notificacoes.js`, `10_AcessoExterno.js` | Gravações em lote; retrato das propriedades coerente. |
| `14_Instalar.js` | `aquecerCache`, `criarAcionadorCache`, `removerAcionadorCache`; `instalar()` respeita abas compactadas; backups `antes_…` preservados; `diagnostico()` mais completo. |
| `00_Config.js` | V1.4. |
| `Index.html` | Tela de abertura com aviso adaptativo. |
| `JS_Inicio.html` | Início sem montagem dupla, saudação, menos chamadas. |
| `JS_Base.html` | "Compartilhar" e "Abrir" no aviso de arquivo; listas vindas da retomada. |
| `JS_Conta.html` | Painel "Planilha de dados"; "null" corrigido. |
| `Estilo.html` | Cores na impressão. |

## Como atualizar
1. Suba a pasta `Contas` com `clasp push`, ou substitua os arquivos acima no editor do Apps Script. Não esqueça o novo `15_Compactar.js`.
2. Publique uma nova versão da implantação. O rodapé passa a mostrar **V1.4**.
3. **Site do GitHub Pages:** a pasta `docs/` já foi regerada com `node build.mjs` (o seu `docs/config.js` não muda).
4. Opcionais:
   - **Minha conta ▸ Planilha de dados ▸ Compactar agora**;
   - `criarAcionadorCache()` no editor.

Não precisa rodar `instalar()` de novo nem mexer na planilha.

## Como foi testado
Os testes rodaram num **simulador dos serviços do Google**, que inclui planilha (com a conversão automática de números e datas), propriedades, cache com prazo, trava e Drive. Cada chamada roda numa execução nova, como no Apps Script.

- **V1.3 × V1.4, mesmo roteiro de 122 chamadas.** O roteiro cobre:
  - cadastro, entrar, cartões e 14 compras (parceladas, com aspas, acentos e quebra de linha);
  - lote de compras, pix, importação de extrato (com repetidos), gastos fixos, ganhos, metas, depósitos, excluir meta, limites;
  - editar e excluir compra, divisão, terceiro, fatura paga, encerrar gasto fixo, acerto, notificações;
  - todas as consultas, com o cache vencido e com o cache pronto;
  - CSV, retomar a sessão e sair.

  O resultado foi **respostas idênticas e planilha final idêntica**.
- **Cache × planilha:** depois de cada uma das 121 chamadas, o conteúdo do cache foi comparado com a planilha, tabela por tabela. Ficou sempre idêntico, também com as abas compactadas.
- **Compactada no meio do uso** (pelo editor e pela tela, ida e volta): mesmas respostas da V1.3, e os dados voltam iguais ao formato de colunas.
- **Casos de borda:**
  - registro grande demais;
  - aba estragada à mão (erro com o nº da linha) e depois consertada;
  - cópia de segurança falhando;
  - cabeçalho fora de ordem;
  - sobra de tentativa interrompida;
  - cópia antiga em colunas restaurada;
  - `instalar()` com abas compactadas;
  - pedido sem sessão;
  - formato inválido.
- **Cache:**
  - edição à mão aparece em até 10 minutos;
  - Início com cache pronto faz 1 ida ao cache e não lê a planilha;
  - acionador `aquecerCache` (horário e efeito).
- **Sessão:** senha redefinida derruba a sessão e o "manter conectado" antigos; a senha nova entra e a antiga é recusada.
- **Navegador (Chrome), com as telas de verdade:**
  - entrar, as 9 telas do menu, Minha conta, compactar pelo botão e reabrir já logado;
  - no celular: Início e Minha conta;
  - nenhum erro de página e nenhum "NaN", "undefined" ou "null" na tela.
- **Falta testar no Google de verdade:** o ganho em segundos e o compartilhamento de arquivo no iPhone.
