# Boot com lastFolder não re-escaneia (tela "vazia" enganosa)

**Prioridade:** 🟢 Baixa · **Confirmado ao vivo:** sim (E2E 2026-06-12)

## Problema

No `config-loaded`, o renderer faz `if (c.lastFolder) setFolder(c.lastFolder)` (`index.html` ~1740). Com `folder` setado, o empty state ("Selecione uma pasta para começar") não aparece — mas **nenhum scan é disparado**. O app abre mostrando a pasta no sidebar, lista de arquivos vazia, contadores zerados e INICIAR desabilitado. Parece quebrado; o usuário precisa entender sozinho que deve clicar em TROCAR PASTA e re-selecionar a mesma pasta.

## Correção proposta

Escolher uma das duas (a primeira é provavelmente a melhor):

1. **Auto-scan no boot:** após hidratar `lastFolder`, disparar o mesmo fluxo de `handleSelectFolder` (sem abrir o dialog) — fatorar o trecho pós-seleção (`setScanning`, `scanFolder`, logs) numa função `scanInto(path)` reutilizada pelos dois caminhos.
2. **Não hidratar `folder`:** mostrar o empty state no boot e usar `lastFolder` apenas como `defaultPath` do dialog (que o main já faz). Menos código, mas perde a conveniência.

Se for a opção 1, cuidado com pastas removíveis/de rede indisponíveis no boot: o `walk()` já tem try/catch no `readdirSync`, então o scan retorna vazio sem quebrar — aceitável, mas vale exibir o empty state nesse caso em vez da lista vazia.

## Arquivos

- `index.html` — listener `config-loaded` (~1733-1743), `handleSelectFolder` (~1833-1847)
