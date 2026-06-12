# Arquivos pulados (JÁ OK / HEVC) são invisíveis na UI

**Prioridade:** 🟡 Média (UX confusa) · **Confirmado ao vivo:** sim (E2E 2026-06-12)

## Problema

A lista de arquivos filtra `done_skip` e `hevc_skip` de **todos** os filtros, inclusive "Todos" (`index.html` ~1075):

```js
let list = files.filter(f=>!["done_skip","hevc_skip"].includes(f.status));
```

Ao re-escanear uma pasta já convertida, a aba Arquivos fica **completamente vazia** — sem nenhuma indicação do que existe ali ou por que nada está na fila. A única pista é uma linha no Log ("X arquivos — 0 na fila | X ignorados"). Existem até badges prontos para esses status (`statusDoneSkip` "JÁ OK", `statusHevcSkip` "HEVC") que nunca aparecem.

## Evidência

E2E: rescan da pasta de teste após conversão → lista vazia, contadores zerados, INICIAR desabilitado, sem explicação na tela.

## Correção proposta

1. Adicionar filtro "Ignorados" (ou "Pulados") na toolbar com a contagem de `done_skip + hevc_skip`, exibindo as linhas com os badges já existentes.
2. No filtro "Todos", uma opção é mantê-los ocultos mas mostrar um banner sutil quando a lista visível ficar vazia e existirem ignorados: "N arquivos ignorados (já convertidos/HEVC) — ver". Liga para o filtro novo.
3. `counts` em `FileList` (~1066) ganha a chave nova.

## Arquivos

- `index.html` — `FileList` (~1061-1130), `TRANSLATIONS` (novas strings pt/en)
