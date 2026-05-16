# Encode Confidence — Design Spec

**Date:** 2026-05-16
**Status:** Approved

## Summary

Adicionar uma camada de pós-processamento entre o término do `ffmpeg` e a marcação final do arquivo. Substitui o teste atual ("exit 0 + size > 100 KB" em `main.js:358-364`) por uma decisão informada que combina três políticas:

1. **Validação pós-encode via `ffprobe`** — duração (±2 s), existência de stream de vídeo, bitrate > 0.
2. **Skip-if-larger** — se o output ficar ≥ tamanho do original, descarta o output e marca status neutro `no_gain`.
3. **Classificação de erro + retry 1× automático** — detecta padrões transitórios no stderr (OOM, driver hang NVENC) e re-enfileira uma vez antes de marcar erro permanente.

Outputs que falham na validação são movidos para `<dir-do-output>/_quarantine/` e a flag `deletarOriginal` é suprimida para aquele arquivo, mesmo quando ligada.

---

## 1. Approach

Toda a lógica nova vive num módulo puro novo: `src/utils/postProcess.js`.

Match com o padrão já estabelecido no projeto (`ffmpegArgs.js`, `formatters.js`, `progressParser.js`): funções recebem dependências por parâmetro (incluindo `fs`, `path`, e a função `probe`) para serem 100% testáveis com Jest sem boot do Electron.

`finishSlot` em `main.js` deixa de tomar a decisão e passa a apenas **rotear** baseado no `verdict` retornado por `postProcess`.

---

## 2. Módulo `src/utils/postProcess.js`

### 2.1 Assinatura

```js
async function postProcess({
  item,       // { fullPath, saida, size, duracao, attempts? }
  exitCode,   // exit code do processo ffmpeg
  stderr,     // string completa do stderr capturado
  probe,      // async (path) → { duracao, codec, height, bitrate }
  fs,         // módulo fs (injetável)
  path,       // módulo path (injetável)
}) { … }
```

### 2.2 Tipo de retorno

```js
{
  verdict: 'ok' | 'no_gain' | 'quarantine' | 'retry' | 'error',
  reason: string,                   // diagnóstico legível
  retryable?: boolean,              // só relevante quando verdict === 'retry'
  suppressDelete?: boolean,         // true em quarantine/no_gain
  quarantinePath?: string,          // só presente em verdict === 'quarantine'
}
```

### 2.3 Ordem de execução

```
if (exitCode !== 0) {
  → classificação de erro (§5)
} else {
  → skip-if-larger (§4)      // primeiro: barato (stat)
  → validação ffprobe (§3)   // depois: 1 chamada extra de ffprobe
  → 'ok'
}
```

A ordem importa: `skip-if-larger` é avaliado **antes** da validação porque é mais barato (só `fs.statSync`) e descartar um output "sem ganho" não precisa custar uma chamada de `ffprobe`.

---

## 3. Validação pós-encode (`verdict: 'quarantine'`)

Chama `probe(item.saida)` e aplica três checks em ordem. Falha em qualquer um → quarentena.

| Check | Critério | `reason` em falha |
|---|---|---|
| stream-video | `probe.height > 0` | `no_video_stream` |
| bitrate | `probe.bitrate > 0` | `zero_bitrate` |
| duração | `\|probe.duracao − item.duracao\| ≤ 2.0` s (ou, se `item.duracao === 0`, basta `probe.duracao > 0`) | `duration_mismatch` |

Em falha:

1. `fs.mkdirSync('<dir-do-output>/_quarantine/', { recursive: true })`
2. `fs.renameSync(item.saida, <quarantinePath>)`
3. Retorna `{ verdict: 'quarantine', reason, suppressDelete: true, quarantinePath }`.

### 3.1 Estender `ffprobeAll` (`main.js:123`)

Hoje pede `stream=codec_name,height:format=duration`. Incluir também `format=bit_rate`. Ainda 1 chamada de ffprobe — sem custo extra de processo.

Mudança equivalente no objeto resolvido:

```js
resolve({
  codec:   j.streams?.[0]?.codec_name || "",
  height:  parseInt(j.streams?.[0]?.height) || 720,
  duracao: parseFloat(j.format?.duration) || 0,
  bitrate: parseInt(j.format?.bit_rate) || 0,  // novo
});
```

---

## 4. Skip-if-larger (`verdict: 'no_gain'`)

Limiar fixo: **100 %** do tamanho do original.

```js
const outSize = fs.statSync(item.saida).size;
if (outSize >= item.size) {
  fs.unlinkSync(item.saida);
  return { verdict: 'no_gain', reason: 'output_>=_source', suppressDelete: true };
}
```

`suppressDelete: true` é tecnicamente redundante (não há mais output, então `deletarOriginal` não faz sentido), mas explicitamos para manter o contrato consistente.

---

## 5. Classificação de erro + retry 1× (`verdict: 'retry' | 'error'`)

Lista de padrões transitórios mantida no topo do módulo:

```js
const TRANSIENT_PATTERNS = [
  /cannot allocate memory/i,
  /out of memory/i,
  /CUDA.*out of memory/i,
  /OpenEncodeSessionEx failed/i,         // driver hang típico NVENC
  /No NVENC capable devices found/i,     // race quando GPU ainda inicializando
  /Device or resource busy/i,
  /Operation not permitted.*nvenc/i,
];
```

Lógica:

| Match | `item.attempts` | Verdict | Reason |
|---|---|---|---|
| Transient | `< 1` | `retry` (`retryable: true`) | `transient:<pattern_source>` |
| Transient | `≥ 1` | `error` | `transient_after_retry:<pattern_source>` |
| Sem match | qualquer | `error` | `unknown:<última linha não-vazia do stderr>` |

Sem backoff (decisão de design — bundle escolhido foi "retry 1× automático", não "2× com backoff").

---

## 6. Integração com `finishSlot` (`main.js:348`)

Refactor de `finishSlot` para apenas **rotear** baseado em `verdict`:

```js
async function finishSlot(slotId, code) {
  const slot = slots[slotId]; if (!slot) return;
  const { item } = slot;
  try { fs.unlinkSync(slot.progressFile); } catch {}
  mainWindow?.webContents.send("slot-clear", { slotId });

  const result = await postProcess({
    item,
    exitCode: code,
    stderr:   slot.getStderr(),
    probe:    ffprobeAll,
    fs,
    path,
  });

  switch (result.verdict) {
    case 'ok':         handleOk(slot, result); break;
    case 'no_gain':    handleNoGain(slot, result); break;
    case 'quarantine': handleQuarantine(slot, result); break;
    case 'retry':      handleRetry(slot, result); break;
    case 'error':      handleError(slot, result); break;
  }

  delete slots[slotId];
  sendStats();
  fillSlots();
  if (queue.length === 0 && Object.keys(slots).length === 0) finishSession();
}
```

### 6.1 Handlers

- **`handleOk`** — fluxo atual: stats, deletar original se `config.deletarOriginal`, log `slotDone`.
- **`handleNoGain`** — `noGainCount++`. **Não** mexe em `doneCount`/`errorCount`/`statsAntes`/`statsDepois`. Log `slotNoGain(id, name, mb)`. IPC `file-status: 'no_gain'`.
- **`handleQuarantine`** — `quarantineCount++`. Log `slotQuarantine(id, name, reason)`. IPC `file-status: 'quarantine'` com `quarantinePath`.
- **`handleRetry`** — `item.attempts = (item.attempts || 0) + 1; queue.unshift(item)`. Log `slotRetry(id, name, reason)`. IPC `file-status: 'queue'` (volta para fila visivelmente).
- **`handleError`** — fluxo atual: extrai e loga stderr, marca erro, libera retry manual.

### 6.2 Contadores novos no estado do `main.js`

```js
let quarantineCount = 0;
let noGainCount     = 0;
let retryCount      = 0;   // total de retries automáticos da sessão (telemetria)
```

Resetados em `start-conversion` e `retry-errors` junto com os existentes.

### 6.3 Encerramento de sessão

`finishSession` continua disparando quando `queue.length === 0 && slots vazios`. `retry` re-enfileirou no topo da queue, então naturalmente espera ele terminar antes de fechar.

Payload do evento `conversion-done` ganha:

```js
{ convertidos, erros, ignorados, ganhoGB,
  quarantinados,        // novo
  semGanho,             // novo
  retries,              // novo
  quarantineFirstPath } // novo — caminho da primeira quarentena da sessão (ou null)
```

---

## 7. IPC / UI

### 7.1 Novos valores de `file-status`

- `quarantine` — badge laranja "QUARENT.", tooltip "Output movido para _quarantine — verifique manualmente"
- `no_gain` — badge cinza "SEM GANHO" / "NO GAIN", tooltip "Output não ficou menor que o original"

### 7.2 Payload `stats` ganha campos

```js
{ done, errors, active, queue, ganhoGB, globalEta,
  quarantine,   // novo
  noGain,       // novo
  retries }     // novo
```

### 7.3 Log strings novas em `main.js` (`LOG_STRINGS`)

Adicionar nas duas locales (PT-BR + EN):

```js
slotQuarantine: (id, name, reason)  => `[Slot ${id}] QUARENTENA: ${name} | razão: ${reason}`,
slotNoGain:     (id, name, mbOrig)  => `[Slot ${id}] SEM GANHO: ${name} (${mbOrig}MB → sem redução)`,
slotRetry:      (id, name, reason)  => `[Slot ${id}] Erro transitório (${reason}). Re-enfileirando...`,
```

### 7.4 Strings i18n no renderer (`TRANSLATIONS` em `index.html`)

- `statusQuarantine`, `statusNoGain` — labels dos badges
- `quarantineTooltip`, `noGainTooltip`
- Card de finalização: contadores "Quarentena" / "Sem ganho" / "Retries automáticos"

### 7.5 Botão "Abrir _quarantine"

No painel de finalização (`conversion-done`), quando `quarantinados > 0`: aparece botão "📁 Abrir _quarantine" que invoca `shell.openPath(<primeiro quarantinePath visto>)`. Caminho da primeira quarentena da sessão é mandado no evento `conversion-done` como `quarantineFirstPath`.

### 7.6 Excluir `_quarantine/` do scan

Em `scan-folder` (`main.js:212-228`), no `walk(dir)`, pular diretórios cujo `e.name === '_quarantine'` (match exato, case-sensitive) para evitar que outputs em quarentena apareçam como candidatos a re-scan.

---

## 8. Config

**Sem mudanças no schema de `config.json`.** Decisões foram tomadas no design ("default seguro"):

- Validação: sempre ligada
- Skip-if-larger: limiar fixo 100 %
- Retry: 1× automático para transitórios

Se um dia virar configurável, adicionamos. YAGNI agora.

---

## 9. Testes

Arquivo novo: `tests/postProcess.test.js`.

Padrão do projeto: injeção de `fs`, `path`, `probe` por parâmetro. `fs` mockado com `makeMockFs(initial)` (padrão similar ao usado em `progressParser.test.js`).

### 9.1 Matriz de testes

| # | Cenário | Setup | Expect |
|---|---|---|---|
| 1 | Output válido | exit 0, size < source, probe casa duração | `verdict: 'ok'` |
| 2 | Duração diverge > 2 s | exit 0, probe.duracao = source − 5 | `quarantine`, reason `duration_mismatch` |
| 3 | Sem stream de vídeo | exit 0, probe.height = 0 | `quarantine`, reason `no_video_stream` |
| 4 | Bitrate zero | exit 0, probe.bitrate = 0 | `quarantine`, reason `zero_bitrate` |
| 5 | Output ≥ source | exit 0, outSize = source.size | `no_gain` |
| 6 | Skip-if-larger curto-circuita probe | exit 0, outSize > source | `no_gain`; mock de `probe` NÃO foi invocado |
| 7 | Transient + attempts=0 | exit 1, stderr inclui "out of memory" | `retry`, `retryable: true` |
| 8 | Transient + attempts=1 | exit 1, stderr inclui "out of memory", item.attempts=1 | `error`, reason `transient_after_retry:*` |
| 9 | Erro desconhecido | exit 1, stderr aleatório | `error`, reason `unknown:<última linha não-vazia>` |
| 10 | Quarantine path criado | falha validação | `fs.mkdirSync` chamado com sufixo `_quarantine` |
| 11 | Quarantine move arquivo | falha validação | `fs.renameSync(saida, quarantinePath)` chamado |
| 12 | Falha de duração com `item.duracao === 0` | probe.duracao > 0 | `verdict: 'ok'` (fallback aceita) |
| 13 | Cada padrão transient | um teste por entry de `TRANSIENT_PATTERNS` | classifica como transient |

Smoke de integração no `main.js` fica **fora deste spec** (entra num próximo bundle "Cobertura de main.js").

---

## 10. Migração / Compatibilidade

- **Config existente** — sem schema novo; nada quebra.
- **Outputs já convertidos** — não são re-validados retroativamente.
- **Pasta `_quarantine/`** — criada on-demand. Excluída do scan via §7.6.

---

## 11. Out of Scope

Itens explicitamente **fora** deste spec (próximos bundles):

- Pause/resume real (hoje "stop" mata processos)
- Drag & drop de pastas/arquivos
- Cobertura de testes de `main.js` (job pool, IPC handlers, lifecycle)
- VMAF-targeted CQ
- 2-pass encode
- AV1 NVENC
- Histórico de sessões persistente
- Fila persistida em disco (resume após crash)
