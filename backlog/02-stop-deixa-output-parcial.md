# PARAR deixa output parcial que vira "completo" no próximo scan

**Prioridade:** 🔴 Crítica (corrompe a biblioteca silenciosamente) · **Confirmado ao vivo:** sim (E2E 2026-06-12)

## Problema

Ao clicar em PARAR, `killAllJobs()` (`main.js` ~383) mata os processos ffmpeg e apaga o progress file, **mas não apaga o arquivo de saída parcial** (`slot.item.saida`). No próximo scan, o filtro de saída incompleta só reprocessa arquivos **< 1 MB** (`main.js` ~266); qualquer parcial maior passa como conversão completa (`done_skip`).

Resultado: o usuário fica com um vídeo truncado em `encoded/` para sempre, achando que foi convertido — e se `deletarOriginal` estiver ativo em sessão futura, pode perder o original de vez.

## Evidência

E2E: encode de vídeo 1080p interrompido ~5s após o início deixou parcial de **25 MB** em `encoded/`. Rescan: "3 arquivos — 0 na fila | 3 ignorados", INICIAR desabilitado — o parcial foi aceito como completo.

## Correção proposta

Duas camadas (ambas valem a pena):

1. **No stop** — em `killAllJobs()`, após matar o processo, deletar `slot.item.saida` (try/catch como os demais unlinks). É a correção principal.
2. **No scan** — o limiar fixo de 1 MB é frágil (cobre só falhas instantâneas). Validar a saída existente com ffprobe (duração ≈ fonte, como o `postProcess` já faz) antes de marcar `done_skip`; se inválida, deletar e re-enfileirar. Custa 1 ffprobe por arquivo já convertido — aceitável, ou opcional via flag.

Atenção à ordem no Windows: deletar o arquivo **depois** que o processo morreu de fato (o kill é assíncrono; pode ser necessário deletar no `close` do processo ou com retry curto, senão o handle aberto bloqueia o unlink).

## Arquivos

- `main.js` — `killAllJobs()` (~383) e pré-filtro do `scan-folder` (~260-275)
- `tests/` — caso novo cobrindo parcial > 1 MB
