# HEVC re-encodado sem necessidade quando downscale está ativo

**Prioridade:** 🟡 Média (desperdício de GPU/tempo, sem corrupção) · **Confirmado ao vivo:** sim (E2E 2026-06-12)

## Problema

O scan pula arquivos já em HEVC **apenas** quando não há downscale (`main.js` ~295):

```js
const isDownscale = config.outputRes !== "original";
if (meta.codec === "hevc" && !isDownscale) { /* hevc_skip */ }
```

A lógica não compara a altura da fonte com a resolução alvo. Com `outputRes: "720p"`, um HEVC que **já é 720p** (ou menor) é re-encodado 720p→720p — re-encode lossy inútil que tipicamente termina em "SEM GANHO" (output deletado, GPU desperdiçada) ou, pior, num arquivo levemente menor e de qualidade inferior que substitui a fonte na pasta de saída.

## Evidência

E2E: HEVC 720p com `outputRes=720p` foi re-encodado e terminou "SEM GANHO" (output ≥ fonte, deletado).

## Correção proposta

Pular HEVC quando a fonte não é maior que o alvo:

```js
const TARGET_HEIGHT = { "1080p": 1080, "720p": 720, "480p": 480 };
const target = TARGET_HEIGHT[config.outputRes];          // undefined p/ "original"
const wouldDownscale = target && meta.height > target;
if (meta.codec === "hevc" && !wouldDownscale) → hevc_skip
```

Manter o comportamento atual para HEVC **maior** que o alvo (re-encodar faz sentido: 4K HEVC → 1080p).

Obs.: `SCALE_FILTER` usa `scale=-2:H` sem `min(ih,H)`, então fontes menores que o alvo são **upscaladas** no encode não-HEVC também (ex.: 480p → 720p com `outputRes=720p`). Vale corrigir junto: `scale=-2:'min(ih,H)'` ou pular o filtro quando `meta.height <= target`.

## Arquivos

- `main.js` — classificação pós-probe no `scan-folder` (~292-302)
- `src/utils/ffmpegArgs.js` — `SCALE_FILTER`/`buildVF` (caso do upscale)
- `tests/ffmpegArgs.test.js`
