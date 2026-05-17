/**
 * Decisão pós-encode: valida output, classifica erros, decide retry.
 * Função pura — todas as dependências externas (fs, path, probe) injetadas.
 *
 * @param {object} opts
 * @param {object} opts.item       - { fullPath, saida, size, duracao, attempts? }
 * @param {number} opts.exitCode   - exit code do processo ffmpeg
 * @param {string} opts.stderr     - stderr completo capturado
 * @param {function} opts.probe    - async (path) → { codec, height, duracao, bitrate }
 * @param {object} opts.fs         - módulo fs (injetável)
 * @param {object} opts.path       - módulo path (injetável)
 * @returns {Promise<{verdict, reason, retryable?, suppressDelete?, quarantinePath?}>}
 */
async function postProcess({ item, exitCode, stderr, probe, fs, path }) {
  if (exitCode === 0) {
    const outSize = fs.statSync(item.saida).size;
    if (outSize >= item.size) {
      fs.unlinkSync(item.saida);
      return { verdict: "no_gain", reason: "output_>=_source", suppressDelete: true };
    }
    return { verdict: "ok", reason: "encode_succeeded" };
  }
  return { verdict: "error", reason: "exit_non_zero" };
}

module.exports = { postProcess };
