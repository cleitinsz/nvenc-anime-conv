# Encoder Presets — Design Spec

**Date:** 2026-05-16
**Status:** Approved

## Summary

Adicionar uma tab "🎛 PRESETS" no painel direito (3ª tab ao lado de Files/Log) que lista cards de presets de encoder aplicáveis com um clique. O app vem com **10 built-in** read-only (cobrindo anime/live-action, NVENC/CPU, várias resoluções) e suporta **custom presets** do usuário (CRUD completo via "Salvar config atual como preset").

Cada preset sobrescreve **9 campos de encoder** (`profile`, `encoder`, `outputRes`, `cqHD`, `cqSD`, `preset`, `cpuPreset`, `jobs`, `sufixo`). Mudança manual de qualquer um desses campos no painel de settings **deseleciona** o preset silenciosamente (detach). Campos de workflow (`outputFolder`, `outputMode`, `deletarOriginal`, `lang`) ficam fora do escopo de presets.

---

## 1. Approach

Toda a lógica vive num módulo puro novo: `src/utils/presets.js`. Match com o padrão estabelecido (`ffmpegArgs.js`, `formatters.js`, `progressParser.js`): funções recebem dependências por parâmetro, sem fs/electron, 100% testáveis com Jest.

Storage: **tudo em `config.json`**. Built-in vivem em constante (`BUILTIN_PRESETS`). Custom presets vão num campo novo `config.customPresets: []`. Preset ativo é **derivado** do estado atual via `findActivePreset` — não é persistido — garantindo consistência mesmo se o usuário editar `config.json` manualmente.

`main.js` ganha 3 IPC handlers (`apply-preset`, `save-preset-from-config`, `delete-preset`), cada um < 20 linhas, delegando lógica para `presets.js`.

---

## 2. Modelo de dados

Shape de um preset:

```js
{
  id:        string,    // "builtin:anime-1080p" ou "custom:<uuid>"
  name:      string | { ptBR: string, en: string },  // localized em built-in
  builtin:   boolean,   // true só em built-in (read-only)
  icon:      string,    // emoji curto: "🎌", "🎬", "💾", "📱"
  description: string | { ptBR: string, en: string },
  fields: {
    profile:    "anime" | "liveaction",
    encoder:    "nvenc" | "cpu",
    outputRes:  "original" | "1080p" | "720p" | "480p",
    cqHD:       number,
    cqSD:       number,
    preset:     "p4" | "p5" | "p6" | "p7",       // NVENC
    cpuPreset:  "faster" | "fast" | "medium" | "slow" | "slower",
    jobs:       number,
    sufixo:     string,
  }
}
```

Built-in: `name` e `description` são objetos `{ ptBR, en }`. Custom: strings simples (usuário escreveu na sua locale).

**Forma "preset parcial"** (campos opcionais em `fields`) é tecnicamente suportada pelo schema, mas a UI atual sempre captura os 9 campos ao salvar. Reservado para futuros use cases.

---

## 3. Built-in presets

`src/utils/presets.js` exporta `BUILTIN_PRESETS` com exatamente 10 entradas:

| # | id | Nome (PT/EN) | Perfil | Encoder | Res | CQ HD/SD | Jobs | Sufixo | Caso de uso |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `builtin:anime-1080p` | Anime 1080p | anime | NVENC p6 | original | 28/26 | 2 | `_hevc` | Padrão atual |
| 2 | `builtin:anime-720p` | Anime 720p | anime | NVENC p6 | 720p | 26/24 | 2 | `_720p` | Mais economia |
| 3 | `builtin:anime-4k-to-1080p` | Anime 4K → 1080p | anime | NVENC p6 | 1080p | 28/26 | 2 | `_1080p` | Downscale fontes 4K |
| 4 | `builtin:anime-archive` | Anime arquivo (CPU) | anime | CPU slower | original | 20/18 | 1 | `_archive` | Máx qualidade, lento |
| 5 | `builtin:live-1080p` | Live-action 1080p | liveaction | NVENC p6 | original | 26/24 | 2 | `_hevc` | Filmes/séries |
| 6 | `builtin:live-720p` | Live-action 720p | liveaction | NVENC p6 | 720p | 24/22 | 2 | `_720p` | Filmes menores |
| 7 | `builtin:live-archive` | Live-action arquivo (CPU) | liveaction | CPU slower | original | 19/18 | 1 | `_archive` | Preservar grain |
| 8 | `builtin:preview-quick` | Pré-visualização rápida | anime | NVENC p4 | 720p | 32/30 | 3 | `_preview` | Teste antes de batch |
| 9 | `builtin:storage-saver` | Storage saver | anime | CPU slower | original | 28/26 | 1 | `_min` | Máx compressão (lento) |
| 10 | `builtin:mobile-480p` | Mobile 480p | anime | NVENC p6 | 480p | 26/24 | 2 | `_mobile` | Assistir no celular |

Notas:
- Linhas com `Encoder = CPU slower` usam **CRF** (escala 1-51, menor = melhor). A coluna "CQ HD/SD" representa CRF naqueles casos.
- Cada preset tem sufixo distinto para não conflitar com outputs de outros presets (re-encode com sufixo novo cria arquivo separado).
- Ícones sugeridos: 🎌 (anime), 🎬 (live-action), 💾 (archive/storage saver), ⚡ (preview), 📱 (mobile).

---

## 4. Módulo `src/utils/presets.js`

### 4.1 Exports

```js
module.exports = {
  BUILTIN_PRESETS,
  PRESET_FIELDS,     // ["profile","encoder","outputRes","cqHD","cqSD","preset","cpuPreset","jobs","sufixo"]
  applyPreset,
  isPresetActive,
  findActivePreset,
  generateCustomId,
  getLocaleField,
};
```

### 4.2 Funções

```js
// Retorna NOVO config com os campos do preset mesclados sobre o currentConfig.
// Não muta currentConfig. Campos fora de PRESET_FIELDS preservados.
function applyPreset(preset, currentConfig) { … }

// Shallow-equal entre preset.fields e currentConfig nos PRESET_FIELDS.
function isPresetActive(preset, currentConfig) { … }   // → boolean

// Procura preset cujos fields batem com currentConfig.
// Prioridade: built-in > custom (estável quando dois presets diferentes têm fields idênticos).
function findActivePreset(currentConfig, allPresets) { … }  // → preset|null

// Gera ID custom único: "custom:" + UUID-v4 simples (Math.random()-based, sem dep).
function generateCustomId() { … }  // → string

// Retorna preset[field] resolvido para a locale.
// Se preset[field] é string, retorna ela. Se é objeto { ptBR, en }, retorna o slot da lang.
// Fallback: ptBR > en > primeira chave disponível.
function getLocaleField(preset, field, lang) { … }  // → string
```

Todas as funções são **puras** — input/output de objetos JS, sem fs/electron/network. Testáveis com Jest direto sem mocks complexos.

### 4.3 `SCALE_FILTER` ganha 480p

Em `src/utils/ffmpegArgs.js`:

```js
const SCALE_FILTER = {
  "1080p": "scale=-2:1080:flags=lanczos",
  "720p":  "scale=-2:720:flags=lanczos",
  "480p":  "scale=-2:480:flags=lanczos",  // novo
};
```

UI de "Resolução de Saída" no painel de settings ganha opção `→ 480p` correspondente.

---

## 5. Mudanças em `config.json`

Schema atual ganha **um campo novo**:

```js
{
  // ... 17 campos existentes inalterados ...
  customPresets: [],   // novo — array de presets custom (default: vazio)
}
```

`loadConfig` em `main.js` adiciona `customPresets: []` ao objeto de defaults. Configs antigas continuam carregando sem erro.

**Preset ativo NÃO é persistido em config.** É derivado a cada render via `findActivePreset(config, [...BUILTIN_PRESETS, ...config.customPresets])`.

---

## 6. IPC

### 6.1 `preload.js` expõe 3 métodos novos

```js
applyPreset:          (presetId)                  => ipcRenderer.invoke("apply-preset", presetId),
savePresetFromConfig: (name, icon, description)   => ipcRenderer.invoke("save-preset-from-config", { name, icon, description }),
deletePreset:         (presetId)                  => ipcRenderer.invoke("delete-preset", presetId),
```

### 6.2 Handlers em `main.js`

Pequeno helper para padronizar a emissão (recomputa `_activePresetId` toda vez):

```js
function emitConfigLoaded() {
  const all = [...BUILTIN_PRESETS, ...(config.customPresets || [])];
  const active = findActivePreset(config, all);
  mainWindow?.webContents.send("config-loaded", {
    ...config,
    _builtinPresets: BUILTIN_PRESETS,
    _activePresetId: active?.id || null,
  });
}
```

`did-finish-load` no `app.whenReady` passa a chamar `emitConfigLoaded()` em vez de `mainWindow.webContents.send("config-loaded", config)`.

Os 3 handlers:

```js
ipcMain.handle("apply-preset", (_, presetId) => {
  const all = [...BUILTIN_PRESETS, ...(config.customPresets || [])];
  const preset = all.find(p => p.id === presetId);
  if (!preset) return { ok: false, reason: "not_found" };
  if (running)  return { ok: false, reason: "converting" };  // bloqueio §7.5
  config = applyPreset(preset, config);
  saveConfig(config);
  emitConfigLoaded();
  return { ok: true };
});

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

ipcMain.handle("delete-preset", (_, presetId) => {
  if (presetId.startsWith("builtin:")) return { ok: false, reason: "is_builtin" };
  config.customPresets = (config.customPresets || []).filter(p => p.id !== presetId);
  saveConfig(config);
  emitConfigLoaded();
  return { ok: true };
});
```

Handler `set-config` (existente em `main.js:288`) também passa a chamar `emitConfigLoaded()` no final, para que `_activePresetId` recompute quando o usuário edita config manualmente no painel (caminho do "detach silencioso" — §7.6).

### 6.3 Lista canônica de presets via payload `config-loaded` estendido

**Restrição**: o renderer roda com `contextIsolation=true` e `nodeIntegration=false` (ver CLAUDE.md). Não pode `require('./src/utils/presets')`. Portanto **`presets.js` é importado apenas em `main.js`** (Node-side, CommonJS). Renderer recebe os dados via IPC.

**Contrato `config-loaded` estendido**: payload ganha 2 campos auxiliares prefixados com `_`:

```js
// Antes: payload = config object
// Depois:
{
  ...config,                          // todos os campos atuais inalterados
  _builtinPresets: BUILTIN_PRESETS,   // novo (sempre a mesma lista; enviado pra evitar duplicação no renderer)
  _activePresetId: string | null,     // novo (resultado de findActivePreset)
}
```

**Manuseio no renderer**: ao receber `config-loaded`, separar e armazenar em states distintos:

```js
api.on("config-loaded", (payload) => {
  const { _builtinPresets, _activePresetId, ...cfg } = payload;
  setConfig(cfg);
  setBuiltinPresets(_builtinPresets);
  setActivePresetId(_activePresetId);
});
```

Isso evita que os campos `_*` vazem de volta para `set-config` (que persistiria como lixo em `config.json`). `setConfig` no renderer só envia campos legítimos de config.

**Emissão**: `config-loaded` é re-emitido em todos os handlers que modificam config (incluindo os 3 novos handlers de presets), recomputando `_activePresetId` a cada vez. Único `config-loaded` extra além do já-existente em `did-finish-load`.

---

## 7. UI

### 7.1 Tab Presets (painel direito, 3ª tab)

Layout:

```
┌─ PRESETS ──────────────────────────────────────────────┐
│  BUILT-IN                                              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │ 🎌 Anime     │ │ 🎌 Anime     │ │ 🎌 Anime 4K  │   │
│  │ 1080p ✓ATIVO │ │ 720p         │ │ → 1080p      │   │
│  │ NVENC p6•CQ28│ │ NVENC p6•CQ26│ │ NVENC p6•CQ28│   │
│  │ Padrão       │ │ Mais econom. │ │ Downscale 4K │   │
│  │ [aplicar]    │ │ [aplicar]    │ │ [aplicar]    │   │
│  └──────────────┘ └──────────────┘ └──────────────┘   │
│  ... (mais 7 cards built-in em grid responsivo)       │
│                                                        │
│  MEUS PRESETS                       [+ Salvar atual]  │
│  ┌──────────────┐                                     │
│  │ ⭐ Meu 4K    │                                     │
│  │ CPU slower   │                                     │
│  │ CRF 22       │                                     │
│  │ Custom       │                                     │
│  │ [aplicar] [✎] [🗑]                                  │
│  └──────────────┘                                     │
│                                                        │
│  Preset ativo: 🎌 Anime 1080p                          │
└────────────────────────────────────────────────────────┘
```

Grid responsivo: 3 colunas em telas largas, 2 em médias, 1 em estreitas.

### 7.2 Card de preset

Conteúdo:
- **Linha 1**: ícone + nome (negrito) + badge `✓ ATIVO` (apenas no preset ativo)
- **Linha 2**: tags resumo — `NVENC p6 • CQ 28` ou `CPU slower • CRF 20`, sufixo se relevante (`+ scale 720p`, `+ _archive`)
- **Linha 3**: descrição (texto pequeno, max 2 linhas com truncate)
- **Linha 4**: botões — `[Aplicar]` sempre; `[✎ Editar]` e `[🗑 Deletar]` só em custom

Visual: card built-in usa cor de borda neutra; custom usa borda discreta com tom `--accent2`. Preset ativo ganha borda `--accent` + leve glow.

### 7.3 Modal "Salvar config atual como preset"

Acionado por `[+ Salvar atual]`. Campos:
- **Nome** (required, max 40 chars)
- **Ícone** (input livre, default `⭐`, max 4 chars — aceita emoji)
- **Descrição** (optional, max 120 chars)
- **Snapshot dos 9 fields** mostrado read-only para o usuário confirmar (lista vertical: `Perfil: anime`, `Encoder: nvenc`, ...)
- Botões: `[Cancelar]` `[Salvar]`

Validação: nome não pode ser vazio; trim antes de salvar.

### 7.4 Modal "Editar custom preset"

Mesma estrutura do modal de salvar, **menos** o snapshot. Só edita `name`/`icon`/`description`. Para mudar `fields` o fluxo é: aplicar o preset → ajustar config → re-salvar como novo preset → deletar o velho.

Decisão: edição inline de fields fica fora do escopo (§ Out of Scope).

### 7.5 Bloqueio durante conversão

Se `running === true` quando o usuário clica `[Aplicar]`:
- Toast: "Aguarde a conversão atual terminar para trocar de preset"
- Aplicação é abortada (handler retorna `{ ok: false, reason: "converting" }`)

`[+ Salvar atual]` e `[🗑 Deletar]` NÃO bloqueiam durante conversão (não afetam encode em andamento).

### 7.6 Indicador no painel de settings (esquerdo)

Adicionar uma linha no **topo** do painel de settings (sempre visível):

```
🎛 Preset: 🎌 Anime 1080p
```

ou (quando não bate com nenhum preset):

```
🎛 Preset: Personalizado
```

Lê o state `activePresetId` (populado pelo handler de `config-loaded` — §6.3). Quando `null`, mostra `t("presetCustom")`. Quando bate, faz lookup no estado `builtinPresets ++ config.customPresets` e resolve via `getLocaleField(preset, "name", lang)`. Click no nome → `setTab("presets")` (mudar tab para Presets).

Como `_activePresetId` é recomputado em main a cada `set-config` (§6.2), o detach silencioso acontece automaticamente: usuário mexe num campo → renderer faz `setConfig({ fieldChanged })` → main re-emite `config-loaded` com novo `_activePresetId: null` → indicador mostra "Personalizado".

---

## 8. i18n

### 8.1 Strings novas em `TRANSLATIONS` (`index.html`)

PT-BR e EN:

| Chave | PT-BR | EN |
|---|---|---|
| `tabPresets` | 🎛 Presets | 🎛 Presets |
| `presetsBuiltIn` | BUILT-IN | BUILT-IN |
| `presetsCustom` | MEUS PRESETS | MY PRESETS |
| `presetActive` | ✓ ATIVO | ✓ ACTIVE |
| `presetCustom` | Personalizado | Custom |
| `presetBadgeActive` | Preset ativo: | Active preset: |
| `btnApplyPreset` | Aplicar | Apply |
| `btnSaveAsPreset` | + Salvar atual | + Save current |
| `btnEditPreset` | ✎ Editar | ✎ Edit |
| `btnDeletePreset` | 🗑 Deletar | 🗑 Delete |
| `presetSaveModalTitle` | Salvar config atual como preset | Save current config as preset |
| `presetEditModalTitle` | Editar preset | Edit preset |
| `presetSaveName` | Nome | Name |
| `presetSaveIcon` | Ícone (emoji) | Icon (emoji) |
| `presetSaveDescription` | Descrição (opcional) | Description (optional) |
| `presetSaveSnapshot` | Campos capturados | Captured fields |
| `presetApplyWhileConverting` | Aguarde a conversão terminar para trocar de preset | Wait for conversion to finish before changing preset |
| `presetCannotDeleteBuiltin` | Presets built-in não podem ser deletados | Built-in presets cannot be deleted |
| `presetCannotEditBuiltin` | Presets built-in não podem ser editados | Built-in presets cannot be edited |
| `presetNameRequired` | Nome é obrigatório | Name is required |
| `res480Label` | → 480p | → 480p |
| `res480Desc` | ~85% menor | ~85% smaller |

**Strings parametrizadas** (mesmo padrão de `btnRetry: (n) => ...` em `index.html` e `LOG_STRINGS` em `main.js`):

| Chave | PT-BR | EN |
|---|---|---|
| `presetDeleteConfirm` | `(name) => \`Deletar preset '${name}'? Não pode ser desfeito.\`` | `(name) => \`Delete preset '${name}'? Cannot be undone.\`` |
| `presetSaveSuccess` | `(name) => \`Preset '${name}' salvo\`` | `(name) => \`Preset '${name}' saved\`` |
| `presetDeleteSuccess` | `(name) => \`Preset '${name}' deletado\`` | `(name) => \`Preset '${name}' deleted\`` |
| `presetApplySuccess` | `(name) => \`Preset '${name}' aplicado\`` | `(name) => \`Preset '${name}' applied\`` |

### 8.2 Nomes/descrições localizados dos built-in

Vivem **dentro** de `BUILTIN_PRESETS` em `presets.js` como objetos `{ ptBR, en }`:

```js
{ id: "builtin:anime-1080p",
  name:        { ptBR: "Anime 1080p",         en: "Anime 1080p" },
  description: { ptBR: "Padrão para a maioria dos animes (NVENC)",
                 en: "Default for most anime (NVENC)" },
  // ...
}
```

Resolvidos via `getLocaleField(preset, field, lang)`. Custom presets armazenam `name`/`description` como **string simples** (usuário escreveu uma string única na locale atual; não traduzimos automaticamente).

---

## 9. Testes

Arquivo novo: `tests/presets.test.js`.

### 9.1 Matriz de testes

| # | Cenário | Expect |
|---|---|---|
| 1 | `applyPreset` aplica os 9 campos no config | output tem todos os 9 sobrescritos |
| 2 | `applyPreset` preserva campos NÃO cobertos (outputFolder, lang, etc.) | inalterados |
| 3 | `applyPreset` não muta input | `currentConfig` original intacto |
| 4 | `isPresetActive` retorna `true` quando todos os 9 campos batem | `true` |
| 5 | `isPresetActive` retorna `false` quando 1 campo diverge | `false` |
| 6 | `findActivePreset` acha o built-in correto | preset esperado |
| 7 | `findActivePreset` retorna `null` quando nenhum bate | `null` |
| 8 | `findActivePreset` prefere built-in sobre custom em empate | built-in retornado |
| 9 | `generateCustomId` gera IDs únicos | 100 chamadas → 100 IDs distintos |
| 10 | `generateCustomId` sempre prefixa `custom:` | `/^custom:/.test()` |
| 11 | `BUILTIN_PRESETS` tem exatamente 10 entradas | `length === 10` |
| 12 | Todos built-in têm IDs únicos | `new Set(ids).size === 10` |
| 13 | Todos built-in têm os 9 campos `fields` preenchidos | nenhum `undefined` |
| 14 | Todos built-in usam valores válidos | `profile ∈ {anime,liveaction}`, etc. |
| 15 | `getLocaleField` resolve string simples | retorna a string como veio |
| 16 | `getLocaleField` resolve objeto localizado pela lang | objeto `{ ptBR, en }` + lang `"en"` → slot `en` |
| 17 | `getLocaleField` fallback: lang ausente → tenta `ptBR` | lang `"jp"` (não definida) → retorna slot `ptBR` |
| 18 | `getLocaleField` fallback: ptBR também ausente → tenta `en` | objeto `{ en: "..." }` + lang `"jp"` → retorna slot `en` |
| 19 | `getLocaleField` fallback: nenhuma chave conhecida → primeira chave do objeto | objeto `{ ja: "..." }` + lang `"jp"` → retorna slot `ja` |

Handlers IPC em `main.js` ficam fora deste spec (próximo bundle "Cobertura de main.js"). Confiança via testes puros de `applyPreset`/`findActivePreset` é suficiente.

---

## 10. Migração / Compatibilidade

- **Configs antigas**: `loadConfig` adiciona `customPresets: []` ao defaults. Nada quebra.
- **Sufixos**: presets têm sufixos distintos (`_720p`, `_archive`, etc.). Trocar de preset gera **outputs distintos** — o output antigo (`_hevc`) não é detectado como já-convertido pelo scan, então re-aparece como `queue`. **Comportamento intencional**: cada preset = nova "view" do arquivo. Documentar no help/log.
- **`SCALE_FILTER` ganhando `480p`**: zero impacto em configs existentes; apenas adiciona opção.
- **Sem auto-aplicar preset**: usuários existentes mantêm config atual; se bater com algum built-in, aparece como `✓ ATIVO` naturalmente.

---

## 11. Out of Scope

Fora deste spec (futuros bundles):

- **Export/import de presets** (arquivo JSON compartilhável)
- **Edição inline de fields em custom presets** (hoje só edita name/icon/description)
- **Override de preset por arquivo** (settings individuais — pertencente ao bundle "Fila viva")
- **Presets parciais via UI** (schema suporta, UI captura sempre os 9)
- **Preset auto-suggestion** (detectar tipo de conteúdo e sugerir preset — pertence ao bundle "Encode mais inteligente")
- **Duplicar built-in como ponto de partida custom** (small feature, fácil de adicionar depois)
- **Preset versioning** (atualizar built-in sem quebrar custom derivados)
- **Encode confidence** (já specificado em `2026-05-16-encode-confidence-design.md` — feature ortogonal)
