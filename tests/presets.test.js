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
