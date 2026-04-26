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

/**
 * Monta os argumentos ffmpeg para encode via GPU NVENC.
 * @param {object} item - Arquivo a codificar (fullPath, saida, progressFile, height)
 * @param {object} config
 * @returns {string[]}
 */
function buildArgsGPU(item, config) {
  const prof = PROFILE_ENCODE[config.profile] ?? PROFILE_ENCODE.anime;
  const cq   = item.height >= 1000 ? config.cqHD : config.cqSD;
  const vf   = buildVF(prof.vf, config);

  // -hwaccel cuda só é compatível sem filtros de CPU (scale, hqdn3d, etc.)
  const args = ["-y"];
  if (!vf) args.push("-hwaccel", "cuda", "-hwaccel_output_format", "cuda");
  args.push("-i", item.fullPath, "-map", "0:v:0", "-map", "0:a:0", "-map", "0:s?");

  if (vf) args.push("-vf", vf);

  args.push(
    "-c:v", "hevc_nvenc",
    "-gpu",    String(config.gpu),
    "-preset", config.preset,
    "-rc",     "vbr",
    "-cq",     String(cq), "-b:v", "0",
    "-spatial-aq", "1", "-aq-strength", prof.aqStrength,
    "-rc-lookahead", "10",
    "-profile:v", "main10", "-pix_fmt", "p010le",
    "-c:a", "copy", "-c:s", "copy", "-tag:v", "hvc1", "-ignore_unknown",
    "-vsync", "0",
    "-progress", item.progressFile,
    item.saida,
  );

  return args;
}

/**
 * Monta os argumentos ffmpeg para encode via CPU libx265.
 * @param {object} item
 * @param {object} config
 * @returns {string[]}
 */
function buildArgsCPU(item, config) {
  const prof = PROFILE_ENCODE[config.profile] ?? PROFILE_ENCODE.anime;
  const crf  = item.height >= 1000 ? config.cqHD : config.cqSD;
  const vf   = buildVF(prof.vf, config);

  const args = [
    "-y",
    "-i", item.fullPath,
    "-map", "0:v:0", "-map", "0:a:0", "-map", "0:s?",
  ];

  if (vf) args.push("-vf", vf);

  args.push(
    "-c:v", "libx265",
    "-preset",     config.cpuPreset,
    "-crf",        String(crf),
    "-x265-params", prof.x265params,
    "-pix_fmt",    "yuv420p10le",
    "-c:a", "copy", "-c:s", "copy", "-tag:v", "hvc1", "-ignore_unknown",
    "-progress", item.progressFile,
    item.saida,
  );

  return args;
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

module.exports = { buildVF, buildArgsGPU, buildArgsCPU, buildArgs, PROFILE_ENCODE, SCALE_FILTER };
