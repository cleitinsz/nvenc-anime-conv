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

function quarantine(item, reason, fs, path) {
  const outDir        = path.dirname(item.saida);
  const quarantineDir = path.join(outDir, "_quarantine");
  fs.mkdirSync(quarantineDir, { recursive: true });
  const quarantinePath = path.join(quarantineDir, path.basename(item.saida));
  fs.renameSync(item.saida, quarantinePath);
  return { verdict: "quarantine", reason, suppressDelete: true, quarantinePath };
}

async function postProcess({ item, exitCode, stderr, probe, fs, path }) {
  if (exitCode === 0) {
    const outSize = fs.statSync(item.saida).size;
    if (outSize >= item.size) {
      fs.unlinkSync(item.saida);
      return { verdict: "no_gain", reason: "output_>=_source", suppressDelete: true };
    }

    const probeResult = await probe(item.saida);

    if (!(probeResult.height > 0)) {
      return quarantine(item, "no_video_stream", fs, path);
    }
    if (!(probeResult.bitrate > 0)) {
      return quarantine(item, "zero_bitrate", fs, path);
    }

    const durOk = item.duracao === 0
      ? probeResult.duracao > 0
      : Math.abs(probeResult.duracao - item.duracao) <= 2.0;
    if (!durOk) {
      return quarantine(item, "duration_mismatch", fs, path);
    }

    return { verdict: "ok", reason: "encode_succeeded" };
  }
  return { verdict: "error", reason: "exit_non_zero" };
}

module.exports = { postProcess };
