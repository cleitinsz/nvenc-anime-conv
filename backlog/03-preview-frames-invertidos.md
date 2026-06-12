# Preview de comparação: frames invertidos + fidelidade do encode

**Prioridade:** 🟠 Alta · **Confirmado ao vivo:** parcial (preview gera frames OK; inversão e fidelidade verificadas por código)

## Problema 1 — frames trocados (bug)

Em `index.html` (~494), o retorno do invoke é atribuído invertido:

```js
const result = await window.api.generatePreview(fullPath, timestampPct, config);
setFrames({ orig: result.frameConv, conv: result.frameOrig });  // ← invertido!
```

O handler `preview-generate` em `main.js` retorna `{ frameOrig, frameConv }`. O slider mostra o convertido rotulado como original e vice-versa — o usuário avalia a qualidade olhando o frame errado.

**Fix:** `setFrames({ orig: result.frameOrig, conv: result.frameConv })`.

## Problema 2 — código morto (limpeza)

`useComparison` registra listeners para `preview-done` e `preview-error` (`index.html` ~476-478), mas o main **nunca emite** esses canais — o resultado vem só pelo retorno do invoke. O handler `onDone` (que faz a atribuição correta, ironicamente) nunca roda. Remover os listeners mortos e os canais do allowlist do `preload.js`, ou passar a usá-los de fato.

## Problema 3 — preview não representa o encode real (melhoria)

O excerpt do preview (`main.js` ~757-771) diverge do encode de verdade:

| | Encode real (`buildArgsGPU`) | Preview |
|---|---|---|
| Rate control | `-rc vbr -cq N -b:v 0` | `-rc constqp -qp N` |
| CQ por resolução | `cqHD` se ≥1000px, senão `cqSD` | sempre `cqHD` |
| Downscale (`outputRes`) | aplica `SCALE_FILTER` | ignora |
| GPU selecionada | `-gpu N` | ignora |
| Perfil 10-bit | `-profile:v main10 -pix_fmt p010le` | ignora |

**Fix sugerido:** reutilizar `buildVF`/lógica de `ffmpegArgs.js` no preview (importar e montar os mesmos args, só trocando `-t 10` e saída), em vez de duplicar a montagem à mão.

## Arquivos

- `index.html` — `useComparison.generate` (~494), listeners mortos (~476-483)
- `main.js` — handler `preview-generate` (~708-816)
- `preload.js` — allowlist de canais (~21)
