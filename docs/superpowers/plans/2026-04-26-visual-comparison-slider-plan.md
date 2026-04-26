# Visual Comparison Slider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add before/after visual comparison slider for video encoding preview, allowing users to validate filter impact and quality before committing to full encode.

**Architecture:** Preview generation runs as isolated background process using FFmpeg — generates 10s excerpt with same encode config as main conversion, extracts original and converted frames at user-selected timestamp, displays with draggable slider. Non-blocking — does not consume conversion job slots.

**Tech Stack:** Electron IPC (main↔renderer), React 18 (inline), FFmpeg (frame extraction + excerpt generation), CSS clip-path for slider divider.

---

## File Map

| File | Role |
|---|---|
| `main.js:536` | Add IPC handlers for preview-generate, cleanup temp files |
| `preload.js` | Add `preview-generate`, `preview-progress`, `preview-done`, `preview-error` bridges |
| `index.html` | Add ComparisonModal, ComparisonSlider, TimestampSelector, ViewModeToggle, useComparison hook, context menu item |

---

## Task 1: Add preview IPC handlers in main.js

**Files:**
- Modify: `main.js` (at end of file, before closing)

- [ ] **Step 1: Write the failing test — no test for IPC handlers (integration level)**

Skip unit test for IPC handlers — tested via integration.

- [ ] **Step 2: Add preview IPC handlers at end of main.js**

Add this after the existing IPC handlers (around line 535):

```javascript
// ============================================================
//  PREVIEW GENERATION — visual comparison before/after
// ============================================================

const PREVIEW_TMP = os.tmpdir();

ipcMain.handle("preview-generate", async (event, { fullPath, timestampPct, config }) => {
  const id       = Date.now();
  const origPath = path.join(PREVIEW_TMP, `preview_orig_${id}.png`);
  const convPath = path.join(PREVIEW_TMP, `preview_conv_${id}.png`);
  const excerptPath = path.join(PREVIEW_TMP, `preview_${id}.mkv`);

  function sendProgress(stage, pct) {
    mainWindow?.webContents.send("preview-progress", { stage, pct });
  }

  try {
    // Get video duration via ffprobe
    const meta = await ffprobeAll(fullPath);
    const duracao = meta.duracao || 0;
    const timestampSec = duracao > 0 ? duracao * timestampPct : 0;

    sendProgress("Extraindo frame original...", 10);

    // Extract original frame at timestamp
    await new Promise((resolve, reject) => {
      const args = [
        "-ss", String(timestampSec),
        "-i", fullPath,
        "-vframes", "1",
        "-q:v", "2",
        origPath
      ];
      const proc = cp.spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      proc.stderr.on("data", d => { stderr += d; });
      proc.on("close", code => code === 0 ? resolve() : reject(new Error(stderr.slice(-200))) );
    });

    sendProgress("Gerando excerpt (10s)...", 30);

    // Build filter chain from config
    const filters = [];
    if (config.profile === "anime") {
      filters.push("hqdn3d=1.2:1.2:5:5", "gradfun");
    }
    const vfArg = filters.length > 0 ? "-vf:" + filters.join(",") : [];

    // Generate 10s excerpt with same encode settings
    const cq = config.encoder === "cpu"
      ? (config.cqHD || 20)
      : (config.cqHD || 28);

    const excerptArgs = [
      "-ss", String(timestampSec),
      "-i", fullPath,
      "-t", "10",
    ];

    if (config.encoder === "cpu") {
      excerptArgs.push(
        "-c:v", "libx265",
        "-preset", config.cpuPreset || "medium",
        "-crf", String(cq),
      );
    } else {
      const preset = config.preset || "p6";
      excerptArgs.push(
        "-c:v", "hevc_nvenc",
        "-preset", preset,
        "-rc", "constqp",
        "-cqp", String(cq),
        "-qmin", String(cq),
        "-qmax", String(cq),
      );
    }

    if (vfArg.length > 0) {
      excerptArgs.push(vfArg);
    }

    excerptArgs.push("-an", excerptPath);

    await new Promise((resolve, reject) => {
      const proc = cp.spawn("ffmpeg", excerptArgs, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      proc.stderr.on("data", d => { stderr += d; });
      proc.on("close", code => code === 0 ? resolve() : reject(new Error(stderr.slice(-200))) );
    });

    sendProgress("Extraindo frame convertido...", 70);

    // Extract frame from middle of excerpt (5s in = middle of 10s)
    await new Promise((resolve, reject) => {
      const args = ["-ss", "5", "-i", excerptPath, "-vframes", "1", "-q:v", "2", convPath];
      const proc = cp.spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      proc.stderr.on("data", d => { stderr += d; });
      proc.on("close", code => code === 0 ? resolve() : reject(new Error(stderr.slice(-200))) );
    });

    sendProgress("Enviando frames...", 90);

    // Read frames as base64
    const fs2 = require("fs");
    const frameOrigBase64 = fs2.readFileSync(origPath).toString("base64");
    const frameConvBase64 = fs2.readFileSync(convPath).toString("base64");

    // Cleanup temp files
    try { fs2.unlinkSync(origPath); } catch {}
    try { fs2.unlinkSync(convPath); } catch {}
    try { fs2.unlinkSync(excerptPath); } catch {}

    sendProgress("Concluído", 100);

    return { frameOrig: frameOrigBase64, frameConv: frameConvBase64 };
  } catch (err) {
    // Cleanup on error
    try { require("fs").unlinkSync(origPath); } catch {}
    try { require("fs").unlinkSync(convPath); } catch {}
    try { require("fs").unlinkSync(excerptPath); } catch {}

    throw err;
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add main.js
git commit -m "feat(preview): add IPC handler for preview generation"
```

---

## Task 2: Add preview IPC bridges in preload.js

**Files:**
- Modify: `preload.js`

- [ ] **Step 1: Read current preload.js**

```javascript
// Read preload.js to understand current IPC bridge structure
```

- [ ] **Step 2: Add preview channels to preload.js**

Add these to the `window.api` object in preload.js:

```javascript
// Preview generation
onPreviewProgress(callback) { on("preview-progress", callback); },
offPreviewProgress(callback) { off("preview-progress", callback); },
onPreviewDone(callback) { on("preview-done", callback); },
offPreviewDone(callback) { off("preview-done", callback); },
onPreviewError(callback) { on("preview-error", callback); },
offPreviewError(callback) { off("preview-error", callback); },
generatePreview(fullPath, timestampPct, config) {
  return invoke("preview-generate", { fullPath, timestampPct, config });
},
```

- [ ] **Step 3: Commit**

```bash
git add preload.js
git commit -m "feat(preview): add preview IPC bridges to preload"
```

---

## Task 3: Add useComparison hook and ComparisonModal components in index.html

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add useComparison hook inside index.html `<script type="text/babel">`**

Add after the existing hooks (useState, useEffect, useRef, useCallback, useMemo) — right after `const { useState, useEffect, useRef, useCallback, useMemo } = React;`:

```javascript
// ── Comparison hook ──────────────────────────────────────────
function useComparison() {
  const [state, setState]   = useState("idle"); // idle | generating | done | error
  const [progress, setProgress] = useState({ stage: "", pct: 0 });
  const [frames, setFrames]  = useState(null);   // { orig, conv }
  const [error, setError]    = useState(null);

  useEffect(() => {
    function onProgress(p) { setProgress(p); }
    function onDone(f) {
      setFrames(f);
      setState("done");
    }
    function onErr(e) {
      setError(e.message || "Erro desconhecido");
      setState("error");
    }
    window.api.onPreviewProgress(onProgress);
    window.api.onPreviewDone(onDone);
    window.api.onPreviewError(onErr);
    return () => {
      window.api.offPreviewProgress(onProgress);
      window.api.offPreviewDone(onDone);
      window.api.offPreviewError(onErr);
    };
  }, []);

  async function generate(fullPath, timestampPct, config) {
    setState("generating");
    setProgress({ stage: "Iniciando...", pct: 0 });
    setError(null);
    setFrames(null);
    try {
      await window.api.generatePreview(fullPath, timestampPct, config);
    } catch (err) {
      setError(err.message || "Erro desconhecido");
      setState("error");
    }
  }

  function reset() {
    setState("idle");
    setProgress({ stage: "", pct: 0 });
    setFrames(null);
    setError(null);
  }

  return { state, progress, frames, error, generate, reset };
}
```

- [ ] **Step 2: Add ComparisonSlider component**

Add after the ProgressBar component (around line 57):

```javascript
// ── Comparison Slider ─────────────────────────────────────────
function ComparisonSlider({ orig, conv, viewMode }) {
  const [pos, setPos] = useState(50); // percentage 0-100
  const containerRef = useRef(null);
  const dragging = useRef(false);

  function handleMouseDown(e) {
    dragging.current = true;
    updatePos(e);
  }

  function handleMouseMove(e) {
    if (!dragging.current) return;
    updatePos(e);
  }

  function handleMouseUp() {
    dragging.current = false;
  }

  function updatePos(e) {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setPos(pct);
  }

  useEffect(() => {
    function onMove(e) { handleMouseMove(e); }
    function onUp()    { handleMouseUp(); }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const containerStyle = viewMode === "zoom"
    ? { width: "auto", height: "auto", cursor: "ew-resize" }
    : { width: "100%", maxHeight: viewMode === "fullscreen" ? "75vh" : "400px", cursor: "ew-resize" };

  const objectFit = viewMode === "zoom" ? "none" : "contain";

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      style={{
        position: "relative",
        overflow: viewMode === "zoom" ? "auto" : "hidden",
        background: "#000",
        borderRadius: 8,
        userSelect: "none",
        ...containerStyle,
      }}
    >
      {/* Original (left half) */}
      <img
        src={`data:image/png;base64,${orig}`}
        alt="Original"
        style={{
          display: "block",
          width: "100%",
          height: viewMode === "zoom" ? "auto" : "100%",
          objectFit,
          pointerEvents: "none",
        }}
      />

      {/* Converted (right half, clipped) */}
      <div style={{
        position: "absolute",
        top: 0, left: 0, right: 0, bottom: 0,
        clipPath: `inset(0 ${100 - pos}% 0 0)`,
      }}>
        <img
          src={`data:image/png;base64,${conv}`}
          alt="Convertido"
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            objectFit,
            pointerEvents: "none",
          }}
        />
      </div>

      {/* Divider line */}
      <div style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: `${pos}%`,
        width: 3,
        background: "rgba(255,255,255,0.8)",
        transform: "translateX(-50%)",
        boxShadow: "0 0 8px rgba(255,255,255,0.5)",
        pointerEvents: "none",
      }} />

      {/* Handle */}
      <div style={{
        position: "absolute",
        top: "50%",
        left: `${pos}%`,
        transform: "translate(-50%, -50%)",
        width: 32, height: 32,
        background: "rgba(255,255,255,0.9)",
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 14,
        boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
        pointerEvents: "none",
      }}>
        ⬌
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add ComparisonModal component**

Add after LogViewer (around line 628):

```javascript
// ── Comparison Modal ──────────────────────────────────────────
function ComparisonModal({ file, config, onClose }) {
  const [viewMode, setViewMode] = useState("single"); // single | fullscreen | zoom
  const [timestamp, setTimestamp] = useState(30); // percentage 0-100
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
              Comparação Visual
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
              <span style={{ fontSize: 10, color: "var(--muted)", minWidth: 70 }}>Timestamp:</span>
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
              <div style={{ textAlign: "center", color: "var(--muted)" }}>
                <div style={{ fontSize: 40, opacity: 0.3 }}>🔍</div>
                <div style={{ fontSize: 11, marginTop: 8 }}>
                  Ajusta o timestamp e clique em "Gerar Preview"
                </div>
              </div>
            )}

            {state === "generating" && (
              <div style={{ textAlign: "center", width: "100%", maxWidth: 300 }}>
                <div style={{ fontSize: 11, color: "var(--accent)", marginBottom: 8 }}>
                  {progress.stage || "Processando..."}
                </div>
                <ProgressBar pct={progress.pct || 0} glow />
                <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 6 }}>
                  {progress.pct || 0}%
                </div>
              </div>
            )}

            {state === "done" && frames && (
              <ComparisonSlider orig={frames.orig} conv={frames.conv} viewMode={viewMode} />
            )}

            {state === "error" && (
              <div style={{ textAlign: "center", color: "var(--accent2)" }}>
                <div style={{ fontSize: 14, marginBottom: 4 }}>✕ Erro</div>
                <div style={{ fontSize: 10, color: "var(--muted)" }}>{error}</div>
                <button className="btn" onClick={handleGenerate} style={{
                  marginTop: 10, padding: "6px 14px",
                  background: "var(--accent2)22", border: "1px solid var(--accent2)",
                  color: "var(--accent2)", borderRadius: 6, fontSize: 10,
                }}>Tentar novamente</button>
              </div>
            )}
          </div>

          {/* View mode buttons */}
          {state === "done" && (
            <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
              {[["single","Frame único"],["fullscreen","Tela cheia"],["zoom","Zoom 1:1"]].map(([m, lbl]) => (
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
            }}>▶ GERAR PREVIEW</button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add "Comparar" option to context menu**

In the `ctxItems` function inside `FileList` (around line 462), add a compare option:

```javascript
function ctxItems(file){
  return [
    {icon:"🔍", label:"Comparar visual", action: () => window.openPreviewModal?.(file) },
    {icon:"📂", label:"Abrir pasta",    action: () => window.api?.openPath?.(file.dir) },
    {icon:"📋", label:"Copiar caminho", action: () => navigator.clipboard.writeText(file.fullPath) },
  ];
}
```

Also update `ContextMenu` component to support optional `onClose` that can be called externally.

- [ ] **Step 5: Add preview modal state to App component**

In App component (around line 674), add:

```javascript
const [previewFile, setPreviewFile] = useState(null);
```

And in the App's return, add the modal conditionally:

```jsx
{previewFile && (
  <ComparisonModal
    file={previewFile}
    config={cfg}
    onClose={() => setPreviewFile(null)}
  />
)}
```

Add `window.openPreviewModal` setup in the useEffect that sets up IPC listeners (around line 718):

```javascript
window.openPreviewModal = (file) => setPreviewFile(file);
```

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(preview): add comparison modal, slider, and context menu integration"
```

---

## Verification Checklist

After all tasks are complete, verify:

1. [ ] Modal opens when clicking "Comparar" from context menu on any file
2. [ ] Timestamp slider allows 0–100% selection with live time display
3. [ ] "Gerar Preview" runs FFmpeg in background without freezing UI
4. [ ] Progress bar shows stage name and percentage during generation
5. [ ] Slider divider is draggable smoothly to reveal before/after
6. [ ] View mode buttons switch between frame-single, fullscreen, zoom-1:1
7. [ ] Preview generation does not block conversion slots
8. [ ] Context menu "Comparar" appears for all file row types
9. [ ] Temp files cleaned up on modal close
10. [ ] Error state shows message and retry option if FFmpeg fails