// ── Saídas parciais de encode interrompido ───────────────────
//
//  Camada 1 (PARAR): apaga a saída do slot morto.
//  Camada 2 (scan):  saída existente com duração diferente da fonte
//                    é um encode interrompido, não "já convertido".

// Mesma tolerância do postProcess para "duração bate com a fonte".
const DURATION_TOLERANCE_S = 2.0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Apaga a saída parcial depois que o ffmpeg terminou de fato.
 * No Windows o kill é assíncrono e o handle aberto bloqueia o unlink,
 * por isso espera o "close" e tenta de novo em EBUSY/EPERM.
 * @param {object} proc - ChildProcess (ou compatível: exitCode, signalCode, evento close)
 * @param {string} saida - Caminho da saída parcial
 * @param {object} fs - módulo fs (injetável)
 * @param {{retries?: number, delayMs?: number}} [opts]
 * @returns {Promise<boolean>} true se apagou
 */
async function removePartialOutput(proc, saida, fs, { retries = 5, delayMs = 200 } = {}) {
  const exited = proc.exitCode !== null || proc.signalCode !== null;
  if (!exited) await new Promise((resolve) => proc.once("close", resolve));

  for (let attempt = 0; ; attempt++) {
    try {
      fs.unlinkSync(saida);
      return true;
    } catch (err) {
      const locked = err.code === "EBUSY" || err.code === "EPERM";
      if (!locked || attempt >= retries) return false;
      await sleep(delayMs);
    }
  }
}

/**
 * Saída existente está completa? Conservador: sem a duração da fonte
 * (ffprobe falhou) não condena a saída, para nunca apagar um encode bom.
 * @param {number} outDuration - Duração da saída em segundos (0 = ilegível)
 * @param {number} srcDuration - Duração da fonte em segundos (0 = desconhecida)
 * @returns {boolean}
 */
function isOutputComplete(outDuration, srcDuration) {
  if (!(srcDuration > 0)) return true;
  return Math.abs(outDuration - srcDuration) <= DURATION_TOLERANCE_S;
}

/**
 * Duração real de uma saída MKV a partir do JSON do ffprobe
 * (-show_entries stream_tags=DURATION). O format=duration não serve: o muxer
 * grava no cabeçalho a duração esperada da fonte, e um encode morto no meio
 * continua dizendo a duração inteira. A tag DURATION do stream só é escrita
 * quando o arquivo é finalizado, então sem ela o MKV está truncado.
 * @param {object} probeJson
 * @returns {number} segundos (0 = truncado ou ilegível)
 */
function parseOutputDuration(probeJson) {
  const tag = probeJson?.streams?.[0]?.tags?.DURATION;
  const m   = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(tag || "");
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

module.exports = { removePartialOutput, isOutputComplete, parseOutputDuration, DURATION_TOLERANCE_S };
