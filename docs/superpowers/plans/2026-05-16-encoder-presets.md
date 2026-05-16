# Encoder Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar tab "🎛 PRESETS" (3ª tab no painel direito) com 10 built-in presets read-only (anime/live-action variantes 1080p/720p/480p + CPU archive + preview rápido + storage saver + mobile) e suporte a custom presets do usuário (CRUD). Cada preset sobrescreve 9 campos de encoder (`profile`, `encoder`, `outputRes`, `cqHD`, `cqSD`, `preset`, `cpuPreset`, `jobs`, `sufixo`).

**Architecture:** Toda lógica de preset vive em `src/utils/presets.js` (módulo puro, testável). Renderer NÃO importa `presets.js` (bloqueado por `contextIsolation`) — recebe lista canônica e `activePresetId` via payload estendido de `config-loaded` (campos `_builtinPresets` e `_activePresetId`). `main.js` ganha helper `emitConfigLoaded()` que recomputa `_activePresetId` a cada mudança de config. Detach silencioso quando user muda config manualmente acontece via re-emit no `set-config`.

**Tech Stack:** Node.js (Electron main), React 18 (UMD/CDN), Jest 30. Sem bundler.

**Spec:** [docs/superpowers/specs/2026-05-16-encoder-presets-design.md](../specs/2026-05-16-encoder-presets-design.md) — commit `855db20`

---

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `src/utils/presets.js` | **NEW** | `BUILTIN_PRESETS` (10 entries) + funções puras `applyPreset`/`isPresetActive`/`findActivePreset`/`generateCustomId`/`getLocaleField` + `PRESET_FIELDS` |
| `tests/presets.test.js` | **NEW** | Suite Jest com 19 testes cobrindo todas as funções e validade dos built-in |
| `src/utils/ffmpegArgs.js` | **MODIFY** | Adicionar `"480p"` ao `SCALE_FILTER` |
| `main.js` | **MODIFY** | Import `presets.js`, `customPresets:[]` em defaults, helper `emitConfigLoaded()`, 3 IPC handlers (`apply-preset`/`save-preset-from-config`/`delete-preset`), `set-config` chama `emitConfigLoaded()` |
| `preload.js` | **MODIFY** | Expor `applyPreset`, `savePresetFromConfig`, `deletePreset` |
| `index.html` | **MODIFY** | ~26 strings novas em `TRANSLATIONS`, separação de state `_builtinPresets`/`_activePresetId` em `config-loaded`, tab `presets` com cards (built-in + custom), modais save/edit, botão delete com confirm, indicador no painel de settings, opção `→ 480p` na seção Resolução |

---

## Phase 1 — Pure module (`presets.js`) via TDD

### Task 1: Setup do módulo + validade dos `BUILTIN_PRESETS`

**Files:**
- Create: `src/utils/presets.js`
- Create: `tests/presets.test.js`

- [ ] **Step 1: Criar `presets.js` com a lista (sem funções ainda)**

Escrever em `src/utils/presets.js`:

```js
const PRESET_FIELDS = [
  "profile", "encoder", "outputRes", "cqHD", "cqSD",
  "preset", "cpuPreset", "jobs", "sufixo",
];

const BUILTIN_PRESETS = [
  { id: "builtin:anime-1080p", builtin: true, icon: "🎌",
    name:        { ptBR: "Anime 1080p", en: "Anime 1080p" },
    description: { ptBR: "Padrão para a maioria dos animes (NVENC)",
                   en: "Default for most anime (NVENC)" },
    fields: { profile: "anime", encoder: "nvenc", outputRes: "original",
              cqHD: 28, cqSD: 26, preset: "p6", cpuPreset: "medium",
              jobs: 2, sufixo: "_hevc" } },

  { id: "builtin:anime-720p", builtin: true, icon: "🎌",
    name:        { ptBR: "Anime 720p", en: "Anime 720p" },
    description: { ptBR: "Mais economia de espaço",
                   en: "More storage savings" },
    fields: { profile: "anime", encoder: "nvenc", outputRes: "720p",
              cqHD: 26, cqSD: 24, preset: "p6", cpuPreset: "medium",
              jobs: 2, sufixo: "_720p" } },

  { id: "builtin:anime-4k-to-1080p", builtin: true, icon: "🎌",
    name:        { ptBR: "Anime 4K → 1080p", en: "Anime 4K → 1080p" },
    description: { ptBR: "Downscale de fontes 4K",
                   en: "Downscale 4K sources" },
    fields: { profile: "anime", encoder: "nvenc", outputRes: "1080p",
              cqHD: 28, cqSD: 26, preset: "p6", cpuPreset: "medium",
              jobs: 2, sufixo: "_1080p" } },

  { id: "builtin:anime-archive", builtin: true, icon: "💾",
    name:        { ptBR: "Anime arquivo (CPU)", en: "Anime archive (CPU)" },
    description: { ptBR: "Máxima qualidade, lento",
                   en: "Max quality, slow" },
    fields: { profile: "anime", encoder: "cpu", outputRes: "original",
              cqHD: 20, cqSD: 18, preset: "p6", cpuPreset: "slower",
              jobs: 1, sufixo: "_archive" } },

  { id: "builtin:live-1080p", builtin: true, icon: "🎬",
    name:        { ptBR: "Live-action 1080p", en: "Live-action 1080p" },
    description: { ptBR: "Filmes e séries",
                   en: "Movies and series" },
    fields: { profile: "liveaction", encoder: "nvenc", outputRes: "original",
              cqHD: 26, cqSD: 24, preset: "p6", cpuPreset: "medium",
              jobs: 2, sufixo: "_hevc" } },

  { id: "builtin:live-720p", builtin: true, icon: "🎬",
    name:        { ptBR: "Live-action 720p", en: "Live-action 720p" },
    description: { ptBR: "Filmes menores",
                   en: "Smaller movies" },
    fields: { profile: "liveaction", encoder: "nvenc", outputRes: "720p",
              cqHD: 24, cqSD: 22, preset: "p6", cpuPreset: "medium",
              jobs: 2, sufixo: "_720p" } },

  { id: "builtin:live-archive", builtin: true, icon: "💾",
    name:        { ptBR: "Live-action arquivo (CPU)", en: "Live-action archive (CPU)" },
    description: { ptBR: "Preservar grain cinematográfico",
                   en: "Preserve cinematic grain" },
    fields: { profile: "liveaction", encoder: "cpu", outputRes: "original",
              cqHD: 19, cqSD: 18, preset: "p6", cpuPreset: "slower",
              jobs: 1, sufixo: "_archive" } },

  { id: "builtin:preview-quick", builtin: true, icon: "⚡",
    name:        { ptBR: "Pré-visualização rápida", en: "Quick preview" },
    description: { ptBR: "Teste rápido antes de batch grande",
                   en: "Fast test before large batch" },
    fields: { profile: "anime", encoder: "nvenc", outputRes: "720p",
              cqHD: 32, cqSD: 30, preset: "p4", cpuPreset: "medium",
              jobs: 3, sufixo: "_preview" } },

  { id: "builtin:storage-saver", builtin: true, icon: "💾",
    name:        { ptBR: "Storage saver", en: "Storage saver" },
    description: { ptBR: "Máxima compressão (lento)",
                   en: "Max compression (slow)" },
    fields: { profile: "anime", encoder: "cpu", outputRes: "original",
              cqHD: 28, cqSD: 26, preset: "p6", cpuPreset: "slower",
              jobs: 1, sufixo: "_min" } },

  { id: "builtin:mobile-480p", builtin: true, icon: "📱",
    name:        { ptBR: "Mobile 480p", en: "Mobile 480p" },
    description: { ptBR: "Para assistir no celular",
                   en: "For watching on phone" },
    fields: { profile: "anime", encoder: "nvenc", outputRes: "480p",
              cqHD: 26, cqSD: 24, preset: "p6", cpuPreset: "medium",
              jobs: 2, sufixo: "_mobile" } },
];

module.exports = { PRESET_FIELDS, BUILTIN_PRESETS };
```

- [ ] **Step 2: Criar `tests/presets.test.js` com 4 testes de validade**

```js
const { BUILTIN_PRESETS, PRESET_FIELDS } = require("../src/utils/presets");

describe("BUILTIN_PRESETS", () => {
  test("tem exatamente 10 entradas", () => {
    expect(BUILTIN_PRESETS).toHaveLength(10);
  });

  test("todos têm IDs únicos", () => {
    const ids = BUILTIN_PRESETS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("todos têm os 9 campos de PRESET_FIELDS preenchidos", () => {
    for (const p of BUILTIN_PRESETS) {
      for (const f of PRESET_FIELDS) {
        expect(p.fields[f]).toBeDefined();
      }
    }
  });

  test("todos usam valores válidos para profile/encoder/outputRes/preset/cpuPreset", () => {
    const validProfile   = ["anime", "liveaction"];
    const validEncoder   = ["nvenc", "cpu"];
    const validOutputRes = ["original", "1080p", "720p", "480p"];
    const validPreset    = ["p4", "p5", "p6", "p7"];
    const validCpuPreset = ["faster", "fast", "medium", "slow", "slower"];
    for (const p of BUILTIN_PRESETS) {
      expect(validProfile).toContain(p.fields.profile);
      expect(validEncoder).toContain(p.fields.encoder);
      expect(validOutputRes).toContain(p.fields.outputRes);
      expect(validPreset).toContain(p.fields.preset);
      expect(validCpuPreset).toContain(p.fields.cpuPreset);
      expect(typeof p.fields.cqHD).toBe("number");
      expect(typeof p.fields.cqSD).toBe("number");
      expect(typeof p.fields.jobs).toBe("number");
      expect(typeof p.fields.sufixo).toBe("string");
    }
  });
});
```

- [ ] **Step 3: Rodar e confirmar PASS**

Run: `npx jest tests/presets.test.js`

Expected: 4 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/utils/presets.js tests/presets.test.js
git commit -m "feat(presets): add BUILTIN_PRESETS with 10 entries + validity tests"
```

---

### Task 2: `applyPreset` (merge non-mutating)

**Files:**
- Modify: `src/utils/presets.js`
- Modify: `tests/presets.test.js`

- [ ] **Step 1: Adicionar 3 testes falhando**

Adicionar ao `tests/presets.test.js`:

```js
const { applyPreset } = require("../src/utils/presets");

describe("applyPreset", () => {
  const preset = BUILTIN_PRESETS[0];  // anime-1080p
  const baseConfig = {
    profile: "liveaction", encoder: "cpu", outputRes: "720p",
    cqHD: 22, cqSD: 20, preset: "p4", cpuPreset: "slow",
    jobs: 1, sufixo: "_old",
    outputFolder: "/tmp/foo", lang: "en", lastFolder: "/tmp/bar",
    deletarOriginal: true, gpu: 1,
  };

  test("aplica os 9 campos do preset no config", () => {
    const result = applyPreset(preset, baseConfig);
    for (const f of PRESET_FIELDS) {
      expect(result[f]).toBe(preset.fields[f]);
    }
  });

  test("preserva campos NÃO cobertos pelo preset", () => {
    const result = applyPreset(preset, baseConfig);
    expect(result.outputFolder).toBe("/tmp/foo");
    expect(result.lang).toBe("en");
    expect(result.lastFolder).toBe("/tmp/bar");
    expect(result.deletarOriginal).toBe(true);
    expect(result.gpu).toBe(1);
  });

  test("não muta o config de entrada", () => {
    const snapshot = JSON.parse(JSON.stringify(baseConfig));
    applyPreset(preset, baseConfig);
    expect(baseConfig).toEqual(snapshot);
  });
});
```

- [ ] **Step 2: Rodar e confirmar FAIL**

Run: `npx jest tests/presets.test.js`

Expected: 3 FAILs (`applyPreset is not a function`).

- [ ] **Step 3: Implementar `applyPreset` em `presets.js`**

Adicionar antes do `module.exports`:

```js
function applyPreset(preset, currentConfig) {
  return { ...currentConfig, ...preset.fields };
}
```

E adicionar ao export:

```js
module.exports = { PRESET_FIELDS, BUILTIN_PRESETS, applyPreset };
```

- [ ] **Step 4: Rodar e confirmar PASS**

Run: `npx jest tests/presets.test.js`

Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/presets.js tests/presets.test.js
git commit -m "feat(presets): add applyPreset (non-mutating merge)"
```

---

### Task 3: `isPresetActive` (shallow-equal nos 9 campos)

**Files:**
- Modify: `src/utils/presets.js`
- Modify: `tests/presets.test.js`

- [ ] **Step 1: Adicionar 2 testes falhando**

```js
const { isPresetActive } = require("../src/utils/presets");

describe("isPresetActive", () => {
  const preset = BUILTIN_PRESETS[0];  // anime-1080p

  test("retorna true quando todos os 9 campos batem", () => {
    const config = { ...preset.fields, lang: "ptBR", outputFolder: "/tmp" };
    expect(isPresetActive(preset, config)).toBe(true);
  });

  test("retorna false quando 1 campo diverge", () => {
    const config = { ...preset.fields, cqHD: 30 };  // diverge
    expect(isPresetActive(preset, config)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar FAIL**

Run: `npx jest tests/presets.test.js`

Expected: 2 FAILs.

- [ ] **Step 3: Implementar**

Adicionar em `presets.js`:

```js
function isPresetActive(preset, currentConfig) {
  return PRESET_FIELDS.every(f => preset.fields[f] === currentConfig[f]);
}
```

Adicionar ao export.

- [ ] **Step 4: Rodar e confirmar PASS**

Run: `npx jest tests/presets.test.js`

Expected: 9 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/presets.js tests/presets.test.js
git commit -m "feat(presets): add isPresetActive (shallow-equal on 9 fields)"
```

---

### Task 4: `findActivePreset` (built-in prioridade sobre custom)

**Files:**
- Modify: `src/utils/presets.js`
- Modify: `tests/presets.test.js`

- [ ] **Step 1: Adicionar 3 testes falhando**

```js
const { findActivePreset } = require("../src/utils/presets");

describe("findActivePreset", () => {
  test("acha o built-in correto quando config bate", () => {
    const preset = BUILTIN_PRESETS[0];
    const config = { ...preset.fields, lang: "ptBR" };
    expect(findActivePreset(config, BUILTIN_PRESETS)).toBe(preset);
  });

  test("retorna null quando nenhum bate", () => {
    const config = { profile: "anime", encoder: "nvenc", outputRes: "original",
                     cqHD: 99, cqSD: 99, preset: "p6", cpuPreset: "medium",
                     jobs: 2, sufixo: "_xx" };
    expect(findActivePreset(config, BUILTIN_PRESETS)).toBeNull();
  });

  test("prefere built-in sobre custom quando ambos batem", () => {
    const preset = BUILTIN_PRESETS[0];
    const custom = { id: "custom:dup", builtin: false, name: "Dup",
                     icon: "⭐", description: "", fields: { ...preset.fields } };
    const config = { ...preset.fields };
    const all = [...BUILTIN_PRESETS, custom];
    expect(findActivePreset(config, all)).toBe(preset);  // built-in wins
  });
});
```

- [ ] **Step 2: Rodar e confirmar FAIL**

Run: `npx jest tests/presets.test.js`

Expected: 3 FAILs.

- [ ] **Step 3: Implementar**

```js
function findActivePreset(currentConfig, allPresets) {
  // Sort: built-in first (prioridade)
  const sorted = [...allPresets].sort((a, b) => (b.builtin ? 1 : 0) - (a.builtin ? 1 : 0));
  for (const p of sorted) {
    if (isPresetActive(p, currentConfig)) return p;
  }
  return null;
}
```

Adicionar ao export.

- [ ] **Step 4: Rodar e confirmar PASS**

Run: `npx jest tests/presets.test.js`

Expected: 12 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/presets.js tests/presets.test.js
git commit -m "feat(presets): add findActivePreset (built-in priority)"
```

---

### Task 5: `generateCustomId` (UUID-v4 simples)

**Files:**
- Modify: `src/utils/presets.js`
- Modify: `tests/presets.test.js`

- [ ] **Step 1: Adicionar 2 testes falhando**

```js
const { generateCustomId } = require("../src/utils/presets");

describe("generateCustomId", () => {
  test("gera IDs únicos em 100 chamadas", () => {
    const ids = Array.from({ length: 100 }, () => generateCustomId());
    expect(new Set(ids).size).toBe(100);
  });

  test("sempre prefixa 'custom:'", () => {
    expect(generateCustomId()).toMatch(/^custom:/);
  });
});
```

- [ ] **Step 2: Rodar e confirmar FAIL**

Run: `npx jest tests/presets.test.js`

Expected: 2 FAILs.

- [ ] **Step 3: Implementar (UUID-v4 simples, sem dep)**

```js
function generateCustomId() {
  // UUID-v4 simples via Math.random (sem cripto-fortes — não precisamos aqui)
  const hex = (n) => Math.floor(Math.random() * 16).toString(16);
  const block = (len) => Array.from({ length: len }, hex).join("");
  return `custom:${block(8)}-${block(4)}-4${block(3)}-${block(4)}-${block(12)}`;
}
```

Adicionar ao export.

- [ ] **Step 4: Rodar e confirmar PASS**

Run: `npx jest tests/presets.test.js`

Expected: 14 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/presets.js tests/presets.test.js
git commit -m "feat(presets): add generateCustomId (uuid-v4 style)"
```

---

### Task 6: `getLocaleField` com fallbacks

**Files:**
- Modify: `src/utils/presets.js`
- Modify: `tests/presets.test.js`

- [ ] **Step 1: Adicionar 5 testes falhando**

```js
const { getLocaleField } = require("../src/utils/presets");

describe("getLocaleField", () => {
  test("retorna string como veio quando preset[field] é string", () => {
    const p = { name: "Meu preset", builtin: false };
    expect(getLocaleField(p, "name", "ptBR")).toBe("Meu preset");
  });

  test("resolve objeto localizado pela lang", () => {
    const p = { name: { ptBR: "Olá", en: "Hi" }, builtin: true };
    expect(getLocaleField(p, "name", "en")).toBe("Hi");
  });

  test("fallback: lang ausente → tenta ptBR", () => {
    const p = { name: { ptBR: "Olá", en: "Hi" }, builtin: true };
    expect(getLocaleField(p, "name", "jp")).toBe("Olá");
  });

  test("fallback: ptBR ausente → tenta en", () => {
    const p = { name: { en: "Hi" }, builtin: true };
    expect(getLocaleField(p, "name", "jp")).toBe("Hi");
  });

  test("fallback final: nenhuma chave conhecida → primeira chave do objeto", () => {
    const p = { name: { ja: "やあ" }, builtin: true };
    expect(getLocaleField(p, "name", "jp")).toBe("やあ");
  });
});
```

- [ ] **Step 2: Rodar e confirmar FAIL**

Run: `npx jest tests/presets.test.js`

Expected: 5 FAILs.

- [ ] **Step 3: Implementar**

```js
function getLocaleField(preset, field, lang) {
  const v = preset[field];
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    if (v[lang]) return v[lang];
    if (v.ptBR)  return v.ptBR;
    if (v.en)    return v.en;
    const firstKey = Object.keys(v)[0];
    if (firstKey) return v[firstKey];
  }
  return "";
}
```

Adicionar ao export.

- [ ] **Step 4: Rodar a suite inteira e confirmar 19 PASS**

Run: `npx jest tests/presets.test.js`

Expected: 19 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/presets.js tests/presets.test.js
git commit -m "feat(presets): add getLocaleField with ptBR→en→firstKey fallback"
```

---

## Phase 2 — Backend integration (`ffmpegArgs`, `main.js`, `preload.js`)

### Task 7: Adicionar `480p` ao `SCALE_FILTER`

**Files:**
- Modify: `src/utils/ffmpegArgs.js:20-23`

- [ ] **Step 1: Estender `SCALE_FILTER`**

Em `src/utils/ffmpegArgs.js`, substituir:

```js
const SCALE_FILTER = {
  "1080p": "scale=-2:1080:flags=lanczos",
  "720p":  "scale=-2:720:flags=lanczos",
  "480p":  "scale=-2:480:flags=lanczos",
};
```

- [ ] **Step 2: Rodar testes do ffmpegArgs**

Run: `npx jest tests/ffmpegArgs.test.js`

Expected: todos passam (a adição não quebra nenhum teste existente).

- [ ] **Step 3: Commit**

```bash
git add src/utils/ffmpegArgs.js
git commit -m "feat(ffmpegArgs): add 480p to SCALE_FILTER"
```

---

### Task 8: `config.json` default + load de `customPresets`

**Files:**
- Modify: `main.js:60-78` (função `loadConfig`)

- [ ] **Step 1: Adicionar `customPresets: []` aos defaults**

Localizar `loadConfig` em `main.js`. Substituir o objeto `defaults`:

```js
  const defaults = {
    gpu: 0, preset: "p6", jobs: 2,
    sufixo: "_hevc", cqHD: 28, cqSD: 26,
    deletarOriginal: false, lastFolder: null,
    outputMode: "encoded",
    outputFolder: null,
    profile: "anime",
    encoder: "nvenc",
    cpuPreset: "medium",
    outputRes: "original",
    lang: "ptBR",
    customPresets: [],
  };
```

- [ ] **Step 2: Verificar load com config antiga**

Apagar manualmente o arquivo de config (se quiser testar fresh):

```powershell
Remove-Item "$env:APPDATA\nvenc-anime-gui\config.json" -ErrorAction SilentlyContinue
```

Run: `npm start`

Expected: app abre normalmente; novo config.json criado com `customPresets: []`.

Verificar:
```powershell
Get-Content "$env:APPDATA\nvenc-anime-gui\config.json" | Select-String customPresets
```

- [ ] **Step 3: Commit**

```bash
git add main.js
git commit -m "feat(main): add customPresets:[] to config defaults"
```

---

### Task 9: Helper `emitConfigLoaded` + integração em `did-finish-load` e `set-config`

**Files:**
- Modify: `main.js:21-23` (imports), `main.js:96-112` (whenReady), `main.js:288-292` (set-config handler)

- [ ] **Step 1: Importar `presets.js`**

No topo de `main.js` junto dos outros requires de `./src/utils/`:

```js
const { BUILTIN_PRESETS, PRESET_FIELDS, findActivePreset, applyPreset, generateCustomId } = require("./src/utils/presets");
```

- [ ] **Step 2: Adicionar helper `emitConfigLoaded`**

Adicionar logo após a declaração de `let config = loadConfig();` (linha ~87):

```js
function emitConfigLoaded() {
  const all    = [...BUILTIN_PRESETS, ...(config.customPresets || [])];
  const active = findActivePreset(config, all);
  mainWindow?.webContents.send("config-loaded", {
    ...config,
    _builtinPresets: BUILTIN_PRESETS,
    _activePresetId: active?.id || null,
  });
}
```

- [ ] **Step 3: Substituir o send em `did-finish-load`**

Localizar (~linha 109):

```js
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.send("config-loaded", config);
  });
```

Substituir por:

```js
  mainWindow.webContents.on("did-finish-load", () => {
    emitConfigLoaded();
  });
```

- [ ] **Step 4: `set-config` também chama `emitConfigLoaded()` para recompute do detach**

Localizar `ipcMain.on("set-config", ...)` (linha ~288). Adicionar `emitConfigLoaded();` no final do handler:

```js
ipcMain.on("set-config", (_, newCfg) => {
  config = { ...config, ...newCfg };
  L = LOG_STRINGS[config.lang] || LOG_STRINGS.ptBR;
  saveConfig(config);
  emitConfigLoaded();
});
```

- [ ] **Step 5: Smoke check**

Run: `npm start`

Abrir DevTools (Ctrl+Shift+I), no console:

```js
window.api.on("config-loaded", (d) => console.log("config-loaded", d._activePresetId, d._builtinPresets?.length));
// Em seguida, mudar qualquer config no painel — deve printar a cada mudança
```

Expected: print mostra `_builtinPresets.length === 10` e `_activePresetId` (null se config não bate com nenhum built-in, ou ID se bate).

- [ ] **Step 6: Commit**

```bash
git add main.js
git commit -m "feat(main): add emitConfigLoaded helper with _builtinPresets/_activePresetId"
```

---

### Task 10: IPC handler `apply-preset` (com bloqueio durante conversão)

**Files:**
- Modify: `main.js` (adicionar handler novo perto dos outros IPC)

- [ ] **Step 1: Adicionar o handler**

Adicionar em `main.js`, perto dos outros `ipcMain.on/handle` (após o `set-config`):

```js
ipcMain.handle("apply-preset", (_, presetId) => {
  const all = [...BUILTIN_PRESETS, ...(config.customPresets || [])];
  const preset = all.find(p => p.id === presetId);
  if (!preset) return { ok: false, reason: "not_found" };
  if (running) return { ok: false, reason: "converting" };
  config = applyPreset(preset, config);
  L = LOG_STRINGS[config.lang] || LOG_STRINGS.ptBR;
  saveConfig(config);
  emitConfigLoaded();
  return { ok: true };
});
```

- [ ] **Step 2: Smoke check via DevTools**

Run: `npm start`. No console:

```js
const r = await window.api.applyPreset?.("builtin:anime-720p");  // ainda não exposto no preload — placeholder pra próximo task
// vai dar erro "applyPreset is not a function" — esperado, próximo task expõe
```

Verificar via shell direto que o handler responde (chamando via IPC):

```js
window.api && console.log("api keys:", Object.keys(window.api));
```

- [ ] **Step 3: Commit**

```bash
git add main.js
git commit -m "feat(main): add apply-preset IPC handler (blocks during conversion)"
```

---

### Task 11: IPC handler `save-preset-from-config` (com validação de nome)

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Adicionar o handler**

```js
ipcMain.handle("save-preset-from-config", (_, { name, icon, description }) => {
  const trimmedName = (name || "").trim();
  if (!trimmedName) return { ok: false, reason: "name_required" };
  const fields = Object.fromEntries(PRESET_FIELDS.map(k => [k, config[k]]));
  const newPreset = {
    id: generateCustomId(),
    name: trimmedName,
    icon: icon || "⭐",
    description: description || "",
    builtin: false,
    fields,
  };
  config.customPresets = [...(config.customPresets || []), newPreset];
  saveConfig(config);
  emitConfigLoaded();
  return { ok: true, preset: newPreset };
});
```

- [ ] **Step 2: Commit**

```bash
git add main.js
git commit -m "feat(main): add save-preset-from-config IPC handler with name validation"
```

---

### Task 12: IPC handler `delete-preset` (bloqueia built-in)

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Adicionar o handler**

```js
ipcMain.handle("delete-preset", (_, presetId) => {
  if (presetId.startsWith("builtin:")) return { ok: false, reason: "is_builtin" };
  config.customPresets = (config.customPresets || []).filter(p => p.id !== presetId);
  saveConfig(config);
  emitConfigLoaded();
  return { ok: true };
});
```

- [ ] **Step 2: Commit**

```bash
git add main.js
git commit -m "feat(main): add delete-preset IPC handler (blocks built-in)"
```

---

### Task 13: Expor 3 métodos no `preload.js`

**Files:**
- Modify: `preload.js`

- [ ] **Step 1: Adicionar os 3 métodos no `contextBridge.exposeInMainWorld`**

Em `preload.js`, dentro do objeto exposto:

```js
  applyPreset:          (presetId)                 => ipcRenderer.invoke("apply-preset", presetId),
  savePresetFromConfig: (name, icon, description)  => ipcRenderer.invoke("save-preset-from-config", { name, icon, description }),
  deletePreset:         (presetId)                 => ipcRenderer.invoke("delete-preset", presetId),
```

- [ ] **Step 2: Smoke check via DevTools**

Run: `npm start`. No console:

```js
console.log(typeof window.api.applyPreset);  // "function"
const r = await window.api.applyPreset("builtin:anime-720p");
console.log(r);  // { ok: true }
// Verificar config mudou:
const cfg = await window.api.getConfig();
console.log(cfg.outputRes, cfg.sufixo);  // "720p" "_720p"
```

- [ ] **Step 3: Commit**

```bash
git add preload.js
git commit -m "feat(preload): expose applyPreset, savePresetFromConfig, deletePreset"
```

---

## Phase 3 — Renderer (`index.html`)

### Task 14: i18n strings — `TRANSLATIONS` PT-BR + EN

**Files:**
- Modify: `index.html:44-180` (TRANSLATIONS.ptBR)
- Modify: `index.html:189-330` (TRANSLATIONS.en — em torno desta região)

- [ ] **Step 1: Adicionar strings em `TRANSLATIONS.ptBR`**

Localizar o bloco `TRANSLATIONS.ptBR` no topo do `<script>`. Adicionar (em qualquer posição lógica do objeto):

```js
    // Presets
    tabPresets: "🎛 Presets",
    presetsBuiltIn: "BUILT-IN",
    presetsCustom: "MEUS PRESETS",
    presetActive: "✓ ATIVO",
    presetCustom: "Personalizado",
    presetBadgeActive: "Preset ativo: ",
    btnApplyPreset: "Aplicar",
    btnSaveAsPreset: "+ Salvar atual",
    btnEditPreset: "✎ Editar",
    btnDeletePreset: "🗑 Deletar",
    presetSaveModalTitle: "Salvar config atual como preset",
    presetEditModalTitle: "Editar preset",
    presetSaveName: "Nome",
    presetSaveIcon: "Ícone (emoji)",
    presetSaveDescription: "Descrição (opcional)",
    presetSaveSnapshot: "Campos capturados",
    presetApplyWhileConverting: "Aguarde a conversão terminar para trocar de preset",
    presetCannotDeleteBuiltin: "Presets built-in não podem ser deletados",
    presetCannotEditBuiltin: "Presets built-in não podem ser editados",
    presetNameRequired: "Nome é obrigatório",
    presetDeleteConfirm: (name) => `Deletar preset '${name}'? Não pode ser desfeito.`,
    presetSaveSuccess: (name) => `Preset '${name}' salvo`,
    presetDeleteSuccess: (name) => `Preset '${name}' deletado`,
    presetApplySuccess: (name) => `Preset '${name}' aplicado`,
    res480Label: "→ 480p",
    res480Desc: "~85% menor",
    btnPresetCancel: "Cancelar",
    btnPresetSave: "Salvar",
```

- [ ] **Step 2: Adicionar equivalentes em `TRANSLATIONS.en`**

```js
    // Presets
    tabPresets: "🎛 Presets",
    presetsBuiltIn: "BUILT-IN",
    presetsCustom: "MY PRESETS",
    presetActive: "✓ ACTIVE",
    presetCustom: "Custom",
    presetBadgeActive: "Active preset: ",
    btnApplyPreset: "Apply",
    btnSaveAsPreset: "+ Save current",
    btnEditPreset: "✎ Edit",
    btnDeletePreset: "🗑 Delete",
    presetSaveModalTitle: "Save current config as preset",
    presetEditModalTitle: "Edit preset",
    presetSaveName: "Name",
    presetSaveIcon: "Icon (emoji)",
    presetSaveDescription: "Description (optional)",
    presetSaveSnapshot: "Captured fields",
    presetApplyWhileConverting: "Wait for conversion to finish before changing preset",
    presetCannotDeleteBuiltin: "Built-in presets cannot be deleted",
    presetCannotEditBuiltin: "Built-in presets cannot be edited",
    presetNameRequired: "Name is required",
    presetDeleteConfirm: (name) => `Delete preset '${name}'? Cannot be undone.`,
    presetSaveSuccess: (name) => `Preset '${name}' saved`,
    presetDeleteSuccess: (name) => `Preset '${name}' deleted`,
    presetApplySuccess: (name) => `Preset '${name}' applied`,
    res480Label: "→ 480p",
    res480Desc: "~85% smaller",
    btnPresetCancel: "Cancel",
    btnPresetSave: "Save",
```

- [ ] **Step 3: Smoke check**

Run: `npm start`. App deve abrir normal (strings não usadas ainda, mas não devem causar erros).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(ui): add i18n strings for presets (PT-BR + EN)"
```

---

### Task 15: Receber `_builtinPresets`/`_activePresetId` + state separado + indicador no painel de settings

**Files:**
- Modify: `index.html` (handler de `config-loaded`, novos states, painel de settings)

- [ ] **Step 1: Adicionar states para preset list e activeId**

Localizar onde os `useState`s do `App` component são declarados (perto de `const [stats, setStats] = useState(...)`). Adicionar:

```js
  const [builtinPresets, setBuiltinPresets] = useState([]);
  const [activePresetId, setActivePresetId] = useState(null);
```

- [ ] **Step 2: Atualizar o handler de `config-loaded`**

Localizar `window.api.on("config-loaded", ...)` (~linha 1429). Substituir TODO o handler — preservando os side effects existentes (`setFolder`, `setOutputFolder`, `setLang`):

```js
    window.api.on("config-loaded", (payload) => {
      const { _builtinPresets, _activePresetId, ...c } = payload;
      setCfg(prev => ({...prev, ...c}));
      setBuiltinPresets(_builtinPresets || []);
      setActivePresetId(_activePresetId || null);
      if (c.lastFolder)   setFolder(c.lastFolder);
      if (c.outputFolder) setOutputFolder(c.outputFolder);
      if (c.lang)         setLang(c.lang);
    });
```

Confirmar que o setter de cfg no código se chama `setCfg` (não `setConfig`) — `useState` em ~linha 1384.

- [ ] **Step 3: Computar preset ativo objeto + indicador no painel de settings**

Adicionar antes do return do componente:

```js
  const allPresets = useMemo(
    () => [...builtinPresets, ...(cfg.customPresets || [])],
    [builtinPresets, cfg.customPresets]
  );
  const activePreset = useMemo(
    () => activePresetId ? allPresets.find(p => p.id === activePresetId) : null,
    [activePresetId, allPresets]
  );

  function getPresetName(p) {
    if (!p) return null;
    if (typeof p.name === "string") return p.name;
    return p.name?.[lang] || p.name?.ptBR || p.name?.en || "?";
  }
```

Localizar o topo do painel esquerdo de settings (procurar por algo como `SettingsPanel` ou pelo bloco JSX que renderiza `t("sectionEncoder")` etc.). Adicionar como **primeira** seção:

```jsx
              {/* Preset ativo */}
              <div style={{padding:"9px 12px",borderBottom:"1px solid var(--border)",
                           display:"flex",alignItems:"center",gap:6,fontSize:11,
                           color:"var(--muted)",cursor:activePreset?"pointer":"default"}}
                   onClick={()=>activePreset && setTab("presets")}>
                <span>🎛 Preset:</span>
                {activePreset ? (
                  <span style={{color:"var(--accent)",fontWeight:600}}>
                    {activePreset.icon} {getPresetName(activePreset)}
                  </span>
                ) : (
                  <span style={{fontStyle:"italic"}}>{t("presetCustom")}</span>
                )}
              </div>
```

- [ ] **Step 4: Smoke check visual**

Run: `npm start`

Esperado:
- Painel esquerdo agora tem "🎛 Preset: ..." no topo
- Se config bater com `builtin:anime-1080p` (default do app), mostra "🎛 Preset: 🎌 Anime 1080p"
- Se mudar qualquer setting (ex: trocar CQ HD), indicador muda para "Personalizado"

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(ui): add preset state + active-preset indicator in settings panel"
```

---

### Task 16: Tab Presets — shell + render de cards built-in

**Files:**
- Modify: `index.html` (lista de tabs ~linha 1585, render condicional ~linha 1597)

- [ ] **Step 1: Adicionar `presets` à lista de tabs**

Localizar o array `[["files", t("tabFiles")], ["log", t("tabLog")]]`. Substituir por:

```jsx
                {[["files", t("tabFiles")], ["log", t("tabLog")], ["presets", t("tabPresets")]].map(([id,lbl])=>(
```

- [ ] **Step 2: Adicionar componente `PresetCard`**

Adicionar em algum lugar do `<script type="text/babel">`, antes do componente `App` (perto de outros componentes como `StatCard`):

```jsx
function PresetCard({ preset, isActive, lang, onApply, onEdit, onDelete, t }) {
  const name = typeof preset.name === "string" ? preset.name
             : (preset.name?.[lang] || preset.name?.ptBR || preset.name?.en || "?");
  const desc = typeof preset.description === "string" ? preset.description
             : (preset.description?.[lang] || preset.description?.ptBR || preset.description?.en || "");
  const f = preset.fields;
  const encoderTag = f.encoder === "cpu"
    ? `CPU ${f.cpuPreset} • CRF ${f.cqHD}`
    : `NVENC ${f.preset} • CQ ${f.cqHD}`;
  const resTag = f.outputRes !== "original" ? ` + ${f.outputRes}` : "";

  const borderColor = isActive ? "var(--accent)" : (preset.builtin ? "var(--border2)" : "var(--accent2)33");
  const shadow      = isActive ? "0 0 8px var(--accent)33" : "none";

  return (
    <div style={{border:`1px solid ${borderColor}`,boxShadow:shadow,
                 borderRadius:8,padding:"10px 12px",background:"var(--panel2)",
                 display:"flex",flexDirection:"column",gap:6,fontSize:11}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontWeight:700,color:"var(--text)"}}>{preset.icon} {name}</span>
        {isActive && (
          <span style={{fontSize:9,fontWeight:800,color:"var(--accent)",letterSpacing:1}}>
            {t("presetActive")}
          </span>
        )}
      </div>
      <div style={{fontSize:10,color:"var(--muted)"}}>{encoderTag}{resTag}</div>
      <div style={{fontSize:10,color:"var(--muted)",
                   overflow:"hidden",textOverflow:"ellipsis",
                   display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}}>{desc}</div>
      <div style={{display:"flex",gap:5,marginTop:4}}>
        <button className="btn" onClick={()=>onApply(preset)}
                style={{padding:"5px 10px",fontSize:10,fontWeight:700,
                        background:"var(--accent)22",color:"var(--accent)",
                        border:"1px solid var(--accent)55",borderRadius:5}}>
          {t("btnApplyPreset")}
        </button>
        {!preset.builtin && (
          <>
            <button className="btn" onClick={()=>onEdit(preset)}
                    style={{padding:"5px 8px",fontSize:10,background:"transparent",
                            color:"var(--muted)",border:"1px solid var(--border2)",borderRadius:5}}>
              {t("btnEditPreset")}
            </button>
            <button className="btn" onClick={()=>onDelete(preset)}
                    style={{padding:"5px 8px",fontSize:10,background:"transparent",
                            color:"var(--accent2)",border:"1px solid var(--accent2)44",borderRadius:5}}>
              {t("btnDeletePreset")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Adicionar render condicional da tab `presets`**

Localizar o bloco que renderiza `{tab==="files" ...}` e `{tab==="log" ...}`. Adicionar **após** os existentes:

```jsx
              {tab==="presets" && (
                <div style={{padding:"12px 14px",overflowY:"auto",height:"100%"}}>
                  <div style={{fontSize:10,fontWeight:800,letterSpacing:1,color:"var(--muted)",marginBottom:8}}>
                    {t("presetsBuiltIn")}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(220px, 1fr))",gap:8,marginBottom:18}}>
                    {builtinPresets.map(p => (
                      <PresetCard key={p.id} preset={p} isActive={p.id===activePresetId}
                                  lang={lang} t={t}
                                  onApply={()=>{}} onEdit={()=>{}} onDelete={()=>{}}/>
                    ))}
                  </div>

                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div style={{fontSize:10,fontWeight:800,letterSpacing:1,color:"var(--muted)"}}>
                      {t("presetsCustom")}
                    </div>
                    <button className="btn"
                            style={{padding:"5px 10px",fontSize:10,fontWeight:700,
                                    background:"var(--accent)22",color:"var(--accent)",
                                    border:"1px solid var(--accent)55",borderRadius:5}}
                            onClick={()=>{}}>
                      {t("btnSaveAsPreset")}
                    </button>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(220px, 1fr))",gap:8}}>
                    {(cfg.customPresets || []).map(p => (
                      <PresetCard key={p.id} preset={p} isActive={p.id===activePresetId}
                                  lang={lang} t={t}
                                  onApply={(p)=>{}}
                                  onEdit={()=>{}} onDelete={()=>{}}/>
                    ))}
                    {(!cfg.customPresets || cfg.customPresets.length===0) && (
                      <div style={{color:"var(--muted)",fontSize:11,fontStyle:"italic",padding:"12px 0"}}>
                        — {t("presetCustom")} —
                      </div>
                    )}
                  </div>
                </div>
              )}
```

- [ ] **Step 4: Smoke check visual**

Run: `npm start`

Esperado:
- 3ª tab "🎛 Presets" aparece. Clicando, mostra grid de 10 cards built-in
- Card que casa com config atual tem borda accent + badge "✓ ATIVO"
- Seção "MEUS PRESETS" mostra mensagem "— Personalizado —" (vazio)
- Botões `[Aplicar]` ainda não funcionam (próxima task)

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(ui): add Presets tab with built-in cards grid"
```

---

### Task 17: Wire dos botões `[Aplicar]` + bloqueio durante conversão + toast

**Files:**
- Modify: `index.html` (tab presets — handlers `onApply`)

- [ ] **Step 1: Adicionar handler `handleApplyPreset` no `App`**

Adicionar no `App` component (perto de outros handlers):

```js
  async function handleApplyPreset(preset) {
    if (running) {
      addToast(t("presetApplyWhileConverting"), "⏸", "var(--yellow)");
      return;
    }
    const r = await window.api.applyPreset(preset.id);
    if (r?.ok) {
      const name = typeof preset.name === "string" ? preset.name
                 : (preset.name?.[lang] || preset.name?.ptBR || "");
      addToast(t("presetApplySuccess")(name), "✓", "var(--green)");
    }
  }
```

- [ ] **Step 2: Wire dos `onApply` no-op para `handleApplyPreset` nos 2 `<PresetCard>`**

Localizar os 2 `<PresetCard ...>` da tab presets (built-in e custom). Em cada um, substituir `onApply={()=>{}}` (ou `onApply={(p)=>{}}` no custom) por `onApply={handleApplyPreset}`.

- [ ] **Step 3: Smoke check**

Run: `npm start`

- Clicar `[Aplicar]` em `Anime 720p` quando ocioso → toast "Preset 'Anime 720p' aplicado", e settings no painel esquerdo mudam para os 9 campos do preset
- Indicador "🎛 Preset:" muda para o preset clicado, com badge "✓ ATIVO" agora no card de 720p
- Tentar aplicar enquanto há uma conversão rodando → toast amarelo "Aguarde a conversão..."

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(ui): wire Apply Preset button (blocks during conversion + toast)"
```

---

### Task 18: Modal "Salvar config atual como preset" (form + validação + IPC)

**Files:**
- Modify: `index.html` (state do modal, componente Modal, handler)

- [ ] **Step 1: Adicionar state do modal**

No `App`:

```js
  const [savePresetModal, setSavePresetModal] = useState(null);  // null | { name, icon, description }
```

- [ ] **Step 2: Adicionar componente `SavePresetModal`** (antes do `App`)

```jsx
function SavePresetModal({ snapshot, lang, t, onCancel, onSave }) {
  const [name, setName]           = useState("");
  const [icon, setIcon]           = useState("⭐");
  const [description, setDesc]    = useState("");
  const [error, setError]         = useState("");

  function handleSave() {
    if (!name.trim()) { setError(t("presetNameRequired")); return; }
    onSave({ name: name.trim(), icon: icon || "⭐", description });
  }

  const inputStyle = {
    width:"100%",padding:"7px 9px",background:"#0a0e14",color:"var(--text)",
    border:"1px solid var(--border2)",borderRadius:5,fontFamily:"var(--mono)",fontSize:12
  };

  return (
    <div style={{position:"fixed",inset:0,background:"#000c",zIndex:500,
                 display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"var(--panel)",border:"1px solid var(--border2)",borderRadius:10,
                   padding:"20px 24px",minWidth:380,maxWidth:480}}>
        <h2 style={{fontSize:14,color:"var(--accent)",marginBottom:14,letterSpacing:1}}>
          {t("presetSaveModalTitle")}
        </h2>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div>
            <label style={{fontSize:10,color:"var(--muted)",letterSpacing:1}}>{t("presetSaveName")}</label>
            <input style={inputStyle} value={name} onChange={(e)=>setName(e.target.value)} maxLength={40} autoFocus/>
          </div>
          <div>
            <label style={{fontSize:10,color:"var(--muted)",letterSpacing:1}}>{t("presetSaveIcon")}</label>
            <input style={inputStyle} value={icon} onChange={(e)=>setIcon(e.target.value)} maxLength={4}/>
          </div>
          <div>
            <label style={{fontSize:10,color:"var(--muted)",letterSpacing:1}}>{t("presetSaveDescription")}</label>
            <input style={inputStyle} value={description} onChange={(e)=>setDesc(e.target.value)} maxLength={120}/>
          </div>
          <div>
            <label style={{fontSize:10,color:"var(--muted)",letterSpacing:1}}>{t("presetSaveSnapshot")}</label>
            <div style={{background:"#0a0e14",border:"1px solid var(--border2)",borderRadius:5,
                         padding:"7px 10px",fontSize:10,color:"var(--muted)",lineHeight:1.6}}>
              {Object.entries(snapshot).map(([k,v]) => (
                <div key={k}><span style={{color:"var(--text)"}}>{k}:</span> {String(v)}</div>
              ))}
            </div>
          </div>
          {error && <div style={{color:"var(--accent2)",fontSize:11}}>{error}</div>}
        </div>
        <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:18}}>
          <button className="btn" onClick={onCancel}
                  style={{padding:"7px 14px",fontSize:11,background:"transparent",
                          color:"var(--muted)",border:"1px solid var(--border2)",borderRadius:5}}>
            {t("btnPresetCancel")}
          </button>
          <button className="btn" onClick={handleSave}
                  style={{padding:"7px 14px",fontSize:11,fontWeight:700,
                          background:"var(--accent)",color:"#000",border:"none",borderRadius:5}}>
            {t("btnPresetSave")}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Adicionar handler `handleOpenSaveModal` + `handleSavePreset`**

```js
  function handleOpenSaveModal() {
    const PRESET_FIELDS_RENDERER = ["profile","encoder","outputRes","cqHD","cqSD","preset","cpuPreset","jobs","sufixo"];
    const snapshot = Object.fromEntries(PRESET_FIELDS_RENDERER.map(k => [k, cfg[k]]));
    setSavePresetModal({ snapshot });
  }

  async function handleSavePreset({ name, icon, description }) {
    const r = await window.api.savePresetFromConfig(name, icon, description);
    if (r?.ok) {
      addToast(t("presetSaveSuccess")(name), "✓", "var(--green)");
      setSavePresetModal(null);
    } else if (r?.reason === "name_required") {
      addToast(t("presetNameRequired"), "✕", "var(--accent2)");
    }
  }
```

- [ ] **Step 4: Wire o botão `[+ Salvar atual]` para `handleOpenSaveModal`**

Substituir o `onClick={()=>{/* TODO */}}` do botão "Salvar atual" por `onClick={handleOpenSaveModal}`.

- [ ] **Step 5: Render do modal — perto do final do return**

Antes do `</div>` que fecha o componente App, adicionar:

```jsx
      {savePresetModal && (
        <SavePresetModal snapshot={savePresetModal.snapshot} lang={lang} t={t}
                         onCancel={()=>setSavePresetModal(null)}
                         onSave={handleSavePreset}/>
      )}
```

- [ ] **Step 6: Smoke check**

Run: `npm start`

- Tab Presets → botão "+ Salvar atual" → modal aparece
- Snapshot mostra os 9 campos atuais
- Salvar sem nome → mensagem "Nome é obrigatório"
- Salvar com nome → toast "Preset 'X' salvo", modal fecha, card novo aparece em "MEUS PRESETS"

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat(ui): add Save Preset modal with snapshot preview + validation"
```

---

### Task 19: Delete preset com confirmação

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Adicionar handler `handleDeletePreset`**

```js
  async function handleDeletePreset(preset) {
    if (preset.builtin) {
      addToast(t("presetCannotDeleteBuiltin"), "✕", "var(--accent2)");
      return;
    }
    const name = typeof preset.name === "string" ? preset.name : (preset.name?.[lang] || "?");
    if (!window.confirm(t("presetDeleteConfirm")(name))) return;
    const r = await window.api.deletePreset(preset.id);
    if (r?.ok) addToast(t("presetDeleteSuccess")(name), "✓", "var(--green)");
  }
```

- [ ] **Step 2: Wire o botão `🗑` dos custom**

Localizar os dois `<PresetCard>` na tab presets. Substituir `onDelete={()=>{}}` no segundo (custom) por `onDelete={handleDeletePreset}`. No primeiro (built-in), pode deixar como está — built-in não mostra delete; mas por segurança, também trocar.

- [ ] **Step 3: Smoke check**

Run: `npm start`

- Tab Presets → clicar 🗑 em um custom → confirm "Deletar preset 'X'? Não pode ser desfeito." → OK → card some, toast "Preset 'X' deletado"

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(ui): wire Delete preset button with confirm dialog"
```

---

### Task 20: Edit modal (só nome/ícone/descrição)

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Adicionar state + handler**

```js
  const [editPresetModal, setEditPresetModal] = useState(null);  // null | preset

  async function handleEditPreset({ name, icon, description }) {
    const target = editPresetModal;
    // Edit = delete + re-save com mesmo fields (sem IPC dedicado para edit no MVP)
    await window.api.deletePreset(target.id);
    await window.api.savePresetFromConfig(name, icon, description);
    addToast(t("presetSaveSuccess")(name), "✓", "var(--green)");
    setEditPresetModal(null);
  }
```

**Nota técnica**: o IPC `save-preset-from-config` captura snapshot dos campos ATUAIS de `cfg`. Para preservar os fields originais ao editar, precisamos aplicar o preset ANTES de salvar:

```js
  async function handleEditPreset({ name, icon, description }) {
    const target = editPresetModal;
    await window.api.applyPreset(target.id);   // aplica os fields originais
    await window.api.deletePreset(target.id);   // deleta velho
    await window.api.savePresetFromConfig(name, icon, description);
    addToast(t("presetSaveSuccess")(name), "✓", "var(--green)");
    setEditPresetModal(null);
  }
```

(Usar essa versão correta.)

- [ ] **Step 2: Adicionar componente `EditPresetModal`** (similar a SavePresetModal mas sem snapshot)

```jsx
function EditPresetModal({ preset, lang, t, onCancel, onSave }) {
  const initialName = typeof preset.name === "string" ? preset.name : (preset.name?.[lang] || "");
  const initialDesc = typeof preset.description === "string" ? preset.description : (preset.description?.[lang] || "");
  const [name, setName]        = useState(initialName);
  const [icon, setIcon]        = useState(preset.icon || "⭐");
  const [description, setDesc] = useState(initialDesc);
  const [error, setError]      = useState("");

  function handleSave() {
    if (!name.trim()) { setError(t("presetNameRequired")); return; }
    onSave({ name: name.trim(), icon: icon || "⭐", description });
  }

  const inputStyle = {
    width:"100%",padding:"7px 9px",background:"#0a0e14",color:"var(--text)",
    border:"1px solid var(--border2)",borderRadius:5,fontFamily:"var(--mono)",fontSize:12
  };

  return (
    <div style={{position:"fixed",inset:0,background:"#000c",zIndex:500,
                 display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"var(--panel)",border:"1px solid var(--border2)",borderRadius:10,
                   padding:"20px 24px",minWidth:380,maxWidth:480}}>
        <h2 style={{fontSize:14,color:"var(--accent)",marginBottom:14,letterSpacing:1}}>
          {t("presetEditModalTitle")}
        </h2>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div>
            <label style={{fontSize:10,color:"var(--muted)",letterSpacing:1}}>{t("presetSaveName")}</label>
            <input style={inputStyle} value={name} onChange={(e)=>setName(e.target.value)} maxLength={40} autoFocus/>
          </div>
          <div>
            <label style={{fontSize:10,color:"var(--muted)",letterSpacing:1}}>{t("presetSaveIcon")}</label>
            <input style={inputStyle} value={icon} onChange={(e)=>setIcon(e.target.value)} maxLength={4}/>
          </div>
          <div>
            <label style={{fontSize:10,color:"var(--muted)",letterSpacing:1}}>{t("presetSaveDescription")}</label>
            <input style={inputStyle} value={description} onChange={(e)=>setDesc(e.target.value)} maxLength={120}/>
          </div>
          {error && <div style={{color:"var(--accent2)",fontSize:11}}>{error}</div>}
        </div>
        <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:18}}>
          <button className="btn" onClick={onCancel}
                  style={{padding:"7px 14px",fontSize:11,background:"transparent",
                          color:"var(--muted)",border:"1px solid var(--border2)",borderRadius:5}}>
            {t("btnPresetCancel")}
          </button>
          <button className="btn" onClick={handleSave}
                  style={{padding:"7px 14px",fontSize:11,fontWeight:700,
                          background:"var(--accent)",color:"#000",border:"none",borderRadius:5}}>
            {t("btnPresetSave")}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire o botão `✎ Editar` dos custom**

Trocar `onEdit={()=>{}}` no `<PresetCard>` dos custom por `onEdit={(p)=>setEditPresetModal(p)}`.

- [ ] **Step 4: Render do modal — perto do final do return (após `savePresetModal`)**

```jsx
      {editPresetModal && (
        <EditPresetModal preset={editPresetModal} lang={lang} t={t}
                         onCancel={()=>setEditPresetModal(null)}
                         onSave={handleEditPreset}/>
      )}
```

- [ ] **Step 5: Smoke check**

Run: `npm start`

- Criar um custom preset
- Clicar ✎ no card custom → modal com nome/ícone/descrição pré-populados
- Mudar nome → Salvar → toast "Preset 'novo' salvo", card antigo some, novo aparece

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(ui): add Edit Preset modal for custom presets (name/icon/desc only)"
```

---

### Task 21: Adicionar opção `→ 480p` na seção de Resolução de Saída

**Files:**
- Modify: `index.html` (componente que renderiza as opções de `outputRes`)

- [ ] **Step 1: Localizar a seção de Resolução de Saída**

Grep no `index.html` por `outputRes` ou `res1080Label`. Achar o array que define as opções (provavelmente algo como `[["original", t("resOriginalLabel"), ...], ["1080p", ...], ["720p", ...]]`).

- [ ] **Step 2: Adicionar entrada `480p` ao array**

Adicionar `["480p", t("res480Label"), t("res480Desc")]` (ou no formato que o componente espera — copiar shape do `720p`).

- [ ] **Step 3: Smoke check**

Run: `npm start`

- Painel esquerdo → seção "RESOLUÇÃO DE SAÍDA" → agora tem 4 opções: Manter / 1080p / 720p / 480p
- Selecionar 480p → indicador "🎛 Preset:" muda para mostrar `builtin:mobile-480p` se outros campos baterem, ou "Personalizado"

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(ui): add 480p option to output resolution settings"
```

---

## Phase 4 — Verificação end-to-end

### Task 22: Smoke test manual completo

**Files:**
- (testes manuais — sem código)

- [ ] **Step 1: Cleanup do estado de testes anteriores**

```powershell
# Backup do config atual (opcional)
Copy-Item "$env:APPDATA\nvenc-anime-gui\config.json" "$env:APPDATA\nvenc-anime-gui\config.json.bak" -ErrorAction SilentlyContinue
```

- [ ] **Step 2: Verificar built-in presets**

Run: `npm start`

- Tab "🎛 Presets" → grid mostra exatamente 10 cards built-in
- Card que casa com config atual tem badge "✓ ATIVO"
- Aplicar `Anime 720p` → settings no painel esquerdo refletem (outputRes=720p, cqHD=26, sufixo=_720p, etc.)
- Indicador no painel esquerdo muda para "🎌 Anime 720p"

- [ ] **Step 3: Detach silencioso**

- Painel de settings → mudar manualmente CQ HD para 27
- Indicador muda para "Personalizado"
- Tab presets → nenhum card tem "✓ ATIVO"

- [ ] **Step 4: Criar custom preset**

- Painel de settings → setup os 9 campos como quiser
- Tab Presets → "+ Salvar atual" → modal abre com snapshot
- Salvar sem nome → erro "Nome é obrigatório"
- Salvar com nome "Meu teste" + ícone "🧪" + descrição → toast "Preset 'Meu teste' salvo", card novo aparece em "MEUS PRESETS"
- Aplicar outro built-in → settings mudam → aplicar "Meu teste" → settings voltam → indicador mostra "🧪 Meu teste ✓ ATIVO"

- [ ] **Step 5: Editar custom preset**

- Card "Meu teste" → ✎ Editar → modal abre com valores atuais
- Mudar nome para "Meu teste v2" → Salvar → toast "Preset 'Meu teste v2' salvo", card antigo some, novo aparece
- Aplicar novo → indicador mostra "🧪 Meu teste v2"

- [ ] **Step 6: Deletar custom preset**

- Card "Meu teste v2" → 🗑 → confirm "Deletar preset 'Meu teste v2'? Não pode ser desfeito." → OK
- Card some, toast "Preset 'Meu teste v2' deletado"
- Indicador volta para "Personalizado" (config não bate mais)

- [ ] **Step 7: Bloqueio durante conversão**

- Selecionar pasta com pelo menos 1 vídeo
- Iniciar conversão
- Tentar aplicar um preset → toast amarelo "Aguarde a conversão terminar para trocar de preset"
- Parar conversão
- Aplicar funciona normalmente

- [ ] **Step 8: i18n**

- Header → trocar idioma para EN
- Tab "🎛 Presets" → labels mudam para EN ("BUILT-IN" / "MY PRESETS" / "Apply" / etc.)
- Cards built-in com nome localizado (ex: "Anime archive (CPU)" em vez de "Anime arquivo (CPU)")
- Custom preset mantém o nome em PT-BR (string simples, não localizada)

- [ ] **Step 9: Validar todos os testes Jest passam**

Run: `npm test`

Expected: 19 testes em `presets.test.js` + os existentes (postProcess, ffmpegArgs, formatters, progressParser).

- [ ] **Step 10: Restaurar config (opcional)**

```powershell
# Se quiser voltar ao estado anterior
Copy-Item "$env:APPDATA\nvenc-anime-gui\config.json.bak" "$env:APPDATA\nvenc-anime-gui\config.json" -ErrorAction SilentlyContinue
```

---

## Notes for the implementing engineer

- **TDD onde compensa:** Phase 1 é TDD puro (módulo puro). Phase 2 (main/IPC) e Phase 3 (renderer UI) usam smoke checks via DevTools — não há infra de teste para Electron main / React sem bundler no projeto.
- **Renderer state vs config:** preserve a separação dos campos `_builtinPresets` e `_activePresetId` ao receber `config-loaded`. NÃO inclua esses campos em chamadas `setConfig` (vazariam para `config.json` como lixo).
- **Edit preset com truque (Task 20):** o IPC `save-preset-from-config` snapshot dos campos atuais. Para "editar só name/icon/desc preservando fields originais", a sequência é: aplicar → deletar velho → salvar novo. Como `apply-preset` bloqueia durante `running`, edit também herda esse bloqueio. Documentar no UX se necessário.
- **Cores e estilos:** o projeto usa CSS vars (`--accent`, `--accent2`, `--muted`, `--border`, `--panel`, `--panel2`). Reaproveitar; **não** introduzir cores novas exceto onde claramente faz sentido (laranja `#ff8800` no spec de encode-confidence — outro plano).
- **Spec é a fonte da verdade:** se alguma decisão deste plano contradizer o spec (`docs/superpowers/specs/2026-05-16-encoder-presets-design.md`), o spec ganha.
- **Encode-confidence é independente:** se ambos os planos forem executados na mesma branch, faça encode-confidence primeiro (menor, sem conflito visual). Os dois podem coexistir; não há overlap nos handlers IPC nem nos status de arquivo.
