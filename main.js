// ============================================================
//  NVENC Anime Converter - Main Process v7
//
//  [PERF] 1 chamada ffprobe por arquivo (era 3) → scan ~3x mais rápido
//  [PERF] Scan paralelo com concorrência 4x simultânea
//  [PERF] Lê fps/speed/bitrate do progress file em tempo real
//  [UX]   ETA global da sessão inteira
//  [UX]   fps, speed, bitrate exibidos nos slots ativos
//  [STAB] Detecta saídas incompletas no scan (< 1 MB)
//  [STAB] Retry de erros sem reiniciar sessão
//  [FEAT] Config persistida entre sessões (JSON em userData)
//  [FEAT] Notificação nativa Windows ao concluir
// ============================================================

const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require("electron");
const path = require("path");
const fs   = require("fs");
const os   = require("os");
const cp   = require("child_process");

// ============================================================
//  CONFIG PERSISTIDA  [FEAT]
// ============================================================

const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");

function loadConfig() {
  const defaults = {
    gpu: 0, preset: "p6", jobs: 2,
    sufixo: "_hevc", cqHD: 28, cqSD: 26,
    deletarOriginal: false, lastFolder: null,
    outputMode: "encoded",  // "same" | "encoded" | "custom"
    outputFolder: null,       // usado só quando outputMode === "custom"
  };
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) };
  } catch {
    return defaults;
  }
}

function saveConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch {}
}

let config = loadConfig();

// ============================================================
//  JANELA
// ============================================================

let mainWindow = null;

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 600,
    backgroundColor: "#0a0e14",
    titleBarStyle:   "hidden",
    titleBarOverlay: { color: "#0d1220", symbolColor: "#4a6080", height: 40 },
    webPreferences: {
      preload:          path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });
  mainWindow.loadFile("index.html");
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.send("config-loaded", config);
  });
});

app.on("window-all-closed", () => { killAllJobs(); app.quit(); });

// ============================================================
//  FFPROBE — 1 CHAMADA POR ARQUIVO  [PERF]
//
//  Antes: getCodec() + getHeight() + getDuration() = 3 processos
//  Agora: ffprobeAll() = 1 processo com JSON combinado
// ============================================================

function ffprobeAll(filePath) {
  return new Promise((resolve) => {
    const proc = cp.spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,height:format=duration",
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
        });
      } catch {
        resolve({ codec: "", height: 720, duracao: 0 });
      }
    });
  });
}

// ============================================================
//  SCAN PARALELO  [PERF]
//
//  Roda N tarefas async ao mesmo tempo.
//  concurrency=4 é o sweet spot para não saturar disco/CPU.
// ============================================================

async function runParallel(tasks, concurrency = 4, onProgress) {
  const results = new Array(tasks.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < tasks.length) {
      const i = nextIdx++;
      results[i] = await tasks[i]();
      onProgress?.(nextIdx, tasks.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

// ============================================================
//  IPC — seleção de pasta
// ============================================================

ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties:  ["openDirectory"],
    title:       "Selecione a pasta dos animes",
    defaultPath: config.lastFolder || undefined,
  });
  if (result.canceled) return null;
  config.lastFolder = result.filePaths[0];
  saveConfig(config);
  return result.filePaths[0];
});

// IPC — seleção de pasta de saída customizada
ipcMain.handle("select-output-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties:  ["openDirectory", "createDirectory"],
    title:       "Selecione a pasta de saída",
    defaultPath: config.outputFolder || config.lastFolder || undefined,
  });
  if (result.canceled) return null;
  config.outputFolder = result.filePaths[0];
  saveConfig(config);
  return result.filePaths[0];
});

// resolveSaida — único ponto de decisão do caminho de saída
// "same"    → mesma pasta do arquivo fonte
// "encoded" → subpasta "encoded" dentro da pasta do arquivo
// "custom"  → pasta escolhida pelo usuário (preserva estrutura relativa à raiz)
function resolveSaida(file, rootFolder) {
  const nome = file.base + config.sufixo + ".mkv";
  if (config.outputMode === "encoded") {
    const dir = path.join(file.dir, "encoded");
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, nome);
  }
  if (config.outputMode === "custom" && config.outputFolder) {
    const rel    = path.relative(rootFolder, file.dir);
    const outDir = rel ? path.join(config.outputFolder, rel) : config.outputFolder;
    fs.mkdirSync(outDir, { recursive: true });
    return path.join(outDir, nome);
  }
  return path.join(file.dir, nome); // "same" ou fallback
}

// ============================================================
//  IPC — scan
// ============================================================

ipcMain.handle("scan-folder", async (_, folderPath) => {
  const exts   = ["mkv","mp4","avi","mov"];
  const sufixo = config.sufixo;
  const raw    = [];

  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.isFile()) continue;
      const ext  = path.extname(e.name).slice(1).toLowerCase();
      const base = path.basename(e.name, "." + ext);
      if (!exts.includes(ext))   continue;
      if (base.endsWith(sufixo)) continue;
      let size = 0;
      try { size = fs.statSync(full).size; } catch {}
      raw.push({ fullPath: full, name: e.name, base, dir, size });
    }
  }
  walk(folderPath);

  mainWindow?.webContents.send("scan-progress", { scanned: 0, total: raw.length, phase: "disk" });

  // Pré-filtra arquivos que já têm saída completa (sem chamar ffprobe)
  const toProbe   = [];
  const preResult = [];

  for (const f of raw) {
    const saida = resolveSaida(f, folderPath);
    if (fs.existsSync(saida)) {
      // [STAB] Saída incompleta = menor que 1 MB → reprocessa
      let saidaSize = 0;
      try { saidaSize = fs.statSync(saida).size; } catch {}
      if (saidaSize < 1024 * 1024) {
        try { fs.unlinkSync(saida); } catch {}
        toProbe.push({ f, saida });
      } else {
        preResult.push({ ...f, status: "done_skip", saida });
      }
    } else {
      toProbe.push({ f, saida });
    }
  }

  // Scan paralelo com ffprobe
  const probeResults = await runParallel(
    toProbe.map(({ f, saida }) => async () => {
      const meta = await ffprobeAll(f.fullPath);
      return { f, saida, meta };
    }),
    4,
    (done) => mainWindow?.webContents.send("scan-progress", {
      scanned: preResult.length + done,
      total:   raw.length,
      phase:   "probe",
    })
  );

  const result = [...preResult];
  for (const { f, saida, meta } of probeResults) {
    if (meta.codec === "hevc") {
      result.push({ ...f, status: "hevc_skip", saida });
    } else {
      const cq = meta.height >= 1000 ? config.cqHD : config.cqSD;
      result.push({ ...f, status: "queue", saida, ...meta, cq });
    }
  }

  return result;
});

// ============================================================
//  IPC — config
// ============================================================

ipcMain.on("set-config", (_, newCfg) => {
  config = { ...config, ...newCfg };
  saveConfig(config);
});

ipcMain.handle("get-config", () => config);

// ============================================================
//  JOB POOL
// ============================================================

let slots        = {};
let queue        = [];
let running      = false;
let totalJobs    = 0;
let doneCount    = 0;
let errorCount   = 0;
let ignoredCount = 0;
let statsAntes   = 0;
let statsDepois  = 0;
let pollInterval = null;
let sessionStart = null;

function log(lvl, msg) {
  const t = new Date().toLocaleTimeString("pt-BR", { hour12: false });
  mainWindow?.webContents.send("log", { t, lvl, msg });
}

function killAllJobs() {
  for (const slot of Object.values(slots)) {
    try { slot.proc.kill("SIGKILL"); } catch {}
    try { fs.unlinkSync(slot.progressFile); } catch {}
  }
  slots = {};
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

function buildArgs(item) {
  return [
    "-y", "-hwaccel", "cuda",
    "-i", item.fullPath,
    "-map", "0:v", "-map", "0:a:0", "-map", "0:s?",
    "-vf", "hqdn3d=1.2:1.2:5:5,gradfun",
    "-c:v", "hevc_nvenc",
    "-gpu", String(config.gpu),
    "-preset", config.preset,
    "-tune", "hq", "-rc", "vbr",
    "-cq", String(item.height >= 1000 ? config.cqHD : config.cqSD), "-b:v", "0",
    "-spatial-aq", "1", "-aq-strength", "8",
    "-profile:v", "main10", "-pix_fmt", "p010le",
    "-c:a", "copy", "-c:s", "copy", "-tag:v", "hvc1",
    "-progress", item.progressFile,
    item.saida,
  ];
}

function startSlot(slotId, item) {
  const progressFile = path.join(os.tmpdir(), `nvenc_s${slotId}_${Date.now()}.tmp`);
  item.progressFile  = progressFile;

  log("INFO", `[Slot ${slotId}] Iniciando: ${item.name} | ${item.height}p CQ${item.height >= 1000 ? config.cqHD : config.cqSD}`);

  const proc = cp.spawn("ffmpeg", buildArgs(item), { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  proc.stderr.on("data", d => { stderr += d; });

  slots[slotId] = { proc, item, getStderr: () => stderr, progressFile, inicio: Date.now(), slotId, id: ++totalJobs };

  mainWindow?.webContents.send("file-status", { fullPath: item.fullPath, status: "converting", slotId, progress: 0 });
  proc.on("close", code => { if (running || code === 0) finishSlot(slotId, code); });
}

function finishSlot(slotId, code) {
  const slot = slots[slotId];
  if (!slot) return;

  const { item } = slot;
  const durConv  = ((Date.now() - slot.inicio) / 60000).toFixed(1);

  try { fs.unlinkSync(slot.progressFile); } catch {}
  mainWindow?.webContents.send("slot-clear", { slotId });

  if (code === 0 && fs.existsSync(item.saida)) {
    const sizeAfter = fs.statSync(item.saida).size;
    if (sizeAfter < 100 * 1024) {
      log("ERRO", `[Slot ${slotId}] Saída suspeita (${Math.round(sizeAfter/1024)}KB): ${item.name}`);
      try { fs.unlinkSync(item.saida); } catch {}
      errorCount++;
      mainWindow?.webContents.send("file-status", { fullPath: item.fullPath, status: "error" });
    } else {
      const reducao = Math.round((item.size - sizeAfter) * 100 / item.size);
      const mb1 = (item.size   / 1048576).toFixed(1);
      const mb2 = (sizeAfter  / 1048576).toFixed(1);
      statsAntes  += item.size;
      statsDepois += sizeAfter;
      doneCount++;
      log("OK", `[Slot ${slotId}] ${item.name} | ${mb1}MB → ${mb2}MB (-${reducao}%) | ${durConv}min`);
      mainWindow?.webContents.send("file-status", {
        fullPath: item.fullPath, status: "done",
        mb1: parseFloat(mb1), mb2: parseFloat(mb2), reducao,
      });
      if (config.deletarOriginal) {
        try { fs.unlinkSync(item.fullPath); } catch {}
        log("INFO", `[Slot ${slotId}] Original deletado: ${item.name}`);
      }
    }
  } else {
    const lastError = slot.getStderr().split("\n")
      .filter(l => /error|invalid|failed|cannot/i.test(l)).pop()?.trim() || "sem mensagem";
    log("ERRO", `[Slot ${slotId}] FALHA: ${item.name} | ExitCode ${code} | ${lastError}`);
    errorCount++;
    mainWindow?.webContents.send("file-status", { fullPath: item.fullPath, status: "error" });
  }

  delete slots[slotId];
  sendStats();
  fillSlots();

  if (queue.length === 0 && Object.keys(slots).length === 0) finishSession();
}

function finishSession() {
  running = false;
  clearInterval(pollInterval);
  pollInterval = null;

  const ganhoGB  = ((statsAntes - statsDepois) / 1073741824).toFixed(2);
  const totalMin = ((Date.now() - sessionStart) / 60000).toFixed(1);

  log("OK", `=== Concluído | Convertidos: ${doneCount} | Erros: ${errorCount} | Ganho: ${ganhoGB} GB | Tempo: ${totalMin}min ===`);
  mainWindow?.webContents.send("conversion-done", {
    convertidos: doneCount, erros: errorCount, ignorados: ignoredCount, ganhoGB: parseFloat(ganhoGB),
  });

  // [FEAT] Notificação nativa Windows
  if (Notification.isSupported()) {
    new Notification({
      title: "NVENC Anime — Concluído ✓",
      body:  `${doneCount} arquivo${doneCount !== 1 ? "s" : ""} convertido${doneCount !== 1 ? "s" : ""} · ${ganhoGB} GB liberados${errorCount > 0 ? ` · ⚠ ${errorCount} erro(s)` : ""}`,
    }).show();
  }
}

function fillSlots() {
  while (queue.length > 0 && Object.keys(slots).length < config.jobs) {
    const freeSlot = [0,1,2].find(id => !slots[id]);
    if (freeSlot === undefined) break;
    startSlot(freeSlot, queue.shift());
  }
}

// ============================================================
//  POLL — lê fps / speed / bitrate do progress file  [PERF/UX]
// ============================================================

function parseProgressFile(filePath) {
  try {
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    const get   = key => lines.filter(l => l.startsWith(key + "=")).pop()?.split("=")[1]?.trim() ?? "";
    return {
      out_time_ms: parseInt(get("out_time_ms")) || 0,
      fps:         parseFloat(get("fps"))        || 0,
      speed:       get("speed"),
      bitrate:     get("bitrate"),
    };
  } catch { return null; }
}

function fmtBitrate(raw) {
  if (!raw || raw === "N/A") return "";
  const kbps = parseFloat(raw);
  return kbps >= 1000 ? `${(kbps/1000).toFixed(1)} Mbps` : `${Math.round(kbps)} kbps`;
}

function pollProgress() {
  for (const [sidStr, slot] of Object.entries(slots)) {
    const slotId = parseInt(sidStr);
    if (!fs.existsSync(slot.progressFile)) continue;

    const p = parseProgressFile(slot.progressFile);
    if (!p || p.out_time_ms <= 0) continue;

    const seg = p.out_time_ms / 1000000;
    const dur = slot.item.duracao;
    if (dur <= 0 || seg <= 0) continue;

    const pct     = Math.min(100, Math.round(seg / dur * 100));
    const elapsed = (Date.now() - slot.inicio) / 1000;
    const etaSeg  = pct > 0 ? Math.round(elapsed * (100 - pct) / pct) : 0;
    const mm      = String(Math.floor(etaSeg / 60)).padStart(2, "0");
    const ss      = String(etaSeg % 60).padStart(2, "0");

    mainWindow?.webContents.send("slot-update", {
      slotId, name: slot.item.name, progress: pct,
      eta:     `${mm}:${ss}`,
      cq: slot.item.height >= 1000 ? config.cqHD : config.cqSD,
      id:      slot.id,
      fps:     p.fps > 0               ? `${p.fps.toFixed(1)} fps` : "",
      speed:   p.speed && p.speed !== "N/A" ? p.speed : "",
      bitrate: fmtBitrate(p.bitrate),
    });

    mainWindow?.webContents.send("file-status", {
      fullPath: slot.item.fullPath, status: "converting", progress: pct, slotId,
    });
  }

  // ETA global baseado em velocidade média dos slots  [UX]
  let globalEta = "";
  const activeSlots = Object.values(slots);
  if (activeSlots.length > 0) {
    let totalSpeed = 0, count = 0;
    for (const slot of activeSlots) {
      const elapsed = (Date.now() - slot.inicio) / 1000;
      if (elapsed < 5) continue;
      const p = parseProgressFile(slot.progressFile);
      if (p?.out_time_ms > 0) {
        totalSpeed += (p.out_time_ms / 1000000) / elapsed;
        count++;
      }
    }
    if (count > 0) {
      const avgSpeed = (totalSpeed / count) * activeSlots.length;
      const remainVid = [
        ...activeSlots.map(s => {
          const p = parseProgressFile(s.progressFile);
          const done = p?.out_time_ms > 0 ? p.out_time_ms / 1000000 : 0;
          return Math.max(0, s.item.duracao - done);
        }),
        ...queue.map(f => f.duracao || 0),
      ].reduce((a, b) => a + b, 0);

      if (avgSpeed > 0) {
        const s  = Math.round(remainVid / avgSpeed);
        const h  = Math.floor(s / 3600);
        const m  = Math.floor((s % 3600) / 60);
        const ss = s % 60;
        globalEta = h > 0
          ? `${h}h ${String(m).padStart(2,"0")}min`
          : m > 0 ? `${m}min ${String(ss).padStart(2,"0")}s`
          : `${ss}s`;
      }
    }
  }

  sendStats(globalEta);
}

function sendStats(globalEta = "") {
  mainWindow?.webContents.send("stats", {
    done: doneCount, errors: errorCount,
    active: Object.keys(slots).length,
    queue: queue.length,
    ganhoGB: ((statsAntes - statsDepois) / 1073741824).toFixed(2),
    globalEta,
  });
}

// ============================================================
//  IPC — controles de conversão
// ============================================================

ipcMain.on("start-conversion", (_, files) => {
  if (running) return;
  running = true; sessionStart = Date.now();
  queue = files.filter(f => f.status === "queue");
  totalJobs = doneCount = errorCount = 0;
  ignoredCount = files.filter(f => f.status !== "queue").length;
  statsAntes = statsDepois = 0;
  log("INFO", `Iniciando | ${queue.length} arquivos | ${config.jobs} jobs | GPU ${config.gpu} | Preset ${config.preset}`);
  fillSlots();
  pollInterval = setInterval(pollProgress, 800);
});

// [STAB] Retry sem reiniciar sessão
ipcMain.on("retry-errors", (_, errorFiles) => {
  if (errorFiles.length === 0) return;
  log("INFO", `Retentando ${errorFiles.length} arquivo(s) com erro...`);
  for (const f of errorFiles) {
    mainWindow?.webContents.send("file-status", { fullPath: f.fullPath, status: "queue", progress: 0 });
  }
  if (!running) {
    running = true; sessionStart = Date.now();
    doneCount = errorCount = statsAntes = statsDepois = 0;
    queue = errorFiles.map(f => ({ ...f, status: "queue" }));
    fillSlots();
    pollInterval = setInterval(pollProgress, 800);
  } else {
    queue.push(...errorFiles.map(f => ({ ...f, status: "queue" })));
  }
});

ipcMain.on("stop-conversion", () => {
  running = false;
  log("AVISO", "Conversão interrompida pelo usuário.");
  killAllJobs();
  mainWindow?.webContents.send("reset-converting");
});

ipcMain.on("open-log-folder", () => shell.openPath(app.getPath("userData")));
