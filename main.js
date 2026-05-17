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

const { fmtBitrate, runParallel }   = require("./src/utils/formatters");
const { parseProgressFile }         = require("./src/utils/progressParser");
const { buildArgs, PROFILE_ENCODE, SCALE_FILTER, buildVF } = require("./src/utils/ffmpegArgs");
const { postProcess }               = require("./src/utils/postProcess");

// ============================================================
//  CONFIG PERSISTIDA  [FEAT]
// ============================================================

const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");

const LOG_STRINGS = {
  ptBR: {
    slotStart:   (id, name, h, enc) => `[Slot ${id}] Iniciando: ${name} | ${h}p ${enc}`,
    slotSuspect: (id, kb, name)     => `[Slot ${id}] Saída suspeita (${kb}KB): ${name}`,
    slotDone:    (id, name, mb1, mb2, pct, min) => `[Slot ${id}] ${name} | ${mb1}MB → ${mb2}MB (-${pct}%) | ${min}min`,
    slotDeleted: (id, name)       => `[Slot ${id}] Original deletado: ${name}`,
    slotFailed:  (id, name, code)  => `[Slot ${id}] FALHA: ${name} | ExitCode ${code}`,
    slotCause:   (err)             => `  CAUSA: ${err}`,
    sessionDone: (done, errs, gb, min) => `=== Concluído | Convertidos: ${done} | Erros: ${errs} | Ganho: ${gb} GB | Tempo: ${min}min ===`,
    starting:    (n, jobs, gpu, preset) => `Iniciando | ${n} arquivos | ${jobs} jobs | GPU ${gpu} | Preset ${preset}`,
    retrying:    (n)              => `Retentando ${n} arquivo(s) com erro...`,
    stopped:     ()               => "Conversão interrompida pelo usuário.",
    slotQuarantine: (id, name, reason) => `[Slot ${id}] QUARENTENA: ${name} | razão: ${reason}`,
    slotNoGain:     (id, name, mbOrig) => `[Slot ${id}] SEM GANHO: ${name} (${mbOrig}MB → sem redução)`,
    slotRetry:      (id, name, reason) => `[Slot ${id}] Erro transitório (${reason}). Re-enfileirando...`,
  },
  en: {
    slotStart:   (id, name, h, enc) => `[Slot ${id}] Starting: ${name} | ${h}p ${enc}`,
    slotSuspect: (id, kb, name)    => `[Slot ${id}] Suspicious output (${kb}KB): ${name}`,
    slotDone:    (id, name, mb1, mb2, pct, min) => `[Slot ${id}] ${name} | ${mb1}MB → ${mb2}MB (-${pct}%) | ${min}min`,
    slotDeleted: (id, name)        => `[Slot ${id}] Original deleted: ${name}`,
    slotFailed:  (id, name, code)  => `[Slot ${id}] FAILED: ${name} | ExitCode ${code}`,
    slotCause:   (err)             => `  REASON: ${err}`,
    sessionDone: (done, errs, gb, min) => `=== Done | Converted: ${done} | Errors: ${errs} | Saved: ${gb} GB | Time: ${min}min ===`,
    starting:    (n, jobs, gpu, preset) => `Starting | ${n} files | ${jobs} jobs | GPU ${gpu} | Preset ${preset}`,
    retrying:    (n)              => `Retrying ${n} file(s) with errors...`,
    stopped:     ()               => "Conversion stopped by user.",
    slotQuarantine: (id, name, reason) => `[Slot ${id}] QUARANTINE: ${name} | reason: ${reason}`,
    slotNoGain:     (id, name, mbOrig) => `[Slot ${id}] NO GAIN: ${name} (${mbOrig}MB → no reduction)`,
    slotRetry:      (id, name, reason) => `[Slot ${id}] Transient error (${reason}). Re-queueing...`,
  },
};

let L = LOG_STRINGS.ptBR;

function loadConfig() {
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
L = LOG_STRINGS[config.lang] || LOG_STRINGS.ptBR;

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

// ============================================================
//  SCAN PARALELO  [PERF]  → src/utils/formatters.js (runParallel)
// ============================================================

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
      if (e.isDirectory()) {
        if (e.name === "_quarantine") continue;  // pular pasta de quarentena
        walk(full); continue;
      }
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
    // Pula HEVC apenas se não há downscale ativo.
    // Com downscale, recomprimir HEVC faz sentido (4K→1080p mesmo já sendo HEVC).
    const isDownscale = config.outputRes !== "original";
    if (meta.codec === "hevc" && !isDownscale) {
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
  L = LOG_STRINGS[config.lang] || LOG_STRINGS.ptBR;
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
let quarantineCount = 0;
let noGainCount     = 0;
let retryCount      = 0;
let quarantineFirstPath = null;
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

// ── Perfis / args ffmpeg → src/utils/ffmpegArgs.js ───────────

function startSlot(slotId, item) {
  const progressFile = path.join(os.tmpdir(), `nvenc_s${slotId}_${Date.now()}.tmp`);
  item.progressFile  = progressFile;

  const qual    = item.height >= 1000 ? config.cqHD : config.cqSD;
  const encLabel = config.encoder === "cpu"
    ? `CPU x265 CRF${qual} [${config.cpuPreset}]`
    : `GPU NVENC CQ${qual} [${config.preset}]`;
  log("INFO", L.slotStart(slotId, item.name, item.height, encLabel));

  const proc = cp.spawn("ffmpeg", buildArgs(item, config), { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  proc.stderr.on("data", d => { stderr += d; });

  slots[slotId] = { proc, item, getStderr: () => stderr, progressFile, inicio: Date.now(), slotId, id: ++totalJobs };

  mainWindow?.webContents.send("file-status", { fullPath: item.fullPath, status: "converting", slotId, progress: 0 });
  proc.on("close", code => {
    if (running || code === 0) {
      finishSlot(slotId, code).catch(err => log("ERRO", `finishSlot crashed: ${err.message}`));
    }
  });
}

async function finishSlot(slotId, code) {
  const slot = slots[slotId];
  if (!slot) return;

  try {
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
      case "error":      handleError(slotId, slot, result, code); break;
    }
  } catch (err) {
    // Defensa contra exceções não previstas: contabiliza como erro, libera o slot
    errorCount++;
    log("ERRO", `[Slot ${slotId}] CRASH em finishSlot: ${err.message}`);
    mainWindow?.webContents.send("file-status", { fullPath: slot.item.fullPath, status: "error" });
  } finally {
    delete slots[slotId];
    sendStats();
    fillSlots();
    if (queue.length === 0 && Object.keys(slots).length === 0) finishSession();
  }
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

function handleError(slotId, slot, result, code) {
  const { item } = slot;
  const stderr = slot.getStderr();
  const stderrLines = stderr.split("\n").map(l => l.trim()).filter(Boolean);
  const errorLines  = stderrLines
    .filter(l => /error|invalid|failed|cannot|unsupported|unknown/i.test(l))
    .slice(-5);
  const lastError = errorLines.pop() || stderrLines.slice(-2).join(" | ") || "sem mensagem";

  errorCount++;
  log("ERRO", L.slotFailed(slotId, item.name, code));
  log("ERRO", L.slotCause(`${result.reason} | ${lastError}`));
  for (const l of errorLines) log("DEBUG", `  > ${l}`);
  mainWindow?.webContents.send("file-status", { fullPath: item.fullPath, status: "error" });
}

function finishSession() {
  running = false;
  clearInterval(pollInterval);
  pollInterval = null;

  const ganhoGB  = ((statsAntes - statsDepois) / 1073741824).toFixed(2);
  const totalMin = ((Date.now() - sessionStart) / 60000).toFixed(1);

  log("OK", L.sessionDone(doneCount, errorCount, ganhoGB, totalMin));
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
//  → parseProgressFile e fmtBitrate em src/utils/progressParser.js / formatters.js
// ============================================================

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
  quarantineCount = noGainCount = retryCount = 0;
  quarantineFirstPath = null;
  log("INFO", L.starting(queue.length, config.jobs, config.gpu, config.preset));
  fillSlots();
  pollInterval = setInterval(pollProgress, 800);
});

// [STAB] Retry sem reiniciar sessão
ipcMain.on("retry-errors", (_, errorFiles) => {
  if (errorFiles.length === 0) return;
  log("INFO", L.retrying(errorFiles.length));
  for (const f of errorFiles) {
    mainWindow?.webContents.send("file-status", { fullPath: f.fullPath, status: "queue", progress: 0 });
  }
  if (!running) {
    running = true; sessionStart = Date.now();
    doneCount = errorCount = statsAntes = statsDepois = 0;
    quarantineCount = noGainCount = retryCount = 0;
    quarantineFirstPath = null;
    queue = errorFiles.map(f => ({ ...f, status: "queue" }));
    fillSlots();
    pollInterval = setInterval(pollProgress, 800);
  } else {
    queue.push(...errorFiles.map(f => ({ ...f, status: "queue" })));
  }
});

ipcMain.on("stop-conversion", () => {
  running = false;
  log("AVISO", L.stopped());
  killAllJobs();
  mainWindow?.webContents.send("reset-converting");
});

ipcMain.on("open-log-folder", () => shell.openPath(app.getPath("userData")));
ipcMain.on("open-quarantine-folder", (_, p) => { if (p) shell.showItemInFolder(p); });

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
    const meta = await ffprobeAll(fullPath);
    const duracao = meta.duracao || 0;
    const timestampSec = duracao > 0 ? duracao * timestampPct : 0;

    sendProgress("Extraindo frame original...", 10);

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

    const filters = [];
    if (config.profile === "anime") {
      filters.push("hqdn3d=1.2:1.2:5:5", "gradfun");
    }
    const vfArg = filters.length > 0 ? ["-vf", filters.join(",")] : [];

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
        "-qp", String(cq),
      );
    }

    if (vfArg.length > 0) {
      excerptArgs.push(...vfArg);
    }

    excerptArgs.push("-an", excerptPath);

    await new Promise((resolve, reject) => {
      const proc = cp.spawn("ffmpeg", excerptArgs, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      proc.stderr.on("data", d => { stderr += d; });
      proc.on("close", code => code === 0 ? resolve() : reject(new Error(stderr.slice(-200))) );
    });

    sendProgress("Extraindo frame convertido...", 70);

    await new Promise((resolve, reject) => {
      const args = ["-ss", "0", "-i", excerptPath, "-vframes", "1", "-q:v", "2", convPath];
      const proc = cp.spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      proc.stderr.on("data", d => { stderr += d; });
      proc.on("close", code => code === 0 ? resolve() : reject(new Error(stderr.slice(-200))) );
    });

    sendProgress("Enviando frames...", 90);

    const fs2 = require("fs");
    const frameOrigBase64 = fs2.readFileSync(origPath).toString("base64");
    const frameConvBase64 = fs2.readFileSync(convPath).toString("base64");

    try { fs2.unlinkSync(origPath); } catch {}
    try { fs2.unlinkSync(convPath); } catch {}
    try { fs2.unlinkSync(excerptPath); } catch {}

    sendProgress("Concluído", 100);

    return { frameOrig: frameOrigBase64, frameConv: frameConvBase64 };
  } catch (err) {
    try { require("fs").unlinkSync(origPath); } catch {}
    try { require("fs").unlinkSync(convPath); } catch {}
    try { require("fs").unlinkSync(excerptPath); } catch {}

    throw err;
  }
});