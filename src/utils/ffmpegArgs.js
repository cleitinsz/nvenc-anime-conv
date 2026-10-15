// ── Perfis de encode ─────────────────────────────────────────
//
//  anime      → hqdn3d (denoise leve) + gradfun (debanding)
//  liveaction → sem filtros de vídeo (preserva grain cinematográfico)

const PROFILE_ENCODE = {
  anime: {
    vf:         "hqdn3d=1.2:1.2:5:5,gradfun",
    aqStrength: "8",
    x265params: "aq-mode=3:aq-strength=0.8:deblock=-1,-1",
  },
  liveaction: {
    vf:         null,
    aqStrength: "10",
    x265params: "aq-mode=2:aq-strength=1.0",
  },
};

// ── Resolução de saída → filtro de escala ────────────────────
const SCALE_FILTER = {
  "1080p": "scale=-2:1080:flags=lanczos",
  "720p":  "scale=-2:720:flags=lanczos",
  "480p":  "scale=-2:480:flags=lanczos",
};

/**
 * Monta o filtro de vídeo combinando escala (se ativa) e filtro do perfil.
 * @param {string|null} profVf - Filtro do perfil (ex: "hqdn3d=...")
 * @param {object} config
 * @returns {string|null}
 */
function buildVF(profVf, config) {
  const scale = SCALE_FILTER[config.outputRes];
  if (scale && profVf) return `${scale},${profVf}`;
  if (scale)           return scale;
  if (profVf)          return profVf;
  return null;
}

// ── Opções de vídeo ──────────────────────────────────────────
//  O que define a qualidade do vídeo. Compartilhado entre o encode real e o
//  preview, para o preview mostrar exatamente o que o encode vai gerar.

/**
 * -hwaccel cuda só é compatível sem filtros de CPU (scale, hqdn3d, etc.)
 * @param {object} config
 * @returns {string[]}
 */
function hwaccelArgs(config) {
  const prof = PROFILE_ENCODE[config.profile] ?? PROFILE_ENCODE.anime;
  return buildVF(prof.vf, config) ? [] : ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"];
}

/**
 * Filtro + codificação do vídeo via GPU NVENC.
 * @param {object} item - precisa de height (CQ por resolução)
 * @param {object} config
 * @returns {string[]}
 */
function videoArgsGPU(item, config) {
  const prof = PROFILE_ENCODE[config.profile] ?? PROFILE_ENCODE.anime;
  const cq   = item.height >= 1000 ? config.cqHD : config.cqSD;
  const vf   = buildVF(prof.vf, config);

  return [
    ...(vf ? ["-vf", vf] : []),
    "-c:v", "hevc_nvenc",
    "-gpu",    String(config.gpu),
    "-preset", config.preset,
    "-rc",     "vbr",
    "-cq",     String(cq), "-b:v", "0",
    "-spatial-aq", "1", "-aq-strength", prof.aqStrength,
    "-rc-lookahead", "10",
    "-profile:v", "main10", "-pix_fmt", "p010le",
  ];
}

/**
 * Filtro + codificação do vídeo via CPU libx265.
 * @param {object} item - precisa de height (CRF por resolução)
 * @param {object} config
 * @returns {string[]}
 */
function videoArgsCPU(item, config) {
  const prof = PROFILE_ENCODE[config.profile] ?? PROFILE_ENCODE.anime;
  const crf  = item.height >= 1000 ? config.cqHD : config.cqSD;
  const vf   = buildVF(prof.vf, config);

  return [
    ...(vf ? ["-vf", vf] : []),
    "-c:v", "libx265",
    "-preset",     config.cpuPreset,
    "-crf",        String(crf),
    "-x265-params", prof.x265params,
    "-pix_fmt",    "yuv420p10le",
  ];
}

/**
 * Monta os argumentos ffmpeg para encode via GPU NVENC.
 * @param {object} item - Arquivo a codificar (fullPath, saida, progressFile, height)
 * @param {object} config
 * @returns {string[]}
 */
function buildArgsGPU(item, config) {
  return [
    "-y",
    ...hwaccelArgs(config),
    "-i", item.fullPath, "-map", "0:v:0", "-map", "0:a:0?", "-map", "0:s?",
    ...videoArgsGPU(item, config),
    "-c:a", "copy", "-c:s", "copy", "-tag:v", "hvc1", "-ignore_unknown",
    "-vsync", "0",
    "-progress", item.progressFile,
    item.saida,
  ];
}

/**
 * Monta os argumentos ffmpeg para encode via CPU libx265.
 * @param {object} item
 * @param {object} config
 * @returns {string[]}
 */
function buildArgsCPU(item, config) {
  return [
    "-y",
    "-i", item.fullPath,
    "-map", "0:v:0", "-map", "0:a:0?", "-map", "0:s?",
    ...videoArgsCPU(item, config),
    "-c:a", "copy", "-c:s", "copy", "-tag:v", "hvc1", "-ignore_unknown",
    "-progress", item.progressFile,
    item.saida,
  ];
}

/**
 * Trecho de preview codificado com as mesmas opções de vídeo do encode real.
 * @param {object} item - fullPath e height
 * @param {object} config
 * @param {{startSec: number, durationSec: number, out: string}} opts
 * @returns {string[]}
 */
function buildPreviewArgs(item, config, { startSec, durationSec, out }) {
  const gpu = config.encoder !== "cpu";
  return [
    "-y",
    ...(gpu ? hwaccelArgs(config) : []),
    "-ss", String(startSec), "-i", item.fullPath, "-t", String(durationSec),
    "-map", "0:v:0",
    ...(gpu ? videoArgsGPU(item, config) : videoArgsCPU(item, config)),
    "-an", out,
  ];
}

/**
 * Seleciona GPU ou CPU conforme config.encoder.
 * @param {object} item
 * @param {object} config
 * @returns {string[]}
 */
function buildArgs(item, config) {
  return config.encoder === "cpu" ? buildArgsCPU(item, config) : buildArgsGPU(item, config);
}

module.exports = { buildVF, buildArgsGPU, buildArgsCPU, buildArgs, buildPreviewArgs, PROFILE_ENCODE, SCALE_FILTER };
