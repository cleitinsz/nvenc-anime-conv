# i18n Language Toggle — Design Spec

**Date:** 2026-04-26  
**Status:** Approved  

## Summary

Add a PT-BR ↔ EN language toggle to the app. The toggle lives in the header, shows a flag + language code, persists the preference in `config.json`, and covers all UI strings and log strings.

---

## 1. Translation Dictionaries

A `TRANSLATIONS` object is added at the top of the `<script>` block in `index.html`, before any component definitions:

```js
const TRANSLATIONS = {
  ptBR: { /* all PT-BR strings */ },
  en:   { /* all EN strings */ },
};
```

Covers all string categories:
- UI labels: section titles, button labels, option labels, descriptions
- Status badges: `STATUS_META` labels
- File list filter labels
- Stats card labels
- Log messages generated in the renderer (toasts, `addLog` calls)
- Empty/loading state messages
- Modal labels (Comparison Modal, scan screen)

`main.js` gets its own small `LOG_STRINGS` object with only the strings it generates directly via IPC `log` events.

---

## 2. React Language Context

```js
const LanguageContext = React.createContext();

function LanguageProvider({ children, lang, setLang }) {
  const t = (key) => TRANSLATIONS[lang]?.[key] ?? key;
  return (
    <LanguageContext.Provider value={{ t, lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

function useT() {
  return React.useContext(LanguageContext);
}
```

`LanguageProvider` wraps the `<App />` at the root. `lang` state lives in `App` (same level as `cfg`), initialized from `config-loaded` IPC event.

---

## 3. Toggle Component

```jsx
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

**Placement:** Header, right side, inside the `WebkitAppRegion: no-drag` div, before the status dot.

**Behavior:**
- Click toggles `lang` between `"ptBR"` and `"en"`
- State change propagates via `LanguageContext` → all components re-render with new strings
- Toggle also calls `onChange({ ...cfg, lang })` so the new value is sent to `main.js` via the existing `set-config` IPC channel

---

## 4. Persistence

- `lang` is added to the `config` object in `main.js` with default `"ptBR"`
- `loadConfig()` includes `lang: "ptBR"` in defaults
- `saveConfig()` persists it automatically (no changes needed — saves the whole object)
- On app start, `config-loaded` IPC event delivers `lang` to the renderer; `App` initializes `lang` state from it

---

## 5. `main.js` Log Strings

A `LOG_STRINGS` object in `main.js`:

```js
const LOG_STRINGS = {
  ptBR: {
    scanning: "Analisando arquivos (scan paralelo)...",
    done: "Concluído",
    // ... other log strings main.js generates
  },
  en: {
    scanning: "Analyzing files (parallel scan)...",
    done: "Completed",
    // ...
  },
};
```

`main.js` reads `config.lang` when building log messages. When `set-config` arrives with a new `lang`, `config.lang` updates immediately.

---

## 6. Component Migration Pattern

Every component that renders a hardcoded string:
1. Calls `const { t } = useT();` at the top
2. Replaces string literals with `t("key")`

Example:
```jsx
// Before
<span>PASTA DE ENTRADA</span>

// After
const { t } = useT();
<span>{t("inputFolder")}</span>
```

`STATUS_META` and `PROFILE_DEFAULTS` objects (currently module-level constants) become functions of `t` called inside components, or are rebuilt on render using `t`.

---

## 7. Files Changed

| File | Change |
|---|---|
| `index.html` | Add `TRANSLATIONS`, `LanguageContext`, `useT`, `LangToggle`; migrate all string literals; wrap root with `LanguageProvider` |
| `main.js` | Add `LOG_STRINGS`; add `lang: "ptBR"` to config defaults; use `LOG_STRINGS[config.lang]` in log output |

No new files. No new dependencies.

---

## 8. Out of Scope

- More than two languages
- RTL support
- Automatic locale detection (always defaults to PT-BR)
- Translating ffmpeg error output (comes from ffmpeg binary, not our code)
