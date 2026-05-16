# Encode Confidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substitui o teste atual "exit 0 + size > 100KB" do pós-encode por uma camada que valida o output via `ffprobe` (duração, stream, bitrate), descarta outputs sem ganho de tamanho, e re-tenta 1× automaticamente em erros transitórios — movendo outputs inválidos para `_quarantine/`.

**Architecture:** Toda a lógica nova vive em `src/utils/postProcess.js` (módulo puro, testável). `main.js#finishSlot` é refatorado para apenas **rotear** baseado no `verdict` retornado (`ok | no_gain | quarantine | retry | error`). UI ganha 2 badges novos, 2 stat cards condicionais e um botão "Abrir _quarantine" no fim da sessão.

**Tech Stack:** Node.js (Electron main), React 18 (UMD/CDN no renderer), Jest 30 para testes unitários. Sem bundler — código vanilla CommonJS no main, JSX inline (`<script type="text/babel">`) no renderer.

**Spec:** [docs/superpowers/specs/2026-05-16-encode-confidence-design.md](../specs/2026-05-16-encode-confidence-design.md) — commit `bbf3308`

---

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/utils/postProcess.js` | **NEW** | Função pura `postProcess({ item, exitCode, stderr, probe, fs, path })` que retorna `{ verdict, reason, retryable?, suppressDelete?, quarantinePath? }` |
| `tests/postProcess.test.js` | **NEW** | Suite Jest cobrindo todos os verdicts e edge cases |
| `main.js` | **MODIFY** | Estende `ffprobeAll` (bitrate), refatora `finishSlot` em 5 handlers, adiciona contadores `quarantineCount`/`noGainCount`/`retryCount`, novos `LOG_STRINGS`, exclui `_quarantine/` do scan, estende payloads `stats`/`conversion-done` |
| `index.html` | **MODIFY** | 2 entradas novas em `STATUS_META`, ~6 strings i18n em `TRANSLATIONS`, 2 `StatCard` condicionais, botão "Abrir _quarantine" |
| `preload.js` | **NO CHANGE** | Canais existentes (`file-status`, `stats`, `conversion-done`) carregam os payloads estendidos |

---

## Phase 1 — Pure module (`postProcess.js`) via TDD

### Task 1: Setup do módulo + verdict `'ok'` (happy path)

**Files:**
- Create: `src/utils/postProcess.js`
- Create: `tests/postProcess.test.js`

- [ ] **Step 1: Criar o test file com o primeiro teste falhando**

Escrever em `tests/postProcess.test.js`:

```js
const { postProcess } = require("../src/utils/postProcess");

const makeMockFs = (initial = {}) => {
  const files = { ...initial };
  return {
    files,
    statSync: jest.fn((p) => {
      if (!(p in files)) { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; }
      return { size: files[p].size };
    }),
    unlinkSync: jest.fn((p) => { delete files[p]; }),
    renameSync: jest.fn((from, to) => { files[to] = files[from]; delete files[from]; }),
    mkdirSync:  jest.fn(),
  };
};

const mockPath = require("path").posix; // determinístico

const okProbe = jest.fn(async () => ({
  codec: "hevc", height: 1080, duracao: 1200, bitrate: 2500000,
}));

const baseItem = {
  fullPath: "/src/anime.mkv",
  saida:    "/src/encoded/anime_hevc.mkv",
  size:     1_000_000_000,    // 1 GB original
  duracao:  1200,             // 20 min
  attempts: 0,
};

describe("postProcess", () => {
  test("verdict 'ok' quando exit 0, output menor, probe casa duração", async () => {
    const fs = makeMockFs({ "/src/encoded/anime_hevc.mkv": { size: 400_000_000 } });
    const result = await postProcess({
      item: baseItem, exitCode: 0, stderr: "",
      probe: okProbe, fs, path: mockPath,
    });
    expect(result.verdict).toBe("ok");
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx jest tests/postProcess.test.js -t "verdict 'ok'"`

Expected: FAIL com `Cannot find module '../src/utils/postProcess'`.

- [ ] **Step 3: Criar o módulo com a implementação mínima (só para esse teste passar)**

Escrever em `src/utils/postProcess.js`:

```js
/**
 * Decisão pós-encode: valida output, classifica erros, decide retry.
 * Função pura — todas as dependências externas (fs, path, probe) injetadas.
 *
 * @param {object} opts
 * @param {object} opts.item       - { fullPath, saida, size, duracao, attempts? }
 * @param {number} opts.exitCode   - exit code do processo ffmpeg
 * @param {string} opts.stderr     - stderr completo capturado
 * @param {function} opts.probe    - async (path) → { codec, height, duracao, bitrate }
 * @param {object} opts.fs         - módulo fs (injetável)
 * @param {object} opts.path       - módulo path (injetável)
 * @returns {Promise<{verdict, reason, retryable?, suppressDelete?, quarantinePath?}>}
 */
async function postProcess({ item, exitCode, stderr, probe, fs, path }) {
  if (exitCode === 0) {
    return { verdict: "ok", reason: "encode_succeeded" };
  }
  return { verdict: "error", reason: "exit_non_zero" };
}

module.exports = { postProcess };
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx jest tests/postProcess.test.js -t "verdict 'ok'"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/postProcess.js tests/postProcess.test.js
git commit -m "feat(postProcess): add module skeleton with 'ok' verdict happy path"
```

---

### Task 2: Verdict `'no_gain'` (skip-if-larger antes de validação)

**Files:**
- Modify: `src/utils/postProcess.js`
- Modify: `tests/postProcess.test.js`

- [ ] **Step 1: Adicionar 2 testes falhando**

Adicionar ao describe em `tests/postProcess.test.js`:

```js
  test("verdict 'no_gain' quando output >= source size", async () => {
    const fs = makeMockFs({ "/src/encoded/anime_hevc.mkv": { size: 1_100_000_000 } });
    const result = await postProcess({
      item: baseItem, exitCode: 0, stderr: "",
      probe: okProbe, fs, path: mockPath,
    });
    expect(result.verdict).toBe("no_gain");
    expect(result.reason).toBe("output_>=_source");
    expect(result.suppressDelete).toBe(true);
    expect(fs.unlinkSync).toHaveBeenCalledWith("/src/encoded/anime_hevc.mkv");
  });

  test("'no_gain' curto-circuita probe (não chama ffprobe)", async () => {
    const probeMock = jest.fn();
    const fs = makeMockFs({ "/src/encoded/anime_hevc.mkv": { size: 1_500_000_000 } });
    await postProcess({
      item: baseItem, exitCode: 0, stderr: "",
      probe: probeMock, fs, path: mockPath,
    });
    expect(probeMock).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx jest tests/postProcess.test.js`

Expected: 2 FAILs (verdict 'no_gain' não retornado).

- [ ] **Step 3: Implementar o branch `no_gain` em `postProcess.js`**

Substituir o corpo do `if (exitCode === 0) { ... }` em `src/utils/postProcess.js`:

```js
  if (exitCode === 0) {
    const outSize = fs.statSync(item.saida).size;
    if (outSize >= item.size) {
      fs.unlinkSync(item.saida);
      return { verdict: "no_gain", reason: "output_>=_source", suppressDelete: true };
    }
    return { verdict: "ok", reason: "encode_succeeded" };
  }
  return { verdict: "error", reason: "exit_non_zero" };
```

- [ ] **Step 4: Rodar todos os testes e confirmar PASS**

Run: `npx jest tests/postProcess.test.js`

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/postProcess.js tests/postProcess.test.js
git commit -m "feat(postProcess): add 'no_gain' verdict (skip-if-larger before probe)"
```

---

### Task 3: Verdict `'quarantine'` — validação de duração

**Files:**
- Modify: `src/utils/postProcess.js`
- Modify: `tests/postProcess.test.js`

- [ ] **Step 1: Adicionar 2 testes falhando**

Adicionar ao describe:

```js
  test("verdict 'quarantine' quando duração diverge > 2s da source", async () => {
    const fs = makeMockFs({ "/src/encoded/anime_hevc.mkv": { size: 400_000_000 } });
    const badProbe = jest.fn(async () => ({
      codec: "hevc", height: 1080, duracao: 1190, bitrate: 2500000,  // -10s vs source
    }));
    const result = await postProcess({
      item: baseItem, exitCode: 0, stderr: "",
      probe: badProbe, fs, path: mockPath,
    });
    expect(result.verdict).toBe("quarantine");
    expect(result.reason).toBe("duration_mismatch");
    expect(result.suppressDelete).toBe(true);
    expect(result.quarantinePath).toBeDefined();
  });

  test("aceita output quando item.duracao===0 e probe.duracao > 0 (fallback)", async () => {
    const fs = makeMockFs({ "/src/encoded/anime_hevc.mkv": { size: 400_000_000 } });
    const item = { ...baseItem, duracao: 0 };
    const result = await postProcess({
      item, exitCode: 0, stderr: "",
      probe: okProbe, fs, path: mockPath,
    });
    expect(result.verdict).toBe("ok");
  });
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx jest tests/postProcess.test.js`

Expected: 2 novos FAILs.

- [ ] **Step 3: Implementar validação de duração + quarantine**

Substituir o corpo do `if (exitCode === 0) { ... }` em `src/utils/postProcess.js`:

```js
  if (exitCode === 0) {
    const outSize = fs.statSync(item.saida).size;
    if (outSize >= item.size) {
      fs.unlinkSync(item.saida);
      return { verdict: "no_gain", reason: "output_>=_source", suppressDelete: true };
    }

    const probeResult = await probe(item.saida);

    // duração: se item.duracao === 0, basta probe.duracao > 0; senão, diff <= 2s
    const durOk = item.duracao === 0
      ? probeResult.duracao > 0
      : Math.abs(probeResult.duracao - item.duracao) <= 2.0;

    if (!durOk) {
      return quarantine(item, "duration_mismatch", fs, path);
    }

    return { verdict: "ok", reason: "encode_succeeded" };
  }
  return { verdict: "error", reason: "exit_non_zero" };
```

Adicionar a função helper acima do `postProcess` (mesmo arquivo):

```js
function quarantine(item, reason, fs, path) {
  const outDir       = path.dirname(item.saida);
  const quarantineDir = path.join(outDir, "_quarantine");
  fs.mkdirSync(quarantineDir, { recursive: true });
  const quarantinePath = path.join(quarantineDir, path.basename(item.saida));
  fs.renameSync(item.saida, quarantinePath);
  return { verdict: "quarantine", reason, suppressDelete: true, quarantinePath };
}
```

- [ ] **Step 4: Rodar todos os testes e confirmar PASS**

Run: `npx jest tests/postProcess.test.js`

Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/postProcess.js tests/postProcess.test.js
git commit -m "feat(postProcess): add 'quarantine' verdict for duration mismatch"
```

---

### Task 4: Validação — stream de vídeo + bitrate

**Files:**
- Modify: `src/utils/postProcess.js`
- Modify: `tests/postProcess.test.js`

- [ ] **Step 1: Adicionar 2 testes falhando**

```js
  test("'quarantine' com reason 'no_video_stream' quando probe.height = 0", async () => {
    const fs = makeMockFs({ "/src/encoded/anime_hevc.mkv": { size: 400_000_000 } });
    const probe = jest.fn(async () => ({ codec: "", height: 0, duracao: 1200, bitrate: 0 }));
    const result = await postProcess({
      item: baseItem, exitCode: 0, stderr: "",
      probe, fs, path: mockPath,
    });
    expect(result.verdict).toBe("quarantine");
    expect(result.reason).toBe("no_video_stream");
  });

  test("'quarantine' com reason 'zero_bitrate' quando probe.bitrate = 0", async () => {
    const fs = makeMockFs({ "/src/encoded/anime_hevc.mkv": { size: 400_000_000 } });
    const probe = jest.fn(async () => ({ codec: "hevc", height: 1080, duracao: 1200, bitrate: 0 }));
    const result = await postProcess({
      item: baseItem, exitCode: 0, stderr: "",
      probe, fs, path: mockPath,
    });
    expect(result.verdict).toBe("quarantine");
    expect(result.reason).toBe("zero_bitrate");
  });
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx jest tests/postProcess.test.js`

Expected: 2 FAILs (validações ainda não implementadas).

- [ ] **Step 3: Implementar checks**

Em `src/utils/postProcess.js`, dentro do `if (exitCode === 0)`, **antes** do check de duração, adicionar:

```js
    const probeResult = await probe(item.saida);

    if (!(probeResult.height > 0)) {
      return quarantine(item, "no_video_stream", fs, path);
    }
    if (!(probeResult.bitrate > 0)) {
      return quarantine(item, "zero_bitrate", fs, path);
    }

    const durOk = item.duracao === 0
      ? probeResult.duracao > 0
      : Math.abs(probeResult.duracao - item.duracao) <= 2.0;
    if (!durOk) {
      return quarantine(item, "duration_mismatch", fs, path);
    }

    return { verdict: "ok", reason: "encode_succeeded" };
```

Remover a chamada duplicada de `probe` que estava na versão anterior — agora só uma.

- [ ] **Step 4: Rodar todos os testes e confirmar PASS**

Run: `npx jest tests/postProcess.test.js`

Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/postProcess.js tests/postProcess.test.js
git commit -m "feat(postProcess): add video-stream and bitrate checks to quarantine"
```

---

### Task 5: Operações de FS na quarentena (mkdir + rename)

**Files:**
- Modify: `tests/postProcess.test.js`

- [ ] **Step 1: Adicionar 2 testes**

```js
  test("quarentena cria diretório '_quarantine' com recursive: true", async () => {
    const fs = makeMockFs({ "/src/encoded/anime_hevc.mkv": { size: 400_000_000 } });
    const probe = jest.fn(async () => ({ codec: "hevc", height: 0, duracao: 1200, bitrate: 0 }));
    await postProcess({
      item: baseItem, exitCode: 0, stderr: "",
      probe, fs, path: mockPath,
    });
    expect(fs.mkdirSync).toHaveBeenCalledWith("/src/encoded/_quarantine", { recursive: true });
  });

  test("quarentena move o arquivo via renameSync", async () => {
    const fs = makeMockFs({ "/src/encoded/anime_hevc.mkv": { size: 400_000_000 } });
    const probe = jest.fn(async () => ({ codec: "hevc", height: 0, duracao: 1200, bitrate: 0 }));
    await postProcess({
      item: baseItem, exitCode: 0, stderr: "",
      probe, fs, path: mockPath,
    });
    expect(fs.renameSync).toHaveBeenCalledWith(
      "/src/encoded/anime_hevc.mkv",
      "/src/encoded/_quarantine/anime_hevc.mkv"
    );
  });
```

- [ ] **Step 2: Rodar — devem passar de primeira (impl já existe)**

Run: `npx jest tests/postProcess.test.js`

Expected: 9 PASS (sem código novo, só cobertura adicional).

- [ ] **Step 3: Commit**

```bash
git add tests/postProcess.test.js
git commit -m "test(postProcess): assert quarantine fs operations (mkdir + rename)"
```

---

### Task 6: Verdicts `'retry'` e `'error'` — classificação de stderr

**Files:**
- Modify: `src/utils/postProcess.js`
- Modify: `tests/postProcess.test.js`

- [ ] **Step 1: Adicionar 3 testes falhando**

```js
  test("verdict 'retry' quando stderr é transient e attempts=0", async () => {
    const fs = makeMockFs();
    const result = await postProcess({
      item: baseItem,
      exitCode: 1,
      stderr: "[hevc_nvenc] OpenEncodeSessionEx failed: out of memory (10)",
      probe: okProbe, fs, path: mockPath,
    });
    expect(result.verdict).toBe("retry");
    expect(result.retryable).toBe(true);
    expect(result.reason).toMatch(/^transient:/);
  });

  test("verdict 'error' quando stderr é transient mas attempts>=1", async () => {
    const fs = makeMockFs();
    const item = { ...baseItem, attempts: 1 };
    const result = await postProcess({
      item, exitCode: 1, stderr: "Cannot allocate memory",
      probe: okProbe, fs, path: mockPath,
    });
    expect(result.verdict).toBe("error");
    expect(result.reason).toMatch(/^transient_after_retry:/);
  });

  test("verdict 'error' com reason 'unknown:<última linha não-vazia>' em stderr aleatório", async () => {
    const fs = makeMockFs();
    const result = await postProcess({
      item: baseItem,
      exitCode: 1,
      stderr: "ffmpeg version 6.0\n\nSome random thing happened\n",
      probe: okProbe, fs, path: mockPath,
    });
    expect(result.verdict).toBe("error");
    expect(result.reason).toBe("unknown:Some random thing happened");
  });
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `npx jest tests/postProcess.test.js`

Expected: 3 FAILs (sempre retorna `exit_non_zero`).

- [ ] **Step 3: Implementar classificação no `postProcess.js`**

Adicionar no topo de `src/utils/postProcess.js` (acima da função `quarantine`):

```js
const TRANSIENT_PATTERNS = [
  /cannot allocate memory/i,
  /out of memory/i,
  /CUDA.*out of memory/i,
  /OpenEncodeSessionEx failed/i,          // driver hang típico NVENC
  /No NVENC capable devices found/i,      // race com GPU inicializando
  /Device or resource busy/i,
  /Operation not permitted.*nvenc/i,
];

function classifyError(stderr, attempts) {
  const match = TRANSIENT_PATTERNS.find(re => re.test(stderr));
  if (match) {
    if ((attempts || 0) < 1) {
      return { verdict: "retry", reason: `transient:${match.source}`, retryable: true };
    }
    return { verdict: "error", reason: `transient_after_retry:${match.source}` };
  }
  const lastLine = stderr.split("\n").map(l => l.trim()).filter(Boolean).pop() || "no_message";
  return { verdict: "error", reason: `unknown:${lastLine}` };
}
```

Substituir o trailing `return { verdict: "error", reason: "exit_non_zero" };` por:

```js
  return classifyError(stderr, item.attempts);
```

- [ ] **Step 4: Rodar todos os testes**

Run: `npx jest tests/postProcess.test.js`

Expected: 12 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/postProcess.js tests/postProcess.test.js
git commit -m "feat(postProcess): add error classification + 1x retry for transients"
```

---

### Task 7: Cobertura table-driven dos `TRANSIENT_PATTERNS`

**Files:**
- Modify: `tests/postProcess.test.js`

- [ ] **Step 1: Adicionar describe.each cobrindo cada padrão**

Adicionar ao final do describe (mas dentro dele):

```js
  describe("TRANSIENT_PATTERNS", () => {
    const cases = [
      ["cannot allocate memory",        "Cannot allocate memory"],
      ["out of memory",                 "Encoder out of memory"],
      ["CUDA out of memory",            "CUDA error: out of memory in nvenc"],
      ["OpenEncodeSessionEx failed",    "[hevc_nvenc] OpenEncodeSessionEx failed: ..."],
      ["No NVENC capable devices",     "No NVENC capable devices found"],
      ["Device or resource busy",       "Device or resource busy"],
      ["Operation not permitted nvenc", "Operation not permitted: nvenc init"],
    ];

    test.each(cases)("classifica '%s' como transient (com retry)", async (_label, stderr) => {
      const fs = makeMockFs();
      const result = await postProcess({
        item: { ...baseItem, attempts: 0 },
        exitCode: 1, stderr,
        probe: okProbe, fs, path: mockPath,
      });
      expect(result.verdict).toBe("retry");
    });
  });
```

- [ ] **Step 2: Rodar e confirmar PASS (impl já cobre)**

Run: `npx jest tests/postProcess.test.js`

Expected: 12 PASS + 7 cases novos = 19 PASS total.

- [ ] **Step 3: Commit**

```bash
git add tests/postProcess.test.js
git commit -m "test(postProcess): cover every TRANSIENT_PATTERN with table-driven test"
```

---

## Phase 2 — Integração com `main.js`

### Task 8: Estender `ffprobeAll` com bitrate

**Files:**
- Modify: `main.js:123-148`

- [ ] **Step 1: Atualizar `ffprobeAll` para incluir `format=bit_rate`**

Localizar a função `ffprobeAll` em `main.js` (perto da linha 123). Substituir:

```js
function ffprobeAll(filePath) {
  return new Promise((resolve) => {
    const proc = cp.spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,height:format=duration,bit_rate",
      "-of", "json",
      filePath,
    ], { stdio: ["ignore", "pipe", "pipe"] });

    let out = "";
    proc.stdout.on("data", d => out += d);
    proc.on("close", () => {
      try {
        const j = JSON.parse(out);
        resolve({
          codec:   j.streams?.[0]?.codec_name || "",
          height:  parseInt(j.streams?.[0]?.height) || 720,
          duracao: parseFloat(j.format?.duration) || 0,
          bitrate: parseInt(j.format?.bit_rate)   || 0,
        });
      } catch {
        resolve({ codec: "", height: 720, duracao: 0, bitrate: 0 });
      }
    });
  });
}
```

Diferenças: `-show_entries` agora inclui `bit_rate`, e o objeto resolvido tem `bitrate`. Catch também retorna `bitrate: 0`.

- [ ] **Step 2: Smoke check — rodar o app e fazer scan numa pasta**

Run: `npm start`

Selecionar uma pasta com vídeos. Verificar que o scan completa sem erro (output ainda funciona — só ganhamos um campo a mais que ninguém lê ainda).

- [ ] **Step 3: Commit**

```bash
git add main.js
git commit -m "feat(main): include bitrate in ffprobeAll output"
```

---

### Task 9: Adicionar contadores e log strings novos em `main.js`

**Files:**
- Modify: `main.js:31-56` (LOG_STRINGS)
- Modify: `main.js:300-310` (estado do job pool)

- [ ] **Step 1: Adicionar 3 entries em `LOG_STRINGS.ptBR` e `LOG_STRINGS.en`**

Localizar o objeto `LOG_STRINGS` (linha ~31). Adicionar dentro de `ptBR`:

```js
    slotQuarantine: (id, name, reason) => `[Slot ${id}] QUARENTENA: ${name} | razão: ${reason}`,
    slotNoGain:     (id, name, mbOrig) => `[Slot ${id}] SEM GANHO: ${name} (${mbOrig}MB → sem redução)`,
    slotRetry:      (id, name, reason) => `[Slot ${id}] Erro transitório (${reason}). Re-enfileirando...`,
```

E o equivalente em inglês dentro de `en`:

```js
    slotQuarantine: (id, name, reason) => `[Slot ${id}] QUARANTINE: ${name} | reason: ${reason}`,
    slotNoGain:     (id, name, mbOrig) => `[Slot ${id}] NO GAIN: ${name} (${mbOrig}MB → no reduction)`,
    slotRetry:      (id, name, reason) => `[Slot ${id}] Transient error (${reason}). Re-queueing...`,
```

- [ ] **Step 2: Adicionar contadores no bloco de estado do job pool**

Localizar o bloco que declara `let slots = {};` (linha ~300). Adicionar **logo abaixo** de `let ignoredCount = 0;`:

```js
let quarantineCount = 0;
let noGainCount     = 0;
let retryCount      = 0;
let quarantineFirstPath = null;
```

- [ ] **Step 3: Importar `postProcess`**

No topo de `main.js`, junto dos outros requires de `src/utils/`:

```js
const { postProcess } = require("./src/utils/postProcess");
```

- [ ] **Step 4: Verificar que o app ainda inicia sem erros**

Run: `npm start`

Expected: app abre normalmente; nada usa os novos campos ainda.

- [ ] **Step 5: Commit**

```bash
git add main.js
git commit -m "chore(main): add postProcess import, counters and log strings (no behavior change yet)"
```

---

### Task 10: Refatorar `finishSlot` para usar `postProcess` + 5 handlers

**Files:**
- Modify: `main.js:348-406` (toda a função `finishSlot`)

- [ ] **Step 1: Substituir `finishSlot` pelo novo router + handlers**

Localizar a função `finishSlot` em `main.js` (linha ~348). Substituir **toda a função** por:

```js
async function finishSlot(slotId, code) {
  const slot = slots[slotId];
  if (!slot) return;

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

  const durConv = ((Date.now() - slot.inicio) / 60000).toFixed(1);

  switch (result.verdict) {
    case "ok":         handleOk(slotId, slot, durConv); break;
    case "no_gain":    handleNoGain(slotId, slot); break;
    case "quarantine": handleQuarantine(slotId, slot, result); break;
    case "retry":      handleRetry(slotId, slot, result); break;
    case "error":      handleError(slotId, slot, result); break;
  }

  delete slots[slotId];
  sendStats();
  fillSlots();

  if (queue.length === 0 && Object.keys(slots).length === 0) finishSession();
}

function handleOk(slotId, slot, durConv) {
  const { item } = slot;
  const sizeAfter = fs.statSync(item.saida).size;
  const reducao   = Math.round((item.size - sizeAfter) * 100 / item.size);
  const mb1 = (item.size  / 1048576).toFixed(1);
  const mb2 = (sizeAfter / 1048576).toFixed(1);
  statsAntes  += item.size;
  statsDepois += sizeAfter;
  doneCount++;
  log("OK", L.slotDone(slotId, item.name, mb1, mb2, reducao, durConv));
  mainWindow?.webContents.send("file-status", {
    fullPath: item.fullPath, status: "done",
    mb1: parseFloat(mb1), mb2: parseFloat(mb2), reducao,
  });
  if (config.deletarOriginal) {
    try { fs.unlinkSync(item.fullPath); } catch {}
    log("INFO", L.slotDeleted(slotId, item.name));
  }
}

function handleNoGain(slotId, slot) {
  const { item } = slot;
  noGainCount++;
  const mbOrig = (item.size / 1048576).toFixed(1);
  log("AVISO", L.slotNoGain(slotId, item.name, mbOrig));
  mainWindow?.webContents.send("file-status", { fullPath: item.fullPath, status: "no_gain" });
}

function handleQuarantine(slotId, slot, result) {
  const { item } = slot;
  quarantineCount++;
  if (!quarantineFirstPath) quarantineFirstPath = result.quarantinePath;
  log("ERRO", L.slotQuarantine(slotId, item.name, result.reason));
  mainWindow?.webContents.send("file-status", {
    fullPath: item.fullPath, status: "quarantine",
    quarantinePath: result.quarantinePath, reason: result.reason,
  });
}

function handleRetry(slotId, slot, result) {
  const { item } = slot;
  retryCount++;
  item.attempts = (item.attempts || 0) + 1;
  log("AVISO", L.slotRetry(slotId, item.name, result.reason));
  mainWindow?.webContents.send("file-status", {
    fullPath: item.fullPath, status: "queue", progress: 0,
  });
  queue.unshift(item);
}

function handleError(slotId, slot, result) {
  const { item } = slot;
  const stderr = slot.getStderr();
  const stderrLines = stderr.split("\n").map(l => l.trim()).filter(Boolean);
  const errorLines  = stderrLines
    .filter(l => /error|invalid|failed|cannot|unsupported|unknown/i.test(l))
    .slice(-5);
  const lastError = errorLines.pop() || stderrLines.slice(-2).join(" | ") || "sem mensagem";

  errorCount++;
  log("ERRO", L.slotFailed(slotId, item.name, "n/a"));
  log("ERRO", L.slotCause(`${result.reason} | ${lastError}`));
  for (const l of errorLines) log("DEBUG", `  > ${l}`);
  mainWindow?.webContents.send("file-status", { fullPath: item.fullPath, status: "error" });
}
```

- [ ] **Step 2: Verificar que não há referências quebradas**

Run: `node -c main.js` (syntax check sem rodar)

Expected: nenhum erro.

- [ ] **Step 3: Rodar a suite de testes existentes (sanity check)**

Run: `npm test`

Expected: todos passam (postProcess + os 3 módulos existentes). Nenhum teste de `main.js` ainda.

- [ ] **Step 4: Commit**

```bash
git add main.js
git commit -m "refactor(main): route finishSlot via postProcess verdict + 5 handlers"
```

---

### Task 11: Reset de contadores em `start-conversion` e `retry-errors`

**Files:**
- Modify: `main.js:531-559` (handlers IPC)

- [ ] **Step 1: Atualizar reset em `start-conversion`**

Localizar `ipcMain.on("start-conversion", ...)` (linha ~531). Substituir a linha `statsAntes = statsDepois = 0;` por:

```js
  statsAntes = statsDepois = 0;
  quarantineCount = noGainCount = retryCount = 0;
  quarantineFirstPath = null;
```

- [ ] **Step 2: Atualizar reset em `retry-errors`**

Localizar `ipcMain.on("retry-errors", ...)` (linha ~544). Dentro do bloco `if (!running) { ... }`, substituir a linha `doneCount = errorCount = statsAntes = statsDepois = 0;` por:

```js
    doneCount = errorCount = statsAntes = statsDepois = 0;
    quarantineCount = noGainCount = retryCount = 0;
    quarantineFirstPath = null;
```

- [ ] **Step 3: Smoke check no app**

Run: `npm start`

Selecionar uma pasta, iniciar conversão, parar, iniciar de novo. Verificar que stats aparecem zeradas no início.

- [ ] **Step 4: Commit**

```bash
git add main.js
git commit -m "feat(main): reset new counters on start-conversion and retry-errors"
```

---

### Task 12: Estender payload `stats` (sendStats)

**Files:**
- Modify: `main.js:517-525` (função `sendStats`)

- [ ] **Step 1: Adicionar campos novos no payload**

Localizar `function sendStats(...)`. Substituir o corpo por:

```js
function sendStats(globalEta = "") {
  mainWindow?.webContents.send("stats", {
    done:    doneCount,
    errors:  errorCount,
    active:  Object.keys(slots).length,
    queue:   queue.length,
    ganhoGB: ((statsAntes - statsDepois) / 1073741824).toFixed(2),
    globalEta,
    quarantine: quarantineCount,
    noGain:     noGainCount,
    retries:    retryCount,
  });
}
```

- [ ] **Step 2: Smoke check no app**

Run: `npm start`

Iniciar conversão (sem precisar terminar). Abrir DevTools no Electron (Ctrl+Shift+I), verificar via console que `stats` está chegando com os 3 campos novos:

```js
window.api.on("stats", console.log);  // colar no console
```

(Os valores devem ser 0 até algo causar quarantine/no_gain/retry.)

- [ ] **Step 3: Commit**

```bash
git add main.js
git commit -m "feat(main): extend stats payload with quarantine/noGain/retries counters"
```

---

### Task 13: Estender payload `conversion-done` com `quarantineFirstPath`

**Files:**
- Modify: `main.js:408-428` (função `finishSession`)

- [ ] **Step 1: Atualizar payload**

Localizar `function finishSession()` (linha ~408). Substituir o `mainWindow?.webContents.send("conversion-done", { ... })` por:

```js
  mainWindow?.webContents.send("conversion-done", {
    convertidos: doneCount,
    erros:       errorCount,
    ignorados:   ignoredCount,
    ganhoGB:     parseFloat(ganhoGB),
    quarantinados:       quarantineCount,
    semGanho:            noGainCount,
    retries:             retryCount,
    quarantineFirstPath: quarantineFirstPath,
  });
```

- [ ] **Step 2: Smoke check**

Run: `npm start`

Rodar uma conversão até o fim (qualquer arquivo). Verificar no console (DevTools) que o evento `conversion-done` chega com os 4 campos novos.

- [ ] **Step 3: Commit**

```bash
git add main.js
git commit -m "feat(main): extend conversion-done with quarantinados/semGanho/retries/path"
```

---

### Task 14: Excluir `_quarantine/` do scan walk

**Files:**
- Modify: `main.js:212-228` (função `walk` em `scan-folder`)

- [ ] **Step 1: Pular diretório `_quarantine` no walk**

Localizar a função `walk(dir)` dentro do handler `ipcMain.handle("scan-folder", ...)`. Substituir o início do for-loop por:

```js
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "_quarantine") continue;  // pular pasta de quarentena
        walk(full); continue;
      }
      if (!e.isFile()) continue;
```

- [ ] **Step 2: Smoke check**

Criar manualmente uma pasta `_quarantine/teste.mkv` (qualquer arquivo .mkv). Rodar `npm start`, fazer scan da pasta pai, verificar que `teste.mkv` NÃO aparece na lista.

- [ ] **Step 3: Commit**

```bash
git add main.js
git commit -m "feat(scan): skip _quarantine/ directories during folder walk"
```

---

## Phase 3 — UI (`index.html`)

### Task 15: Adicionar STATUS_META para `quarantine` e `no_gain`

**Files:**
- Modify: `index.html:610-617` (STATUS_META object)
- Modify: `index.html:120-150` (TRANSLATIONS ptBR — status labels)
- Modify: `index.html:260-300` (TRANSLATIONS en — status labels)

- [ ] **Step 1: Adicionar strings i18n para os status novos**

Localizar `TRANSLATIONS.ptBR` em `index.html`. Localizar o bloco com `statusQueue`, `statusEncode`, etc. (perto da linha 114-130). Adicionar:

```js
    statusQuarantine: "QUARENT.",
    statusNoGain:     "SEM GANHO",
```

Idem em `TRANSLATIONS.en`:

```js
    statusQuarantine: "QUARANTINE",
    statusNoGain:     "NO GAIN",
```

- [ ] **Step 2: Adicionar entries em STATUS_META**

Localizar `STATUS_META` (linha ~610). Adicionar **antes** do `};` final:

```js
    quarantine:{color:"#ff8800",        label:t("statusQuarantine"), icon:"⚠"},
    no_gain:   {color:"var(--muted)",   label:t("statusNoGain"),     icon:"="},
  };
```

(A cor laranja `#ff8800` é distinta das existentes; ajustar se preferir.)

- [ ] **Step 3: Verificar visualmente no app**

Run: `npm start`

Não há como acionar quarantine sem refactor mais profundo; para ver a badge, no DevTools console:

```js
// simular um arquivo em quarantine pra ver o badge
document.querySelectorAll('.file-row')[0]?.querySelector('span')?.outerHTML
```

Ou aguardar a verificação end-to-end na Task 18.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(ui): add status badges for quarantine and no_gain"
```

---

### Task 16: Adicionar StatCards condicionais + handler de `conversion-done`

**Files:**
- Modify: `index.html:1572-1579` (bloco de Stats)
- Modify: `index.html:1390` (initial state de stats)
- Modify: `index.html:1469` (reset state em handleSelectFolder)
- Modify: `index.html:1449-1454` (handler conversion-done)
- Modify: `index.html:120-150` (TRANSLATIONS — labels novos)
- Modify: `index.html:260-300` (TRANSLATIONS en — labels novos)

- [ ] **Step 1: Adicionar strings i18n para os labels novos**

Em `TRANSLATIONS.ptBR`:

```js
    statQuarantine:    "Quarentena",
    statQuarantineSub: "saídas inválidas",
    statNoGain:        "Sem ganho",
    statNoGainSub:     "output ≥ original",
    statRetries:       "Retries auto.",
    statRetriesSub:    "transitórios",
    btnOpenQuarantine: "📁 ABRIR _QUARANTINE",
```

Em `TRANSLATIONS.en`:

```js
    statQuarantine:    "Quarantine",
    statQuarantineSub: "invalid outputs",
    statNoGain:        "No gain",
    statNoGainSub:     "output ≥ source",
    statRetries:       "Auto-retries",
    statRetriesSub:    "transient errors",
    btnOpenQuarantine: "📁 OPEN _QUARANTINE",
```

- [ ] **Step 2: Atualizar initial state e reset de stats**

Localizar `useState({done:0,errors:0,...})` (linha ~1390). Substituir por:

```js
  const [stats, setStats] = useState({
    done:0, errors:0, active:0, queue:0,
    ganhoGB:"0.00", globalEta:"",
    quarantine:0, noGain:0, retries:0,
  });
```

Localizar o reset dentro de `handleSelectFolder` (linha ~1469). Substituir por:

```js
    setStats({done:0,errors:0,active:0,queue:0,ganhoGB:"0.00",globalEta:"",
              quarantine:0,noGain:0,retries:0});
```

- [ ] **Step 3: Adicionar StatCards condicionais**

Localizar o bloco `{/* Stats */}` (linha ~1572). Adicionar 3 StatCards **antes** do `</div>` final do bloco, condicionalmente:

```jsx
                {stats.quarantine > 0 && (
                  <StatCard label={t("statQuarantine")} value={stats.quarantine}
                            sub={t("statQuarantineSub")} color="#ff8800"/>
                )}
                {stats.noGain > 0 && (
                  <StatCard label={t("statNoGain")} value={stats.noGain}
                            sub={t("statNoGainSub")} color="var(--muted)"/>
                )}
                {stats.retries > 0 && (
                  <StatCard label={t("statRetries")} value={stats.retries}
                            sub={t("statRetriesSub")} color="var(--yellow)"/>
                )}
```

- [ ] **Step 4: Capturar `quarantineFirstPath` do `conversion-done`**

Adicionar state perto do `useState` de `stats` (~linha 1390):

```js
  const [quarantineFirstPath, setQuarantineFirstPath] = useState(null);
```

Localizar `window.api.on("conversion-done", ...)` (linha ~1449). Substituir por:

```js
    window.api.on("conversion-done",(d)=>{
      setRunning(false);
      setQuarantineFirstPath(d.quarantineFirstPath || null);
      addLog({t:new Date().toLocaleTimeString(t("locale"),{hour12:false}),lvl:"OK",
        msg: t("logSessionDone")(d.convertidos, d.erros, d.ganhoGB)});
      addToast(t("toastSession")(d.convertidos, d.ganhoGB), "🏁", "var(--accent)");
    });
```

- [ ] **Step 5: Adicionar botão "Abrir _quarantine" no bloco de Stats**

Após o último StatCard (dentro do mesmo `<div>`), adicionar:

```jsx
                {quarantineFirstPath && !running && (
                  <button className="btn" onClick={() => window.api.openLogFolder ? null : null}
                          style={{padding:"8px 12px",fontSize:10,fontWeight:700,
                                  background:"#ff880022",color:"#ff8800",
                                  border:"1px solid #ff880055",borderRadius:6,letterSpacing:1}}>
                    {t("btnOpenQuarantine")}
                  </button>
                )}
```

**Importante**: o botão ainda não funciona — `window.api.openLogFolder` abre `userData`, não a pasta de quarantine. Precisamos de um IPC novo. Próximo step trata disso.

- [ ] **Step 6: Adicionar IPC `open-quarantine-folder` e expor no preload**

Em `preload.js`, adicionar o método dentro do `contextBridge.exposeInMainWorld`:

```js
  openQuarantineFolder: (path) => ipcRenderer.send("open-quarantine-folder", path),
```

Em `main.js`, adicionar handler perto dos outros IPCs (após o `open-log-folder`):

```js
ipcMain.on("open-quarantine-folder", (_, p) => { if (p) shell.openPath(p); });
```

Voltar ao botão em `index.html` e trocar o `onClick` por:

```jsx
                          onClick={() => window.api.openQuarantineFolder(quarantineFirstPath)}
```

- [ ] **Step 7: Smoke check visual**

Run: `npm start`

Não há como acionar quarantine sem fonte corrompida; visualmente, verificar que:
- StatCards condicionais NÃO aparecem (count=0)
- Botão de quarantine NÃO aparece

Próxima task tem a verificação end-to-end.

- [ ] **Step 8: Commit**

```bash
git add index.html preload.js main.js
git commit -m "feat(ui): add quarantine/noGain/retries StatCards + Open Quarantine button"
```

---

## Phase 4 — Verificação end-to-end

### Task 17: Smoke test manual end-to-end

**Files:**
- (testes manuais — sem código)

**Pré-requisitos:** uma pasta com pelo menos 3 arquivos .mkv: um normal, um que será **truncado** para forçar quarantine, e um arquivo de fonte muito pequena/comprimida para potencialmente forçar `no_gain`.

- [ ] **Step 1: Preparar arquivos de teste**

Em PowerShell (na pasta de teste, vamos chamar de `<TESTE>`):

```powershell
# Caso 1: arquivo normal (algum .mkv qualquer)
# Caso 2: simular quarantine — criar um arquivo MKV com header mas truncado.
#   O caminho mais fácil é encodar normalmente, depois truncar:
#   Para esse teste, é preferível simular via MOCK: temporariamente forçar quarantine
#   no postProcess injetando uma falha.
```

Como simular quarantine sem hardware NVENC falhando é difícil, use a abordagem **mock temporário**: em `src/utils/postProcess.js`, no topo da função, adicionar temporariamente:

```js
  // TEMPORÁRIO PARA TESTE — REMOVER ANTES DE COMMITAR
  if (item.name && item.name.includes("FORCE_QUARANTINE")) {
    return { verdict: "quarantine", reason: "manual_test",
             suppressDelete: true, quarantinePath: item.saida.replace(".mkv", "_quar.mkv") };
  }
```

Renomear um arquivo de teste para incluir `FORCE_QUARANTINE` no nome.

- [ ] **Step 2: Rodar conversão**

Run: `npm start`

Selecionar `<TESTE>`. Iniciar conversão. Observar:
- Arquivo normal: badge `PRONTO` (verde) ao terminar
- Arquivo `*FORCE_QUARANTINE*`: badge laranja `QUARENT.` durante e após
- Log mostra `[Slot N] QUARENTENA: ... | razão: manual_test`

- [ ] **Step 3: Verificar StatCards após sessão**

Após `conversion-done`:
- StatCard "Quarentena" aparece com valor 1 (cor laranja)
- Botão `📁 ABRIR _QUARANTINE` aparece
- Clicar abre o explorer no caminho enviado

- [ ] **Step 4: Verificar a fila com retry-1x**

Em outro mock temporário em `postProcess.js`:

```js
  // TEMPORÁRIO — forçar retry transient na 1ª tentativa
  if (item.name && item.name.includes("FORCE_RETRY") && (item.attempts || 0) === 0) {
    return { verdict: "retry", reason: "transient:test", retryable: true };
  }
```

Renomear um arquivo para incluir `FORCE_RETRY`. Rodar. Observar:
- Arquivo entra no Slot, log mostra `Erro transitório (transient:test). Re-enfileirando...`
- Reaparece como `FILA` (badge amarelo)
- Re-roda; agora attempts=1 cai no encode normal e termina como `PRONTO`
- StatCard "Retries auto." aparece com valor 1

- [ ] **Step 5: Remover os mocks temporários**

Remover os 2 blocos `// TEMPORÁRIO` de `src/utils/postProcess.js`.

Re-rodar `npm test` para confirmar que nada quebrou.

Run: `npm test`

Expected: 19 PASS no postProcess + os existentes.

- [ ] **Step 6: Renomear os arquivos de teste de volta (limpar `FORCE_*` dos nomes)**

Manual via Explorer ou PowerShell:

```powershell
Rename-Item "FORCE_QUARANTINE_arquivo.mkv" "arquivo.mkv"
Rename-Item "FORCE_RETRY_arquivo.mkv" "arquivo.mkv"
```

- [ ] **Step 7: Commit (se houver mudança em arquivos rastreados)**

```bash
git status
# se houver algo (não deveria — mocks foram removidos), revisar e commitar
```

Se tudo certo, registrar conclusão:

```bash
git log --oneline -15
```

Expected: ver a sequência dos commits das tasks 1-16.

---

## Notes for the implementing engineer

- **Don't skip TDD:** mesmo nos tasks que parecem simples, escrever o teste primeiro evita regressões silenciosas. O módulo `postProcess.js` precisa ser 100% confiável porque protege a flag `deletarOriginal`.
- **Sufixo `_hevc` vs presets futuros:** os outputs de hoje usam sufixo `_hevc`. A pasta `_quarantine/` herda o nome do output (`<base>_hevc.mkv`). Não confundir com a feature de presets (spec separado).
- **Por que mockar `path` nos testes?** O módulo nativo `path` usa o separador do sistema operacional. Em testes, usar `path.posix` garante separadores `/` em qualquer OS, evitando flaky tests entre Win/Linux.
- **Branch isolation:** trabalhe em branch separado, opcionalmente via worktree (`superpowers:using-git-worktrees`).
- **Não tocar em `preload.js#allowed`:** os payloads estendidos usam canais existentes (`stats`, `conversion-done`, `file-status`). Só foi adicionado `openQuarantineFolder` que é um envio (não está sob `allowed`).
- **Spec é a fonte da verdade:** se durante implementação algo do plano contradisser o spec (`docs/superpowers/specs/2026-05-16-encode-confidence-design.md`), o spec ganha. Update o plano se descobrir um erro.
