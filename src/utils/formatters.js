/**
 * Formata um valor bruto de bitrate (em kbps) para string legível.
 * @param {string|null} raw - Valor bruto do ffmpeg (ex: "2000kbps", "N/A")
 * @returns {string}
 */
function fmtBitrate(raw) {
  if (!raw || raw === "N/A") return "";
  const kbps = parseFloat(raw);
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mbps` : `${Math.round(kbps)} kbps`;
}

/**
 * Executa N tarefas async com concorrência limitada.
 * @param {Array<() => Promise<any>>} tasks
 * @param {number} concurrency
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<any[]>}
 */
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

module.exports = { fmtBitrate, runParallel };
