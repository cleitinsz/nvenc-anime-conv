# "ESPAÇO SALVO" mostra 0.00 GB em sessões pequenas

**Prioridade:** 🟢 Baixa (cosmético) · **Confirmado ao vivo:** sim (E2E 2026-06-12 — toast "Sessão concluída · 2 arquivo(s) · 0 GB liberados")

## Problema

O ganho de espaço é sempre formatado em GB com 2 casas:

- `sendStats` / `finishSession` (`main.js` ~529, ~646): `((statsAntes - statsDepois) / 1073741824).toFixed(2)`
- StatCard "ESPAÇO SALVO" e toast de sessão exibem a string crua.

Sessões com poucos episódios (ganho < ~50 MB) mostram "0.00 GB" / "0 GB liberados", parecendo que a conversão não serviu de nada — quando na verdade economizou ex.: 3,2 MB (caso do E2E) ou 800 MB ("0.78 GB" ok, mas "0.05 GB" já é ilegível).

## Correção proposta

Criar um `fmtBytes(bytes)` em `src/utils/formatters.js` (já existe `fmtBitrate` lá — mesmo padrão):

```
< 1 GB  → "812 MB"
≥ 1 GB  → "1.34 GB"
```

Enviar do main o valor **em bytes** (número) nos eventos `stats` e `conversion-done`, e formatar no renderer (ou formatar no main e enviar string pronta — mas em bytes dá mais flexibilidade ao renderer, ex.: tooltip com valor exato). Atualizar `statSaved` card, toast `toastSession` e linha de log `sessionDone`.

Atenção: o renderer hoje espera `ganhoGB` string — alinhar os dois lados na mesma mudança.

## Arquivos

- `src/utils/formatters.js` (+ teste em `tests/formatters.test.js`)
- `main.js` — `sendStats` (~640-652), `finishSession` (~524-551)
- `index.html` — StatCard "ESPAÇO SALVO" (~1963), `toastSession`/`logSessionDone` (TRANSLATIONS)
