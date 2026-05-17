const { BUILTIN_PRESETS, PRESET_FIELDS } = require("../src/utils/presets");

describe("BUILTIN_PRESETS", () => {
  test("tem exatamente 10 entradas", () => {
    expect(BUILTIN_PRESETS).toHaveLength(10);
  });

  test("todos têm IDs únicos", () => {
    const ids = BUILTIN_PRESETS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("todos têm os 9 campos de PRESET_FIELDS preenchidos", () => {
    for (const p of BUILTIN_PRESETS) {
      for (const f of PRESET_FIELDS) {
        expect(p.fields[f]).toBeDefined();
      }
    }
  });

  test("todos usam valores válidos para profile/encoder/outputRes/preset/cpuPreset", () => {
    const validProfile   = ["anime", "liveaction"];
    const validEncoder   = ["nvenc", "cpu"];
    const validOutputRes = ["original", "1080p", "720p", "480p"];
    const validPreset    = ["p4", "p5", "p6", "p7"];
    const validCpuPreset = ["faster", "fast", "medium", "slow", "slower"];
    for (const p of BUILTIN_PRESETS) {
      expect(validProfile).toContain(p.fields.profile);
      expect(validEncoder).toContain(p.fields.encoder);
      expect(validOutputRes).toContain(p.fields.outputRes);
      expect(validPreset).toContain(p.fields.preset);
      expect(validCpuPreset).toContain(p.fields.cpuPreset);
      expect(typeof p.fields.cqHD).toBe("number");
      expect(typeof p.fields.cqSD).toBe("number");
      expect(typeof p.fields.jobs).toBe("number");
      expect(typeof p.fields.sufixo).toBe("string");
    }
  });
});

const { applyPreset } = require("../src/utils/presets");

describe("applyPreset", () => {
  const preset = BUILTIN_PRESETS[0];  // anime-1080p
  const baseConfig = {
    profile: "liveaction", encoder: "cpu", outputRes: "720p",
    cqHD: 22, cqSD: 20, preset: "p4", cpuPreset: "slow",
    jobs: 1, sufixo: "_old",
    outputFolder: "/tmp/foo", lang: "en", lastFolder: "/tmp/bar",
    deletarOriginal: true, gpu: 1,
  };

  test("aplica os 9 campos do preset no config", () => {
    const result = applyPreset(preset, baseConfig);
    for (const f of PRESET_FIELDS) {
      expect(result[f]).toBe(preset.fields[f]);
    }
  });

  test("preserva campos NÃO cobertos pelo preset", () => {
    const result = applyPreset(preset, baseConfig);
    expect(result.outputFolder).toBe("/tmp/foo");
    expect(result.lang).toBe("en");
    expect(result.lastFolder).toBe("/tmp/bar");
    expect(result.deletarOriginal).toBe(true);
    expect(result.gpu).toBe(1);
  });

  test("não muta o config de entrada", () => {
    const snapshot = JSON.parse(JSON.stringify(baseConfig));
    applyPreset(preset, baseConfig);
    expect(baseConfig).toEqual(snapshot);
  });
});

const { isPresetActive } = require("../src/utils/presets");

describe("isPresetActive", () => {
  const preset = BUILTIN_PRESETS[0];

  test("retorna true quando todos os 9 campos batem", () => {
    const config = { ...preset.fields, lang: "ptBR", outputFolder: "/tmp" };
    expect(isPresetActive(preset, config)).toBe(true);
  });

  test("retorna false quando 1 campo diverge", () => {
    const config = { ...preset.fields, cqHD: 30 };
    expect(isPresetActive(preset, config)).toBe(false);
  });
});
