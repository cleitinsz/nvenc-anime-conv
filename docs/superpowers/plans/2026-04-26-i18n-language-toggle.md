# i18n Language Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PT-BR ↔ EN language toggle to the header that translates all UI and log strings, persisted in `config.json`.

**Architecture:** A `TRANSLATIONS` object in `index.html` holds all strings for both locales. A React `LanguageContext` + `useT()` hook distributes `t(key)` to all components. `main.js` uses a parallel `LOG_STRINGS` object and reads `config.lang` to pick the active locale for IPC log messages.

**Tech Stack:** React 18 (CDN), Electron IPC, Jest (existing test setup, not extended — renderer components can't be unit-tested without a bundler)

---

## File Map

| File | Change |
|---|---|
| `main.js` | Add `LOG_STRINGS`, add `lang: "ptBR"` to config defaults, replace all template-literal log strings with `L.functionName(...)` calls |
| `index.html` | Add `TRANSLATIONS`, `LanguageContext`, `useT`, `LanguageProvider`, `LangToggle`; migrate every hardcoded string in every component |

---

## Task 1: Add `LOG_STRINGS` to `main.js`

**Files:**
- Modify: `main.js`

- [ ] **Step 1: Add `LOG_STRINGS` constant near the top of `main.js` (after requires, before `let mainWindow`)**

Find the line `let mainWindow = null;` and insert immediately before it:

```js
const LOG_STRINGS = {
  ptBR: {
    slotStart:   (id, name, h, enc) => `[Slot ${id}] Iniciando: ${name} | ${h}p ${enc}`,
    slotSuspect: (id, kb, name)     => `[Slot ${id}] Saída suspeita (${kb}KB): ${name}`,
    slotDone:    (id, name, mb1, mb2, pct, min) => `[Slot ${id}] ${name} | ${mb1}MB → ${mb2}MB (-${pct}%) | ${min}min`,
    slotDeleted: (id, name)         => `[Slot ${id}] Original deletado: ${name}`,
    slotFailed:  (id, name, code)   => `[Slot ${id}] FALHA: ${name} | ExitCode ${code}`,
    slotCause:   (err)              => `  CAUSA: ${err}`,
    sessionDone: (done, errs, gb, min) => `=== Concluído | Convertidos: ${done} | Erros: ${errs} | Ganho: ${gb} GB | Tempo: ${min}min ===`,
    starting:    (n, jobs, gpu, preset) => `Iniciando | ${n} arquivos | ${jobs} jobs | GPU ${gpu} | Preset ${preset}`,
    retrying:    (n)                => `Retentando ${n} arquivo(s) com erro...`,
    stopped:     ()                 => "Conversão interrompida pelo usuário.",
  },
  en: {
    slotStart:   (id, name, h, enc) => `[Slot ${id}] Starting: ${name} | ${h}p ${enc}`,
    slotSuspect: (id, kb, name)     => `[Slot ${id}] Suspicious output (${kb}KB): ${name}`,
    slotDone:    (id, name, mb1, mb2, pct, min) => `[Slot ${id}] ${name} | ${mb1}MB → ${mb2}MB (-${pct}%) | ${min}min`,
    slotDeleted: (id, name)         => `[Slot ${id}] Original deleted: ${name}`,
    slotFailed:  (id, name, code)   => `[Slot ${id}] FAILED: ${name} | ExitCode ${code}`,
    slotCause:   (err)              => `  REASON: ${err}`,
    sessionDone: (done, errs, gb, min) => `=== Done | Converted: ${done} | Errors: ${errs} | Saved: ${gb} GB | Time: ${min}min ===`,
    starting:    (n, jobs, gpu, preset) => `Starting | ${n} files | ${jobs} jobs | GPU ${gpu} | Preset ${preset}`,
    retrying:    (n)                => `Retrying ${n} file(s) with errors...`,
    stopped:     ()                 => "Conversion stopped by user.",
  },
};
```

- [ ] **Step 2: Add `lang` default to `loadConfig()`**

Find the `loadConfig` function. It returns an object of defaults spread with saved values. Add `lang: "ptBR"` to the defaults object:

```js
// before (example excerpt):
return { gpu: 0, preset: "p6", jobs: 2, ..., ...saved };

// after — add lang to the defaults:
return { gpu: 0, preset: "p6", jobs: 2, ..., lang: "ptBR", ...saved };
```

- [ ] **Step 3: Add a `L` shorthand helper after `loadConfig` is called / config is initialized**

Find where `config` is first assigned (e.g. `let config = loadConfig();`). Add one line after it:

```js
let L = LOG_STRINGS[config.lang] || LOG_STRINGS.ptBR;
```

- [ ] **Step 4: Update `L` whenever `set-config` is received**

Find the `ipcMain.on("set-config", ...)` handler. After `Object.assign(config, newCfg)` (or equivalent), add:

```js
L = LOG_STRINGS[config.lang] || LOG_STRINGS.ptBR;
```

- [ ] **Step 5: Replace all `log()` template literals in `main.js` with `L.*` calls**

Replace each hardcoded log string with the matching `L` function. Exact replacements:

```js
// line ~304 — slot start
log("INFO", `[Slot ${slotId}] Iniciando: ${item.name} | ${item.height}p ${encLabel}`);
// → 
log("INFO", L.slotStart(slotId, item.name, item.height, encLabel));

// line ~329 — suspicious output
log("ERRO", `[Slot ${slotId}] Saída suspeita (${Math.round(sizeAfter/1024)}KB): ${item.name}`);
// →
log("ERRO", L.slotSuspect(slotId, Math.round(sizeAfter/1024), item.name));

// line ~340 — slot done
log("OK", `[Slot ${slotId}] ${item.name} | ${mb1}MB → ${mb2}MB (-${reducao}%) | ${durConv}min`);
// →
log("OK", L.slotDone(slotId, item.name, mb1, mb2, reducao, durConv));

// line ~347 — original deleted
log("INFO", `[Slot ${slotId}] Original deletado: ${item.name}`);
// →
log("INFO", L.slotDeleted(slotId, item.name));

// line ~358 — slot failed
log("ERRO", `[Slot ${slotId}] FALHA: ${item.name} | ExitCode ${code}`);
// →
log("ERRO", L.slotFailed(slotId, item.name, code));

// line ~359 — cause
log("ERRO", `  CAUSA: ${lastError}`);
// →
log("ERRO", L.slotCause(lastError));

// line ~384 — session done
log("OK", `=== Concluído | Convertidos: ${doneCount} | Erros: ${errorCount} | Ganho: ${ganhoGB} GB | Tempo: ${totalMin}min ===`);
// →
log("OK", L.sessionDone(doneCount, errorCount, ganhoGB, totalMin));

// line ~506 — starting
log("INFO", `Iniciando | ${queue.length} arquivos | ${config.jobs} jobs | GPU ${config.gpu} | Preset ${config.preset}`);
// →
log("INFO", L.starting(queue.length, config.jobs, config.gpu, config.preset));

// line ~514 — retrying
log("INFO", `Retentando ${errorFiles.length} arquivo(s) com erro...`);
// →
log("INFO", L.retrying(errorFiles.length));

// line ~531 — stopped
log("AVISO", "Conversão interrompida pelo usuário.");
// →
log("AVISO", L.stopped());
```

- [ ] **Step 6: Start the app and verify PT-BR logs appear correctly**

```bash
npm start
```

Select a folder, start a conversion, check the log panel shows PT-BR strings as before.

- [ ] **Step 7: Commit**

```bash
git add main.js
git commit -m "feat(i18n): add LOG_STRINGS to main.js, wire lang to config"
```

---

## Task 2: Add `TRANSLATIONS` + i18n infrastructure to `index.html`

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add `TRANSLATIONS` constant at the very top of the `<script type="text/babel">` block, before the `useComparison` function**

```js
const TRANSLATIONS = {
  ptBR: {
    // Header / status
    appName: "NVENC ANIME",
    appVersion: "H.265 CONVERTER v1.3",
    statusConverting: "CONVERTENDO",
    statusScanning: "ANALISANDO",
    statusReady: "PRONTO",

    // Sidebar sections
    sectionEncoder: "ENCODER",
    sectionProfile: "PERFIL",
    sectionInputFolder: "PASTA DE ENTRADA",
    sectionOutputFolder: "PASTA DE SAÍDA",
    sectionOutputRes: "RESOLUÇÃO DE SAÍDA",
    sectionJobs: "JOBS PARALELOS",
    sectionPresetCPU: "PRESET x265",
    sectionPresetNVENC: "PRESET NVENC",
    sectionGPU: "GPU",
    sectionQualitySuffix: "QUALIDADE",
    sectionOptions: "OPÇÕES",

    // Encoder
    cpuWarning: "⚠ Mais lento, comprime melhor. Use 1 job.",

    // Profiles
    profileAnimeLabel: "🎌 ANIME",
    profileAnimeDesc: "Denoise + debanding",
    profileLiveLabel: "🎬 LIVE ACTION",
    profileLiveDesc: "Sem filtros, grain preservado",

    // Output folder modes
    outputSameLabel: "Mesma pasta",     outputSameDesc: "Ao lado do original",
    outputEncodedLabel: "Subpasta /encoded", outputEncodedDesc: "Criada automaticamente",
    outputCustomLabel: "Personalizada", outputCustomDesc: "Você escolhe",
    noOutputFolder: "⚠ Nenhuma pasta selecionada",

    // Output resolution
    resOriginalLabel: "Manter",   resOriginalDesc: "Sem downscale",
    res1080Label: "→ 1080p",      res1080Desc: "~60% menor",
    res720Label: "→ 720p",        res720Desc: "~80% menor",
    resWarning: "⚠ Arquivos HEVC também serão convertidos.",

    // Jobs
    jobsNoteNVENC: "⚠ Máx. consumer NVIDIA: 3",
    jobsNoteCPU: "⚠ CPU: recomendado 1 job",

    // CQ
    cqHDLabel: "1080p+",
    cqSDLabel: "720p–",
    cqNoteNVENC: "Menor = melhor qualidade",
    cqNoteCPU: "Menor = melhor · escala 1–51",

    // Presets
    presetFaster: "Rápido",   presetFast: "Balanceado",  presetMedium: "Padrão",
    presetSlow: "Melhor",     presetSlower: "Máximo",
    presetNvencP4: "Rápido",  presetNvencP5: "Médio",
    presetNvencP6: "Recomendado", presetNvencP7: "Lento",

    // Options
    deleteOriginal: "Deletar original",

    // Buttons
    btnChangeFolder: "📁 TROCAR PASTA",
    btnChooseFolder: "📂 ESCOLHER PASTA",
    btnStart: "▶ INICIAR",
    btnStop: "⏹ PARAR",
    btnRetry: (n) => `↺ RETENTAR ERROS (${n})`,
    noFolder: "Nenhuma pasta selecionada",

    // Status badges
    statusQueue: "FILA",   statusEncode: "ENCODE",
    statusDone: "PRONTO",  statusError: "ERRO",
    statusDoneSkip: "JÁ OK", statusHevcSkip: "HEVC",

    // Stats
    statTotal: "TOTAL",       statConverted: "CONVERTIDOS",
    statEncoding: "EM ENCODE", statErrors: "ERROS",
    statSaved: "ESPAÇO SALVO",
    statFiles: "arquivos",    statSlots: "slots",    statFreed: "liberados",
    statConvertedSub: (n) => `de ${n}`,

    // Tabs
    tabFiles: "📋 Arquivos",
    tabLog: "📄 Log",

    // File list
    filterAll: "Todos",    filterQueue: "Fila",
    filterEncoding: "Encode", filterDone: "Prontos", filterErrors: "Erros",
    searchPlaceholder: "Buscar arquivo...",
    noResults: (q) => `Nenhum resultado para "${q}"`,
    noFiles: "Nenhum arquivo",

    // Context menu
    ctxCompare: "Comparar visual",
    ctxOpenFolder: "Abrir pasta",
    ctxCopyPath: "Copiar caminho",

    // Log viewer
    logLines: (n) => `${n} linhas`,
    logPinned: "📌 FIXADO",
    logPin: "FIXAR",
    logWaiting: "Aguardando início da conversão...",

    // Active slots
    slotEta: "ETA",

    // Scan screen
    scanPhaseProbe: "Lendo metadados (paralelo)...",
    scanPhaseListing: "Listando arquivos...",
    scanFiles: "arquivos",

    // Empty state
    emptyTitle: "Selecione uma pasta para começar",
    emptyBtn: "📁 SELECIONAR PASTA",

    // Comparison modal
    modalTitle: "Comparação Visual",
    modalTimestamp: "Timestamp:",
    modalIdle: 'Ajuste o timestamp e clique em "Gerar Preview"',
    modalTimestampAt: (pct, time) => `Timestamp: ${pct}% (${time})`,
    modalProcessing: "Processando...",
    modalEmptyFrames: "✕ Frames vazios — preview falhou",
    modalErrorTitle: "✕ Erro",
    modalCopyError: "📋 Copiar erro",
    modalRetry: "↺ Tentar novamente",
    modalGenerate: "▶ GERAR PREVIEW",
    modalViewSingle: "Frame único",
    modalViewFullscreen: "Tela cheia",
    modalViewZoom: "Zoom 1:1",

    // App toasts / addLog
    toastDone: (name) => `Concluído: ${name}`,
    toastError: (name) => `Erro: ${name}`,
    toastSession: (n, gb) => `Sessão concluída · ${n} arquivo(s) · ${gb} GB liberados`,
    logFolder: (p) => `Pasta: ${p}`,
    logScanning: "Analisando arquivos (scan paralelo)...",
    logScanResult: (total, q, skip) => `${total} arquivos — ${q} na fila | ${skip} ignorados`,
    logSessionDone: (conv, err, gb) => `Concluído — Convertidos: ${conv} | Erros: ${err} | Ganho: ${gb} GB`,

    // Locale for toLocaleTimeString
    locale: "pt-BR",
  },

  en: {
    // Header / status
    appName: "NVENC ANIME",
    appVersion: "H.265 CONVERTER v1.3",
    statusConverting: "CONVERTING",
    statusScanning: "SCANNING",
    statusReady: "READY",

    // Sidebar sections
    sectionEncoder: "ENCODER",
    sectionProfile: "PROFILE",
    sectionInputFolder: "INPUT FOLDER",
    sectionOutputFolder: "OUTPUT FOLDER",
    sectionOutputRes: "OUTPUT RESOLUTION",
    sectionJobs: "PARALLEL JOBS",
    sectionPresetCPU: "x265 PRESET",
    sectionPresetNVENC: "NVENC PRESET",
    sectionGPU: "GPU",
    sectionQualitySuffix: "QUALITY",
    sectionOptions: "OPTIONS",

    // Encoder
    cpuWarning: "⚠ Slower, better compression. Use 1 job.",

    // Profiles
    profileAnimeLabel: "🎌 ANIME",
    profileAnimeDesc: "Denoise + debanding",
    profileLiveLabel: "🎬 LIVE ACTION",
    profileLiveDesc: "No filters, grain preserved",

    // Output folder modes
    outputSameLabel: "Same folder",     outputSameDesc: "Next to original",
    outputEncodedLabel: "Subfolder /encoded", outputEncodedDesc: "Created automatically",
    outputCustomLabel: "Custom",        outputCustomDesc: "You choose",
    noOutputFolder: "⚠ No folder selected",

    // Output resolution
    resOriginalLabel: "Keep",     resOriginalDesc: "No downscale",
    res1080Label: "→ 1080p",      res1080Desc: "~60% smaller",
    res720Label: "→ 720p",        res720Desc: "~80% smaller",
    resWarning: "⚠ HEVC files will also be converted.",

    // Jobs
    jobsNoteNVENC: "⚠ Max consumer NVIDIA: 3",
    jobsNoteCPU: "⚠ CPU: 1 job recommended",

    // CQ
    cqHDLabel: "1080p+",
    cqSDLabel: "720p–",
    cqNoteNVENC: "Lower = better quality",
    cqNoteCPU: "Lower = better · scale 1–51",

    // Presets
    presetFaster: "Fastest",    presetFast: "Fast",        presetMedium: "Default",
    presetSlow: "Better",       presetSlower: "Maximum",
    presetNvencP4: "Fast",      presetNvencP5: "Medium",
    presetNvencP6: "Recommended", presetNvencP7: "Slow",

    // Options
    deleteOriginal: "Delete original",

    // Buttons
    btnChangeFolder: "📁 CHANGE FOLDER",
    btnChooseFolder: "📂 CHOOSE FOLDER",
    btnStart: "▶ START",
    btnStop: "⏹ STOP",
    btnRetry: (n) => `↺ RETRY ERRORS (${n})`,
    noFolder: "No folder selected",

    // Status badges
    statusQueue: "QUEUE",  statusEncode: "ENCODE",
    statusDone: "DONE",    statusError: "ERROR",
    statusDoneSkip: "OK",  statusHevcSkip: "HEVC",

    // Stats
    statTotal: "TOTAL",        statConverted: "CONVERTED",
    statEncoding: "ENCODING",  statErrors: "ERRORS",
    statSaved: "SPACE SAVED",
    statFiles: "files",        statSlots: "slots",     statFreed: "freed",
    statConvertedSub: (n) => `of ${n}`,

    // Tabs
    tabFiles: "📋 Files",
    tabLog: "📄 Log",

    // File list
    filterAll: "All",      filterQueue: "Queue",
    filterEncoding: "Encode", filterDone: "Done",    filterErrors: "Errors",
    searchPlaceholder: "Search file...",
    noResults: (q) => `No results for "${q}"`,
    noFiles: "No files",

    // Context menu
    ctxCompare: "Visual compare",
    ctxOpenFolder: "Open folder",
    ctxCopyPath: "Copy path",

    // Log viewer
    logLines: (n) => `${n} lines`,
    logPinned: "📌 PINNED",
    logPin: "PIN",
    logWaiting: "Waiting for conversion to start...",

    // Active slots
    slotEta: "ETA",

    // Scan screen
    scanPhaseProbe: "Reading metadata (parallel)...",
    scanPhaseListing: "Listing files...",
    scanFiles: "files",

    // Empty state
    emptyTitle: "Select a folder to start",
    emptyBtn: "📁 SELECT FOLDER",

    // Comparison modal
    modalTitle: "Visual Comparison",
    modalTimestamp: "Timestamp:",
    modalIdle: 'Adjust the timestamp and click "Generate Preview"',
    modalTimestampAt: (pct, time) => `Timestamp: ${pct}% (${time})`,
    modalProcessing: "Processing...",
    modalEmptyFrames: "✕ Empty frames — preview failed",
    modalErrorTitle: "✕ Error",
    modalCopyError: "📋 Copy error",
    modalRetry: "↺ Try again",
    modalGenerate: "▶ GENERATE PREVIEW",
    modalViewSingle: "Single frame",
    modalViewFullscreen: "Fullscreen",
    modalViewZoom: "Zoom 1:1",

    // App toasts / addLog
    toastDone: (name) => `Done: ${name}`,
    toastError: (name) => `Error: ${name}`,
    toastSession: (n, gb) => `Session done · ${n} file(s) · ${gb} GB freed`,
    logFolder: (p) => `Folder: ${p}`,
    logScanning: "Analyzing files (parallel scan)...",
    logScanResult: (total, q, skip) => `${total} files — ${q} queued | ${skip} skipped`,
    logSessionDone: (conv, err, gb) => `Done — Converted: ${conv} | Errors: ${err} | Saved: ${gb} GB`,

    // Locale for toLocaleTimeString
    locale: "en-US",
  },
};
```

- [ ] **Step 2: Add `LanguageContext`, `LanguageProvider`, `useT`, and `LangToggle` immediately after `TRANSLATIONS`**

```jsx
const LanguageContext = React.createContext();

function LanguageProvider({ children, lang, setLang }) {
  const t = (key) => {
    const val = TRANSLATIONS[lang]?.[key];
    return val !== undefined ? val : key;
  };
  return (
    <LanguageContext.Provider value={{ t, lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

function useT() {
  return React.useContext(LanguageContext);
}

function LangToggle({ lang, onToggle }) {
  const isEN = lang === "en";
  return (
    <button className="btn" onClick={onToggle} style={{
      background: "transparent",
      border: "1px solid var(--border)",
      color: "var(--muted)",
      borderRadius: 5,
      padding: "3px 8px",
      fontSize: 10,
      fontWeight: 700,
      display: "flex",
      alignItems: "center",
      gap: 5,
      letterSpacing: 0.5,
    }}>
      <span style={{ fontSize: 13 }}>{isEN ? "🇺🇸" : "🇧🇷"}</span>
      <span>{isEN ? "EN" : "PT-BR"}</span>
    </button>
  );
}
```

- [ ] **Step 3: Commit infrastructure**

```bash
git add index.html
git commit -m "feat(i18n): add TRANSLATIONS, LanguageContext, useT, LangToggle"
```

---

## Task 3: Wire `LangRoot` + `LanguageProvider`, add toggle to header

**Files:**
- Modify: `index.html`

**Why `LangRoot`:** `App` needs to call `useT()` to access `t()` for its own strings. But if `App` renders `LanguageProvider` in its own return, `App` is NOT a descendant of the provider — so `useT()` would return `undefined`. The fix is a thin `LangRoot` wrapper that holds `lang` state and wraps `<App/>` with `LanguageProvider`. `App` is then a descendant and can call `useT()` freely.

- [ ] **Step 1: Add `LangRoot` component immediately before the `App` function**

```jsx
function LangRoot() {
  const [lang, setLang] = useState("ptBR");
  return (
    <LanguageProvider lang={lang} setLang={setLang}>
      <App />
    </LanguageProvider>
  );
}
```

- [ ] **Step 2: Update the render call at the bottom of the script**

Find:
```js
ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
```

Replace with:
```js
ReactDOM.createRoot(document.getElementById("root")).render(<LangRoot/>);
```

- [ ] **Step 3: Add `useT()` at the top of `App` function body**

`App` is now inside `LanguageProvider` (via `LangRoot`), so `useT()` works here. Add as the very first line of `App`:

```js
function App() {
  const { t, lang, setLang } = useT();
  // ... existing useState declarations follow unchanged
```

- [ ] **Step 4: Initialize `lang` from `config-loaded`**

In the `useEffect` that registers IPC listeners, find the `config-loaded` handler and add `lang` initialization:

```js
window.api.on("config-loaded", (c) => {
  setCfg(prev => ({ ...prev, ...c }));
  if (c.lastFolder)   setFolder(c.lastFolder);
  if (c.outputFolder) setOutputFolder(c.outputFolder);
  if (c.lang)         setLang(c.lang);
});
```

- [ ] **Step 5: Sync `lang` changes to `main.js` via `set-config`**

Add a `useEffect` after the existing `useEffect(()=>{ window.api.setConfig(cfg); },[cfg]);`:

```js
useEffect(() => {
  window.api.setConfig({ ...cfg, lang });
}, [lang]);
```

- [ ] **Step 6: Add `LangToggle` to the header**

Find the header's `WebkitAppRegion: no-drag` div (the one containing the status dot and text). Add `<LangToggle>` before the status dot:

```jsx
<div style={{display:"flex",alignItems:"center",gap:6,WebkitAppRegion:"no-drag"}}>
  <LangToggle lang={lang} onToggle={() => setLang(l => l === "ptBR" ? "en" : "ptBR")} />
  <div style={{width:7,height:7,borderRadius:"50%",
    background:running?"var(--green)":scanning?"var(--yellow)":"var(--muted)",
    boxShadow:running?"0 0 8px var(--green)":"none",
    animation:(running||scanning)?"pulse-dot 2s infinite":"none"}}/>
  <span style={{fontSize:9,letterSpacing:1.5,color:"var(--muted)"}}>
    {running?"CONVERTENDO":scanning?"ANALISANDO":"PRONTO"}
  </span>
</div>
```

Note: the status text still uses hardcoded strings — migrated in Task 7.

- [ ] **Step 7: Start the app and verify the toggle appears in the header and clicking switches the flag/label**

```bash
npm start
```

Click the toggle — flag and text should flip between 🇧🇷 PT-BR and 🇺🇸 EN. Nothing else changes yet.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "feat(i18n): wire LangRoot, LanguageProvider, lang state, toggle in header"
```

---

## Task 4: Migrate `Badge` and `STATUS_META`

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Move `STATUS_META` inside the `Badge` component and use `t()`**

The current module-level `STATUS_META` constant is only used inside `Badge`. Replace both the constant and the component:

```jsx
// DELETE the module-level STATUS_META constant entirely.

function Badge({status}) {
  const { t } = useT();
  const STATUS_META = {
    queue:     {color:"var(--yellow)", label:t("statusQueue"),    icon:"⏳"},
    converting:{color:"var(--accent)", label:t("statusEncode"),   icon:"⚡"},
    done:      {color:"var(--green)",  label:t("statusDone"),     icon:"✓"},
    error:     {color:"var(--accent2)",label:t("statusError"),    icon:"✕"},
    done_skip: {color:"var(--muted)",  label:t("statusDoneSkip"), icon:"–"},
    hevc_skip: {color:"var(--muted)",  label:t("statusHevcSkip"), icon:"–"},
  };
  const m = STATUS_META[status]||STATUS_META.queue;
  return (
    <span style={{
      fontSize:9,fontWeight:800,letterSpacing:1,color:m.color,
      background:`${m.color}14`,border:`1px solid ${m.color}33`,
      borderRadius:4,padding:"2px 7px",
      minWidth:54,textAlign:"center",flexShrink:0,
      display:"inline-flex",alignItems:"center",justifyContent:"center",gap:3}}>
      <span style={{fontSize:10}}>{m.icon}</span>
      {m.label}
    </span>
  );
}
```

- [ ] **Step 2: Start app and verify badge labels still render correctly in PT-BR, then toggle to EN and verify they change**

```bash
npm start
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(i18n): migrate Badge / STATUS_META"
```

---

## Task 5: Migrate `SettingsPanel`

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Delete the module-level `PROFILE_DEFAULTS`, `CPU_PRESETS`, and `NVENC_PRESETS` constants**

These three will be rebuilt inside `SettingsPanel` using `t()`.

- [ ] **Step 2: Replace the `SettingsPanel` function with the fully migrated version**

```jsx
function SettingsPanel({cfg,onChange,onSelectFolder,onSelectOutputFolder,onStart,onStop,onRetry,running,scanning,folder,outputFolder,totalQueue,errorCount}) {
  const { t } = useT();

  function set(k,v){onChange({...cfg,[k]:v});}

  function setProfile(p) {
    const cq = ENCODER_PROFILE_CQ[cfg.encoder||"nvenc"][p];
    onChange({...cfg, profile:p, ...cq});
  }

  function setEncoder(enc) {
    const cq = ENCODER_PROFILE_CQ[enc][cfg.profile||"anime"];
    const preset = enc === "cpu" ? "medium" : "p6";
    onChange({...cfg, encoder:enc, ...cq,
      preset: enc === "nvenc" ? preset : cfg.preset,
      cpuPreset: enc === "cpu" ? preset : cfg.cpuPreset,
    });
  }

  const PROFILE_DEFAULTS = {
    anime:      { label: t("profileAnimeLabel"), desc: t("profileAnimeDesc") },
    liveaction: { label: t("profileLiveLabel"),  desc: t("profileLiveDesc") },
  };

  const CPU_PRESETS = [
    ["faster", t("presetFaster")], ["fast", t("presetFast")],
    ["medium", t("presetMedium")], ["slow",  t("presetSlow")],
    ["slower", t("presetSlower")],
  ];
  const NVENC_PRESETS = [
    ["p4", t("presetNvencP4")], ["p5", t("presetNvencP5")],
    ["p6", t("presetNvencP6")], ["p7", t("presetNvencP7")],
  ];

  const disabled  = running||scanning;
  const isCPU     = (cfg.encoder||"nvenc") === "cpu";
  const presets   = isCPU ? CPU_PRESETS : NVENC_PRESETS;
  const presetKey = isCPU ? "cpuPreset" : "preset";
  const cqLabel   = isCPU ? "CRF" : "CQ";
  const cqNote    = isCPU ? t("cqNoteCPU") : t("cqNoteNVENC");

  const optionBtn = (active, onClick, label, desc, dis=disabled) => (
    <button className="btn" onClick={()=>!dis&&onClick()} disabled={dis} style={{
      width:"100%",textAlign:"left",padding:"5px 8px",borderRadius:5,
      background:active?"#00e5ff0f":"transparent",border:"none",
      color:active?"var(--accent)":"var(--muted)",
      borderLeft:`2px solid ${active?"var(--accent)":"transparent"}`,
      display:"flex",justifyContent:"space-between",fontSize:11,fontWeight:700}}>
      <span>{label}</span>
      {desc&&<span style={{fontWeight:400,fontSize:9,color:active?"var(--accent)":"var(--muted2)"}}>{desc}</span>}
    </button>
  );

  return (
    <div style={{width:216,borderRight:"1px solid var(--border)",background:"var(--panel2)",
      display:"flex",flexDirection:"column",overflow:"hidden"}}>

      <div style={{padding:"14px 16px 10px",borderBottom:"1px solid var(--border)"}}>
        <div style={{fontSize:11,fontWeight:800,color:"var(--accent)",letterSpacing:3}}>{t("appName")}</div>
        <div style={{fontSize:9,color:"var(--muted)",letterSpacing:1.5}}>{t("appVersion")}</div>
      </div>

      <div style={{flex:1,overflowY:"auto",padding:"4px 14px 14px",display:"flex",flexDirection:"column",gap:0}}>

        <SideSection title={t("sectionEncoder")}>
          <div style={{display:"flex",gap:4,marginBottom:4,marginTop:2}}>
            {[["nvenc","⚡ GPU","NVENC"],["cpu","🖥 CPU","x265"]].map(([enc,icon,sub])=>{
              const active=(cfg.encoder||"nvenc")===enc;
              return (
                <button key={enc} className="btn" onClick={()=>!disabled&&setEncoder(enc)} disabled={disabled} style={{
                  flex:1,padding:"7px 4px",borderRadius:6,
                  background:active?"#00e5ff18":"#05090f",
                  border:`1px solid ${active?"var(--accent)":"var(--border)"}`,
                  color:active?"var(--accent)":"var(--muted)",
                  display:"flex",flexDirection:"column",alignItems:"center",gap:1}}>
                  <span style={{fontSize:12,fontWeight:800}}>{icon}</span>
                  <span style={{fontSize:8,letterSpacing:1}}>{sub}</span>
                </button>
              );
            })}
          </div>
          {isCPU && <div style={{fontSize:9,color:"var(--yellow)",lineHeight:1.6,
            background:"#ffd74009",border:"1px solid #ffd74022",
            borderRadius:5,padding:"5px 8px"}}>
            {t("cpuWarning")}
          </div>}
        </SideSection>

        <SideSection title={t("sectionProfile")}>
          {Object.entries(PROFILE_DEFAULTS).map(([key,def])=>
            optionBtn((cfg.profile||"anime")===key, ()=>setProfile(key), def.label, def.desc)
          )}
        </SideSection>

        <SideSection title={t("sectionInputFolder")}>
          <div style={{background:"#05090f",border:"1px solid var(--border)",borderRadius:6,
            padding:"5px 8px",fontSize:9,color:folder?"var(--text)":"var(--muted)",
            wordBreak:"break-all",lineHeight:1.6,minHeight:32,marginTop:2}}>
            {folder||t("noFolder")}
          </div>
          <button className="btn" onClick={onSelectFolder} disabled={disabled} style={{
            width:"100%",marginTop:4,background:"var(--border)",border:"1px solid var(--border2)",
            color:"var(--muted)",borderRadius:6,padding:"6px 0",fontSize:10,fontWeight:700,letterSpacing:1}}>
            {t("btnChangeFolder")}
          </button>
        </SideSection>

        <SideSection title={t("sectionOutputFolder")} defaultOpen={false}>
          {[
            ["same",    t("outputSameLabel"),    t("outputSameDesc")],
            ["encoded", t("outputEncodedLabel"), t("outputEncodedDesc")],
            ["custom",  t("outputCustomLabel"),  t("outputCustomDesc")],
          ].map(([mode,label,desc])=>optionBtn(cfg.outputMode===mode, ()=>set("outputMode",mode), label, desc))}
          {cfg.outputMode==="custom" && (
            <div style={{marginTop:4}}>
              <div style={{background:"#05090f",border:"1px solid var(--border)",borderRadius:6,
                padding:"5px 8px",fontSize:9,lineHeight:1.5,minHeight:30,marginBottom:4,
                color:outputFolder?"var(--text)":"var(--accent2)",wordBreak:"break-all"}}>
                {outputFolder||t("noOutputFolder")}
              </div>
              <button className="btn" onClick={onSelectOutputFolder} disabled={disabled} style={{
                width:"100%",background:"var(--border)",border:"1px solid var(--border2)",
                color:"var(--muted)",borderRadius:6,padding:"5px 0",fontSize:10,fontWeight:700,letterSpacing:1}}>
                {t("btnChooseFolder")}
              </button>
            </div>
          )}
        </SideSection>

        <SideSection title={t("sectionOutputRes")} defaultOpen={false}>
          {[
            ["original", t("resOriginalLabel"), t("resOriginalDesc")],
            ["1080p",    t("res1080Label"),     t("res1080Desc")],
            ["720p",     t("res720Label"),      t("res720Desc")],
          ].map(([res,label,desc])=>optionBtn((cfg.outputRes||"original")===res, ()=>set("outputRes",res), label, desc))}
          {(cfg.outputRes||"original")!=="original" && (
            <div style={{fontSize:9,color:"var(--yellow)",lineHeight:1.6,
              background:"#ffd74009",border:"1px solid #ffd74022",
              borderRadius:5,padding:"5px 8px",marginTop:2}}>
              {t("resWarning")}
            </div>
          )}
        </SideSection>

        <SideSection title={t("sectionJobs")}>
          <div style={{display:"flex",gap:5,marginTop:2,marginBottom:4}}>
            {[1,2,3].map(n=>(
              <button key={n} className="btn" onClick={()=>set("jobs",n)} disabled={running} style={{
                flex:1,padding:"8px 0",borderRadius:6,fontSize:14,fontWeight:800,
                background:cfg.jobs===n?"#00e5ff18":"#05090f",
                border:`1px solid ${cfg.jobs===n?"var(--accent)":"var(--border)"}`,
                color:cfg.jobs===n?"var(--accent)":"var(--muted)"}}>
                {n}
              </button>
            ))}
          </div>
          <div style={{fontSize:9,color:"var(--muted)"}}>
            {isCPU ? t("jobsNoteCPU") : t("jobsNoteNVENC")}
          </div>
        </SideSection>

        <SideSection title={isCPU ? t("sectionPresetCPU") : t("sectionPresetNVENC")} defaultOpen={false}>
          {presets.map(([p,desc])=>optionBtn(cfg[presetKey]===p, ()=>set(presetKey,p), p, desc, running))}
        </SideSection>

        {!isCPU && (
          <SideSection title={t("sectionGPU")} defaultOpen={false}>
            {[0,1].map(g=>optionBtn(cfg.gpu===g, ()=>set("gpu",g), `GPU ${g}`, null, running))}
          </SideSection>
        )}

        <SideSection title={`${cqLabel} (${t("sectionQualitySuffix")})`}>
          {[[`cqHD`, t("cqHDLabel")],[`cqSD`, t("cqSDLabel")]].map(([key,lbl])=>(
            <div key={key} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"2px 0"}}>
              <span style={{fontSize:10,color:"var(--muted)"}}>{lbl}</span>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <button className="btn" onClick={()=>set(key,Math.max(1,cfg[key]-1))} disabled={disabled}
                  style={{background:"var(--border2)",border:"none",color:"var(--text)",
                    borderRadius:4,width:22,height:22,fontSize:14,lineHeight:1}}>−</button>
                <span style={{fontSize:14,fontWeight:800,color:"var(--accent)",minWidth:24,textAlign:"center"}}>{cfg[key]}</span>
                <button className="btn" onClick={()=>set(key,Math.min(51,cfg[key]+1))} disabled={disabled}
                  style={{background:"var(--border2)",border:"none",color:"var(--text)",
                    borderRadius:4,width:22,height:22,fontSize:14,lineHeight:1}}>+</button>
              </div>
            </div>
          ))}
          <div style={{fontSize:9,color:"var(--muted)",marginTop:2}}>{cqNote}</div>
        </SideSection>

        <SideSection title={t("sectionOptions")} defaultOpen={false}>
          <label style={{display:"flex",alignItems:"center",gap:8,cursor:disabled?"default":"pointer",padding:"3px 0"}}>
            <div onClick={()=>!disabled&&set("deletarOriginal",!cfg.deletarOriginal)} style={{
              width:30,height:16,borderRadius:99,
              background:cfg.deletarOriginal?"var(--accent2)":"var(--muted2)",
              position:"relative",transition:"all .2s",cursor:disabled?"default":"pointer",
              flexShrink:0,opacity:disabled?.5:1}}>
              <div style={{position:"absolute",top:2,left:cfg.deletarOriginal?15:2,
                width:12,height:12,borderRadius:"50%",background:"white",transition:"left .15s"}}/>
            </div>
            <span style={{fontSize:10,color:"var(--muted)"}}>{t("deleteOriginal")}</span>
          </label>
        </SideSection>

      </div>

      {/* Action buttons */}
      <div style={{padding:12,borderTop:"1px solid var(--border)",display:"flex",flexDirection:"column",gap:6}}>
        {errorCount > 0 && !running && (
          <button className="btn" onClick={onRetry} style={{
            width:"100%",padding:"8px 0",
            background:"#ff408118",border:"1px solid var(--accent2)",
            color:"var(--accent2)",borderRadius:7,fontSize:11,fontWeight:800,letterSpacing:1.5}}>
            {t("btnRetry")(errorCount)}
          </button>
        )}
        {!running ? (
          <button className="btn" onClick={onStart}
            disabled={!folder||scanning||totalQueue===0} style={{
            width:"100%",padding:"11px 0",
            background:"#00e5ff18",border:"1px solid var(--accent)",
            color:"var(--accent)",borderRadius:7,fontSize:12,fontWeight:800,letterSpacing:2}}>
            {t("btnStart")}
          </button>
        ) : (
          <button className="btn" onClick={onStop} style={{
            width:"100%",padding:"11px 0",
            background:"#ff408118",border:"1px solid var(--accent2)",
            color:"var(--accent2)",borderRadius:7,fontSize:12,fontWeight:800,letterSpacing:2}}>
            {t("btnStop")}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Start app, toggle language, verify SettingsPanel labels switch**

```bash
npm start
```

Toggle PT-BR ↔ EN. Section titles, buttons, profile descriptions, preset labels, warnings should all switch.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(i18n): migrate SettingsPanel"
```

---

## Task 6: Migrate `FileList`

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Replace the `FileList` function with the migrated version**

```jsx
function FileList({files, filter, setFilter}) {
  const { t } = useT();
  const [search,  setSearch]  = useState("");
  const [ctxMenu, setCtxMenu] = useState(null);

  const counts = useMemo(()=>({
    all:       files.filter(f=>!["done_skip","hevc_skip"].includes(f.status)).length,
    queue:     files.filter(f=>f.status==="queue").length,
    converting:files.filter(f=>f.status==="converting").length,
    done:      files.filter(f=>f.status==="done").length,
    error:     files.filter(f=>f.status==="error").length,
  }),[files]);

  const filtered = useMemo(()=>{
    let list = files.filter(f=>!["done_skip","hevc_skip"].includes(f.status));
    if (filter!=="all") list = list.filter(f=>f.status===filter);
    if (search.trim())  list = list.filter(f=>f.name.toLowerCase().includes(search.toLowerCase()));
    return list;
  },[files,filter,search]);

  const FILTER_META = {
    all:       {label:t("filterAll"),      color:"var(--text)"},
    queue:     {label:t("filterQueue"),    color:"var(--yellow)"},
    converting:{label:t("filterEncoding"), color:"var(--accent)"},
    done:      {label:t("filterDone"),     color:"var(--green)"},
    error:     {label:t("filterErrors"),   color:"var(--accent2)"},
  };

  function openCtx(e,file){
    e.preventDefault();
    setCtxMenu({x:e.clientX,y:e.clientY,file});
  }

  function ctxItems(file){
    return [
      {icon:"🔍",label:t("ctxCompare"),    action:()=>window.openPreviewModal?.(file)},
      {icon:"📂",label:t("ctxOpenFolder"), action:()=>window.api?.openPath?.(file.dir)},
      {icon:"📋",label:t("ctxCopyPath"),   action:()=>navigator.clipboard.writeText(file.fullPath)},
    ];
  }

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* Toolbar */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 14px",
        borderBottom:"1px solid var(--border)"}}>
        <div style={{display:"flex",gap:3,flex:1,flexWrap:"wrap"}}>
          {Object.entries(FILTER_META).map(([id,meta])=>{
            const active = filter===id;
            const count  = counts[id];
            return (
              <button key={id} className="btn" onClick={()=>setFilter(id)} style={{
                padding:"4px 9px",borderRadius:5,fontSize:10,fontWeight:700,
                background:active?`${meta.color}18`:"transparent",
                border:`1px solid ${active?meta.color:"transparent"}`,
                color:active?meta.color:"var(--muted)",
                display:"flex",alignItems:"center",gap:5}}>
                {meta.label}
                <span style={{
                  background:active?`${meta.color}22`:"var(--muted2)",
                  color:active?meta.color:"var(--muted)",
                  borderRadius:99,padding:"1px 6px",fontSize:9,fontWeight:800,minWidth:18,textAlign:"center"}}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <div style={{position:"relative"}}>
          <span style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",
            fontSize:11,color:"var(--muted)",pointerEvents:"none"}}>🔍</span>
          <input
            value={search} onChange={e=>setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            style={{background:"#05090f",border:"1px solid var(--border)",borderRadius:6,
              padding:"5px 8px 5px 26px",color:"var(--text)",fontSize:10,
              fontFamily:"var(--mono)",width:180,outline:"none"}}
          />
          {search && (
            <button className="btn" onClick={()=>setSearch("")}
              style={{position:"absolute",right:6,top:"50%",transform:"translateY(-50%)",
                background:"none",border:"none",color:"var(--muted)",fontSize:12,padding:0}}>
              ✕
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div style={{flex:1,overflowY:"auto",padding:"5px 8px"}}
        onClick={()=>setCtxMenu(null)}>
        {filtered.length===0 && (
          <div style={{textAlign:"center",color:"var(--muted)",fontSize:11,padding:40}}>
            {search ? t("noResults")(search) : t("noFiles")}
          </div>
        )}
        {filtered.map((f,i)=>(
          <div key={f.fullPath||i} className="file-row"
            onContextMenu={e=>openCtx(e,f)}
            style={{
              background:f.status==="converting"?"#00e5ff07":
                         f.status==="error"?"#ff408107":
                         f.status==="done"?"#00e67605":"transparent",
              borderColor:f.status==="converting"?"#00e5ff1a":
                          f.status==="error"?"#ff40811a":
                          f.status==="done"?"#00e67618":"transparent"}}>
            <Badge status={f.status}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:10,
                color:f.status==="error"?"var(--accent2)":
                      f.status==="done"?"var(--text)":"var(--text)",
                whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",
                marginBottom:f.status==="converting"?5:0}}>
                {f.name}
              </div>
              {f.status==="converting" && <ProgressBar pct={f.progress||0} height={4} glow/>}
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center",flexShrink:0,fontSize:10}}>
              {f.status==="done"&&f.mb2!=null ? (
                <>
                  <span style={{color:"var(--muted)",fontSize:9}}>{f.mb1} MB</span>
                  <span style={{color:"var(--muted)"}}>→</span>
                  <span style={{color:"var(--green)",fontWeight:700}}>{f.mb2} MB</span>
                  <span style={{color:"var(--green)",fontWeight:800,
                    background:"#00e67614",border:"1px solid #00e67630",
                    borderRadius:4,padding:"1px 6px",fontSize:9}}>
                    -{f.reducao}%
                  </span>
                </>
              ) : f.status==="converting" ? (
                <span style={{color:"var(--accent)",fontSize:9}}>{t("slotEta")} {f.eta||"--:--"}</span>
              ) : (
                <span style={{color:"var(--muted)",fontSize:9}}>
                  {f.size?(f.size/1048576).toFixed(1)+" MB":""}
                </span>
              )}
              <span style={{color:"var(--muted2)",fontSize:9}}>CQ{f.cq||"?"}</span>
            </div>
          </div>
        ))}
      </div>

      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          items={ctxItems(ctxMenu.file)}
          onClose={()=>setCtxMenu(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Start app, toggle language, verify FileList labels and empty state switch**

```bash
npm start
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(i18n): migrate FileList"
```

---

## Task 7: Migrate `LogViewer`, `ActiveSlots`, `ScanScreen`, `EmptyState`, header status text

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Replace `LogViewer`**

```jsx
function LogViewer({logs}) {
  const { t } = useT();
  const ref = useRef(null);
  const [pinned, setPinned] = useState(true);
  const LVL = {OK:"var(--green)",ERRO:"var(--accent2)",AVISO:"var(--yellow)",DEBUG:"var(--muted)",INFO:"var(--text)"};

  useEffect(()=>{
    if (pinned && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  },[logs,pinned]);

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{display:"flex",justifyContent:"flex-end",alignItems:"center",
        padding:"5px 14px",borderBottom:"1px solid var(--border)",gap:8}}>
        <span style={{fontSize:9,color:"var(--muted)"}}>{t("logLines")(logs.length)}</span>
        <button className="btn" onClick={()=>setPinned(p=>!p)} style={{
          background:pinned?"#00e5ff18":"transparent",
          border:`1px solid ${pinned?"var(--accent)":"var(--border)"}`,
          color:pinned?"var(--accent)":"var(--muted)",
          borderRadius:5,padding:"3px 8px",fontSize:9,fontWeight:700}}>
          {pinned ? t("logPinned") : t("logPin")}
        </button>
      </div>
      <div ref={ref} onScroll={e=>{
        const el=e.target;
        const atBottom=el.scrollHeight-el.scrollTop-el.clientHeight<20;
        setPinned(atBottom);
      }} style={{flex:1,overflowY:"auto",padding:"8px 14px",fontSize:11}}>
        {logs.map((l,i)=>(
          <div key={i} className="log-entry"
            style={{display:"flex",gap:8,marginBottom:2,lineHeight:1.7}}>
            <span style={{color:"var(--muted)",flexShrink:0,fontSize:10}}>{l.t}</span>
            <span style={{color:LVL[l.lvl]||"var(--text)",fontWeight:700,
              flexShrink:0,minWidth:38,fontSize:10,letterSpacing:.5}}>
              [{l.lvl}]
            </span>
            <span style={{color:"var(--text)"}}>{l.msg}</span>
          </div>
        ))}
        {logs.length===0&&(
          <div style={{color:"var(--muted)",fontSize:11,marginTop:16}}>
            {t("logWaiting")}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace `ActiveSlots`**

```jsx
function ActiveSlots({slots, totalConversoes}) {
  const { t } = useT();
  const active = Object.values(slots).filter(s=>s.name);
  if (active.length===0) return null;
  return (
    <div style={{borderBottom:"1px solid var(--border)",padding:"10px 14px",
      background:"#0b1219",display:"flex",gap:10}}>
      {active.map(slot=>(
        <div key={slot.slotId} style={{flex:1,background:"var(--panel)",
          border:"1px solid #00e5ff22",borderRadius:9,padding:"11px 13px",
          boxShadow:"0 0 24px #00e5ff08"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
            <div style={{fontSize:9,color:"var(--accent)",letterSpacing:2,fontWeight:800,display:"flex",alignItems:"center",gap:6}}>
              <span style={{width:6,height:6,borderRadius:"50%",background:"var(--accent)",
                display:"inline-block",boxShadow:"0 0 6px var(--accent)",
                animation:"pulse-dot 2s infinite"}}/>
              SLOT {slot.slotId}
              <span style={{color:"var(--muted)",fontWeight:400}}>{slot.id}/{totalConversoes}</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              {slot.fps    && <span style={{fontSize:9,color:"#7ecfff"}}>{slot.fps}</span>}
              {slot.speed  && <span style={{fontSize:9,color:"var(--yellow)",fontWeight:700}}>{slot.speed}</span>}
              {slot.bitrate&& <span style={{fontSize:9,color:"var(--muted)"}}>{slot.bitrate}</span>}
              <span style={{fontSize:9,color:"var(--muted)"}}>{t("slotEta")} {slot.eta||"--:--"}</span>
            </div>
          </div>
          <div style={{fontSize:10,color:"var(--text)",marginBottom:7,
            whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
            {slot.name}
          </div>
          <ProgressBar pct={slot.progress||0} glow height={6}/>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:5}}>
            <span style={{fontSize:9,color:"var(--muted)"}}>CQ {slot.cq}</span>
            <span style={{fontSize:10,color:"var(--accent)",fontWeight:800}}>{slot.progress||0}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Replace `ScanScreen`**

```jsx
function ScanScreen({scanProg}) {
  const { t } = useT();
  const pct = scanProg && scanProg.total > 0
    ? Math.round(scanProg.scanned / scanProg.total * 100) : 0;
  const phase = scanProg?.phase === "probe" ? t("scanPhaseProbe") : t("scanPhaseListing");

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",
      alignItems:"center",justifyContent:"center",gap:16,color:"var(--muted)"}}>
      <div style={{fontSize:32,opacity:.3}}>🔍</div>
      <div style={{fontSize:13,fontWeight:700,color:"var(--muted)"}}>{phase}</div>
      {scanProg && (
        <>
          <div style={{width:280}}>
            <ProgressBar pct={pct} glow/>
          </div>
          <div style={{fontSize:11,color:"var(--muted)"}}>
            {scanProg.scanned} / {scanProg.total} {t("scanFiles")} · {pct}%
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Replace `EmptyState`**

```jsx
function EmptyState({onSelect}) {
  const { t } = useT();
  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",
      alignItems:"center",justifyContent:"center",gap:14,color:"var(--muted)"}}>
      <div style={{fontSize:44,opacity:.25}}>🎌</div>
      <div style={{fontSize:13,fontWeight:700}}>{t("emptyTitle")}</div>
      <button className="btn" onClick={onSelect} style={{
        background:"#00e5ff18",border:"1px solid var(--accent)",color:"var(--accent)",
        borderRadius:8,padding:"9px 22px",fontSize:12,fontWeight:700,letterSpacing:1.5}}>
        {t("emptyBtn")}
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Migrate header status text and tabs in `App`**

In the `App` return JSX, find the status dot section and tabs. Replace hardcoded strings:

```jsx
{/* Status text — inside the no-drag div, after LangToggle */}
<span style={{fontSize:9,letterSpacing:1.5,color:"var(--muted)"}}>
  {running ? t("statusConverting") : scanning ? t("statusScanning") : t("statusReady")}
</span>

{/* Tabs */}
{[["files", t("tabFiles")], ["log", t("tabLog")]].map(([id, lbl]) => (
  <button key={id} className="btn" onClick={() => setTab(id)} style={{
    padding:"8px 13px",fontSize:11,background:"transparent",border:"none",
    fontWeight:tab===id?700:400,
    color:tab===id?"var(--accent)":"var(--muted)",
    borderBottom:`2px solid ${tab===id?"var(--accent)":"transparent"}`,
    transition:"all .15s"}}>
    {lbl}
  </button>
))}
```

- [ ] **Step 6: Migrate `StatCard` calls in `App` JSX**

Find the stats section and replace hardcoded label strings:

```jsx
<StatCard label={t("statTotal")}     value={totalConversoes}       sub={t("statFiles")}/>
<StatCard label={t("statConverted")} value={stats.done}            sub={t("statConvertedSub")(totalConversoes)} color="var(--green)"/>
<StatCard label={t("statEncoding")}  value={stats.active}          sub={t("statSlots")} color="var(--accent)"/>
<StatCard label={t("statErrors")}    value={stats.errors}          sub={t("statFiles")} color={stats.errors>0?"var(--accent2)":"var(--muted)"}/>
<StatCard label={t("statSaved")}     value={`${stats.ganhoGB} GB`} sub={t("statFreed")} color="var(--yellow)"/>
```

Note: `StatCard` itself doesn't need `useT()` — it just renders whatever `label`, `value`, `sub` props it receives.

- [ ] **Step 7: Start app, toggle language, verify all above components switch**

```bash
npm start
```

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "feat(i18n): migrate LogViewer, ActiveSlots, ScanScreen, EmptyState, stats, tabs"
```

---

## Task 8: Migrate `ComparisonModal`

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Replace `ComparisonModal` with the migrated version**

```jsx
function ComparisonModal({ file, config, onClose }) {
  const { t } = useT();
  const [viewMode, setViewMode] = useState("single");
  const [timestamp, setTimestamp] = useState(30);
  const { state, progress, frames, error, generate, reset } = useComparison();

  const duracao = file?.duracao || 0;
  const timestampSec = duracao > 0 ? duracao * timestamp / 100 : 0;
  const timestampLabel = formatTime(timestampSec);

  function formatTime(sec) {
    if (!sec || sec <= 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function handleGenerate() {
    if (!file?.fullPath) return;
    generate(file.fullPath, timestamp / 100, config);
  }

  function handleClose() {
    reset();
    onClose();
  }

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,0.85)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 2000,
      animation: "fade-in .15s ease",
    }}>
      <div style={{
        background: "var(--panel)",
        border: "1px solid var(--border2)",
        borderRadius: 12,
        width: viewMode === "fullscreen" ? "90vw" : "700px",
        maxHeight: viewMode === "fullscreen" ? "90vh" : "85vh",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
        boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 16px", borderBottom: "1px solid var(--border)",
          background: "var(--panel2)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 16 }}>🔍</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
              {t("modalTitle")}
            </span>
            <span style={{ fontSize: 10, color: "var(--muted)" }}>— {file?.name}</span>
          </div>
          <button className="btn" onClick={handleClose} style={{
            background: "none", border: "none", color: "var(--muted)",
            fontSize: 18, cursor: "pointer", padding: 4,
          }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Timestamp selector */}
          {state !== "done" && (
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 10, color: "var(--muted)", minWidth: 70 }}>{t("modalTimestamp")}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={timestamp}
                onChange={e => setTimestamp(Number(e.target.value))}
                disabled={state === "generating"}
                style={{ flex: 1, accentColor: "var(--accent)" }}
              />
              <span style={{ fontSize: 10, color: "var(--accent)", minWidth: 50, textAlign: "right" }}>
                {timestamp}%
              </span>
              <span style={{ fontSize: 10, color: "var(--muted)", minWidth: 45 }}>
                ({timestampLabel})
              </span>
            </div>
          )}

          {/* Preview area */}
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300 }}>
            {state === "idle" && (
              <div style={{ textAlign: "center", color: "var(--text)", padding: 40 }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
                <div style={{ fontSize: 12, marginBottom: 16 }}>
                  {t("modalIdle")}
                </div>
                <div style={{ fontSize: 10, color: "var(--muted)" }}>
                  {t("modalTimestampAt")(timestamp, timestampLabel)}
                </div>
              </div>
            )}

            {state === "generating" && (
              <div style={{ textAlign: "center", width: "100%", maxWidth: 300 }}>
                <div style={{ fontSize: 11, color: "var(--accent)", marginBottom: 8 }}>
                  {progress.stage || t("modalProcessing")}
                </div>
                <ProgressBar pct={progress.pct || 0} glow />
                <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 6 }}>
                  {progress.pct || 0}%
                </div>
              </div>
            )}

            {state === "done" && frames ? (
              frames.orig && frames.conv ? (
                <ComparisonSlider orig={frames.orig} conv={frames.conv} viewMode={viewMode} />
              ) : (
                <div style={{ color: "var(--accent2)", textAlign: "center", fontSize: 11 }}>
                  {t("modalEmptyFrames")}
                </div>
              )
            ) : null}

            {state === "error" && (
              <div style={{ textAlign: "center", color: "var(--accent2)" }}>
                <div style={{ fontSize: 14, marginBottom: 4 }}>{t("modalErrorTitle")}</div>
                <div style={{ fontSize: 10, color: "var(--muted)", maxWidth: 400, wordBreak: "break-all" }}>{error}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  <button className="btn" onClick={() => navigator.clipboard.writeText(error)} style={{
                    padding: "6px 12px",
                    background: "var(--accent2)22", border: "1px solid var(--accent2)",
                    color: "var(--accent2)", borderRadius: 6, fontSize: 10,
                  }}>{t("modalCopyError")}</button>
                  <button className="btn" onClick={handleGenerate} style={{
                    padding: "6px 12px",
                    background: "var(--accent2)22", border: "1px solid var(--accent2)",
                    color: "var(--accent2)", borderRadius: 6, fontSize: 10,
                  }}>{t("modalRetry")}</button>
                </div>
              </div>
            )}
          </div>

          {/* View mode buttons */}
          {state === "done" && (
            <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
              {[["single", t("modalViewSingle")], ["fullscreen", t("modalViewFullscreen")], ["zoom", t("modalViewZoom")]].map(([m, lbl]) => (
                <button key={m} className="btn" onClick={() => setViewMode(m)} style={{
                  padding: "5px 12px", borderRadius: 5, fontSize: 10, fontWeight: 700,
                  background: viewMode === m ? "var(--accent)22" : "transparent",
                  border: `1px solid ${viewMode === m ? "var(--accent)" : "var(--border)"}`,
                  color: viewMode === m ? "var(--accent)" : "var(--muted)",
                }}>{lbl}</button>
              ))}
            </div>
          )}

          {/* Generate button */}
          {state !== "done" && state !== "generating" && (
            <button className="btn" onClick={handleGenerate} style={{
              padding: "9px 0", borderRadius: 7, fontSize: 11, fontWeight: 800,
              background: "var(--accent)18", border: "1px solid var(--accent)",
              color: "var(--accent)", letterSpacing: 1.5,
            }}>{t("modalGenerate")}</button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Start app, open a file context menu → Comparar visual / Visual compare, verify modal strings switch**

```bash
npm start
```

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(i18n): migrate ComparisonModal"
```

---

## Task 9: Migrate `App` toasts, `addLog` calls, and locale

**Files:**
- Modify: `index.html`

`App` already has `const { t, lang, setLang } = useT();` from Task 3, Step 3. No structural change needed — just migrate the hardcoded strings.

- [ ] **Step 1: Migrate toasts and `addLog` calls in the IPC event handlers**

In the `useEffect` that registers IPC listeners, replace hardcoded strings:

```js
// file-status handler
if (d.status==="done")  addToast(t("toastDone")(d.fullPath?.split(/[\\/]/).pop()), "✓", "var(--green)");
if (d.status==="error") addToast(t("toastError")(d.fullPath?.split(/[\\/]/).pop()), "✕", "var(--accent2)");

// conversion-done handler
addLog({t:new Date().toLocaleTimeString(t("locale"),{hour12:false}),lvl:"OK",
  msg: t("logSessionDone")(d.convertidos, d.erros, d.ganhoGB)});
addToast(t("toastSession")(d.convertidos, d.ganhoGB), "🏁", "var(--accent)");
```

- [ ] **Step 2: Migrate `addLog` calls in `handleSelectFolder`**

```js
async function handleSelectFolder() {
  const p = await window.api.selectFolder();
  if (!p) return;
  setFolder(p); setFiles([]); setLogs([]);
  setStats({done:0,errors:0,active:0,queue:0,ganhoGB:"0.00",globalEta:""});
  setSlots({}); setScanProg(null); setScanning(true);
  addLog({t:now(),lvl:"INFO", msg: t("logFolder")(p)});
  addLog({t:now(),lvl:"INFO", msg: t("logScanning")});
  const result = await window.api.scanFolder(p);
  setFiles(result); setScanning(false); setScanProg(null);
  const q    = result.filter(f=>f.status==="queue").length;
  const skip = result.filter(f=>["done_skip","hevc_skip"].includes(f.status)).length;
  addLog({t:now(),lvl:"INFO", msg: t("logScanResult")(result.length, q, skip)});
}
```

- [ ] **Step 3: Migrate `now()` and `etaHorario()` to use locale from `t()`**

```js
function now() {
  return new Date().toLocaleTimeString(t("locale"), {hour12:false});
}

function etaHorario(etaStr) {
  if (!etaStr) return null;
  const match = etaStr.match(/(\d+)h\s*(\d+)min|(\d+)min\s*(\d+)s|(\d+)s/);
  if (!match) return null;
  let seg = 0;
  if (match[1]) seg = parseInt(match[1])*3600 + parseInt(match[2])*60;
  else if (match[3]) seg = parseInt(match[3])*60 + parseInt(match[4]);
  else if (match[5]) seg = parseInt(match[5]);
  const fim = new Date(Date.now() + seg*1000);
  return fim.toLocaleTimeString(t("locale"), {hour:"2-digit",minute:"2-digit"});
}
```

- [ ] **Step 4: Start the full app, run through the complete flow in both languages**

```bash
npm start
```

- Select a folder → verify scan log appears in PT-BR
- Toggle to EN → select another folder → verify scan log appears in EN
- Start a conversion → verify toasts appear in the active language
- Toggle mid-session → new logs appear in the new language

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(i18n): migrate App toasts, addLog, locale — i18n complete"
```

---

## Task 10: Verify `config.json` persistence

- [ ] **Step 1: Toggle to EN, close the app, reopen**

```bash
npm start
```

Toggle to EN. Close the app window. Reopen with `npm start`. The toggle should show 🇺🇸 EN on startup.

- [ ] **Step 2: Verify `config.json` contains `lang`**

```bash
cat "%APPDATA%/nvenc-anime-gui/config.json"
```

Expected: a JSON object containing `"lang": "en"`.

- [ ] **Step 3: Done — all tasks complete**

