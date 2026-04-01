const { buildVF, buildArgsGPU, buildArgsCPU, buildArgs } = require("../src/utils/ffmpegArgs");

const baseConfig = {
  gpu: 0, preset: "p6", cqHD: 28, cqSD: 26,
  profile: "anime", encoder: "nvenc",
  cpuPreset: "medium", outputRes: "original",
};

const makeItem = (overrides = {}) => ({
  fullPath:     "/videos/test.mkv",
  saida:        "/videos/test_hevc.mkv",
  progressFile: "/tmp/progress.tmp",
  height:       720,
  ...overrides,
});

// ──────────────────────────────────────────────
//  buildVF
// ──────────────────────────────────────────────

describe("buildVF", () => {
  test("retorna null quando outputRes é original e sem profVf", () => {
    expect(buildVF(null, { ...baseConfig, outputRes: "original" })).toBeNull();
  });

  test("retorna apenas filtro de escala quando outputRes é 1080p e sem profVf", () => {
    expect(buildVF(null, { ...baseConfig, outputRes: "1080p" }))
      .toBe("scale=-2:1080:flags=lanczos");
  });

  test("retorna apenas filtro de escala quando outputRes é 720p e sem profVf", () => {
    expect(buildVF(null, { ...baseConfig, outputRes: "720p" }))
      .toBe("scale=-2:720:flags=lanczos");
  });

  test("combina escala e profVf quando ambos estão presentes", () => {
    const result = buildVF("hqdn3d=1.2:1.2:5:5,gradfun", { ...baseConfig, outputRes: "720p" });
    expect(result).toBe("scale=-2:720:flags=lanczos,hqdn3d=1.2:1.2:5:5,gradfun");
  });

  test("retorna apenas profVf quando outputRes é original mas profVf está presente", () => {
    expect(buildVF("hqdn3d=1.2:1.2:5:5,gradfun", { ...baseConfig, outputRes: "original" }))
      .toBe("hqdn3d=1.2:1.2:5:5,gradfun");
  });
});

// ──────────────────────────────────────────────
//  buildArgsGPU
// ──────────────────────────────────────────────

describe("buildArgsGPU", () => {
  test("contém -hwaccel cuda quando não há filtro de vídeo (liveaction + res original)", () => {
    const cfg  = { ...baseConfig, profile: "liveaction", outputRes: "original" };
    const args = buildArgsGPU(makeItem(), cfg);
    const idx  = args.indexOf("-hwaccel");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe("cuda");
  });

  test("NÃO contém -hwaccel cuda quando há filtro de vídeo ativo (perfil anime)", () => {
    const args = buildArgsGPU(makeItem(), baseConfig);
    expect(args).not.toContain("cuda");
  });

  test("usa cqHD para itens com altura >= 1000", () => {
    const args   = buildArgsGPU(makeItem({ height: 1080 }), baseConfig);
    const cqIdx  = args.indexOf("-cq");
    expect(args[cqIdx + 1]).toBe(String(baseConfig.cqHD));
  });

  test("usa cqSD para itens com altura < 1000", () => {
    const args  = buildArgsGPU(makeItem({ height: 720 }), baseConfig);
    const cqIdx = args.indexOf("-cq");
    expect(args[cqIdx + 1]).toBe(String(baseConfig.cqSD));
  });

  test("caminho de saída é o último argumento", () => {
    const item = makeItem();
    const args = buildArgsGPU(item, baseConfig);
    expect(args[args.length - 1]).toBe(item.saida);
  });

  test("arquivo de progresso é o penúltimo argumento", () => {
    const item = makeItem();
    const args = buildArgsGPU(item, baseConfig);
    expect(args[args.length - 2]).toBe(item.progressFile);
  });

  test("usa o preset da config", () => {
    const cfg    = { ...baseConfig, preset: "p7" };
    const args   = buildArgsGPU(makeItem(), cfg);
    const preIdx = args.indexOf("-preset");
    expect(args[preIdx + 1]).toBe("p7");
  });

  test("usa o índice de GPU correto", () => {
    const cfg    = { ...baseConfig, gpu: 1 };
    const args   = buildArgsGPU(makeItem(), cfg);
    const gpuIdx = args.indexOf("-gpu");
    expect(args[gpuIdx + 1]).toBe("1");
  });

  test("inclui codec hevc_nvenc", () => {
    const args = buildArgsGPU(makeItem(), baseConfig);
    expect(args).toContain("hevc_nvenc");
  });

  test("aplica -vf quando há filtro (anime + res original)", () => {
    const args   = buildArgsGPU(makeItem(), baseConfig);
    const vfIdx  = args.indexOf("-vf");
    expect(vfIdx).toBeGreaterThanOrEqual(0);
    expect(args[vfIdx + 1]).toContain("hqdn3d");
  });

  test("aplica filtro de escala combinado quando outputRes é 1080p", () => {
    const cfg    = { ...baseConfig, outputRes: "1080p" };
    const args   = buildArgsGPU(makeItem(), cfg);
    const vfIdx  = args.indexOf("-vf");
    expect(args[vfIdx + 1]).toContain("scale=-2:1080:flags=lanczos");
    expect(args[vfIdx + 1]).toContain("hqdn3d");
  });

  test("usa aqStrength correto para perfil liveaction", () => {
    const cfg  = { ...baseConfig, profile: "liveaction" };
    const args = buildArgsGPU(makeItem(), cfg);
    const aqIdx = args.indexOf("-aq-strength");
    expect(args[aqIdx + 1]).toBe("10");
  });

  test("usa aqStrength correto para perfil anime", () => {
    const args  = buildArgsGPU(makeItem(), baseConfig);
    const aqIdx = args.indexOf("-aq-strength");
    expect(args[aqIdx + 1]).toBe("8");
  });

  test("cai para perfil anime quando profile é inválido", () => {
    const cfg  = { ...baseConfig, profile: "desconhecido" };
    const args = buildArgsGPU(makeItem(), cfg);
    expect(args).toContain("hevc_nvenc");
  });
});

// ──────────────────────────────────────────────
//  buildArgsCPU
// ──────────────────────────────────────────────

describe("buildArgsCPU", () => {
  test("usa codec libx265", () => {
    const args = buildArgsCPU(makeItem(), baseConfig);
    expect(args).toContain("libx265");
  });

  test("usa -crf, não -cq", () => {
    const args = buildArgsCPU(makeItem(), baseConfig);
    expect(args).toContain("-crf");
    expect(args).not.toContain("-cq");
  });

  test("inclui -x265-params do perfil", () => {
    const args = buildArgsCPU(makeItem(), baseConfig);
    expect(args).toContain("-x265-params");
  });

  test("usa cpuPreset da config", () => {
    const cfg    = { ...baseConfig, cpuPreset: "slow" };
    const args   = buildArgsCPU(makeItem(), cfg);
    const preIdx = args.indexOf("-preset");
    expect(args[preIdx + 1]).toBe("slow");
  });

  test("caminho de saída é o último argumento", () => {
    const item = makeItem();
    const args = buildArgsCPU(item, baseConfig);
    expect(args[args.length - 1]).toBe(item.saida);
  });

  test("usa cqHD como crf para altura >= 1000", () => {
    const args   = buildArgsCPU(makeItem({ height: 1080 }), baseConfig);
    const crfIdx = args.indexOf("-crf");
    expect(args[crfIdx + 1]).toBe(String(baseConfig.cqHD));
  });

  test("usa cqSD como crf para altura < 1000", () => {
    const args   = buildArgsCPU(makeItem({ height: 720 }), baseConfig);
    const crfIdx = args.indexOf("-crf");
    expect(args[crfIdx + 1]).toBe(String(baseConfig.cqSD));
  });

  test("NÃO inclui -hwaccel cuda", () => {
    const args = buildArgsCPU(makeItem(), baseConfig);
    expect(args).not.toContain("cuda");
  });

  test("inclui x265-params do perfil liveaction", () => {
    const cfg  = { ...baseConfig, profile: "liveaction" };
    const args = buildArgsCPU(makeItem(), cfg);
    const paramIdx = args.indexOf("-x265-params");
    expect(args[paramIdx + 1]).toContain("aq-mode=2");
  });

  test("inclui x265-params do perfil anime", () => {
    const args     = buildArgsCPU(makeItem(), baseConfig);
    const paramIdx = args.indexOf("-x265-params");
    expect(args[paramIdx + 1]).toContain("aq-mode=3");
  });
});

// ──────────────────────────────────────────────
//  buildArgs (dispatcher)
// ──────────────────────────────────────────────

describe("buildArgs", () => {
  test("delega para GPU quando encoder é nvenc", () => {
    const args = buildArgs(makeItem(), { ...baseConfig, encoder: "nvenc" });
    expect(args).toContain("hevc_nvenc");
    expect(args).not.toContain("libx265");
  });

  test("delega para CPU quando encoder é cpu", () => {
    const args = buildArgs(makeItem(), { ...baseConfig, encoder: "cpu" });
    expect(args).toContain("libx265");
    expect(args).not.toContain("hevc_nvenc");
  });
});
