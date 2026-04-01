const fs = require("fs");

/**
 * Lê e parseia o arquivo de progresso gerado pelo ffmpeg (-progress <file>).
 * Retorna o último valor de cada chave (ffmpeg faz append contínuo).
 *
 * @param {string} filePath - Caminho para o arquivo de progresso
 * @param {object} [fsModule] - Módulo fs (injetável para testes)
 * @returns {{ out_time_ms: number, fps: number, speed: string, bitrate: string } | null}
 */
function parseProgressFile(filePath, fsModule = fs) {
  try {
    const lines = fsModule.readFileSync(filePath, "utf8").split("\n");
    const get   = key => lines.filter(l => l.startsWith(key + "=")).pop()?.split("=")[1]?.trim() ?? "";
    return {
      out_time_ms: parseInt(get("out_time_ms")) || 0,
      fps:         parseFloat(get("fps"))        || 0,
      speed:       get("speed"),
      bitrate:     get("bitrate"),
    };
  } catch {
    return null;
  }
}

module.exports = { parseProgressFile };
