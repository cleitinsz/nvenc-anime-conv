const { postProcess } = require("../src/utils/postProcess");

const makeMockFs = (initial = {}) => {
  const files = { ...initial };
  return {
    files,
    statSync: jest.fn((p) => {
      if (!(p in files)) { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; }
      return { size: files[p].size };
    }),
    unlinkSync: jest.fn((p) => { delete files[p]; }),
    renameSync: jest.fn((from, to) => { files[to] = files[from]; delete files[from]; }),
    mkdirSync:  jest.fn(),
  };
};

const mockPath = require("path").posix; // determinístico

const okProbe = jest.fn(async () => ({
  codec: "hevc", height: 1080, duracao: 1200, bitrate: 2500000,
}));

const baseItem = {
  fullPath: "/src/anime.mkv",
  saida:    "/src/encoded/anime_hevc.mkv",
  size:     1_000_000_000,    // 1 GB original
  duracao:  1200,             // 20 min
  attempts: 0,
};

describe("postProcess", () => {
  beforeEach(() => okProbe.mockClear());

  test("verdict 'ok' quando exit 0", async () => {
    const fs = makeMockFs({ "/src/encoded/anime_hevc.mkv": { size: 400_000_000 } });
    const result = await postProcess({
      item: baseItem, exitCode: 0, stderr: "",
      probe: okProbe, fs, path: mockPath,
    });
    expect(result.verdict).toBe("ok");
  });

  test("verdict 'no_gain' quando output >= source size", async () => {
    const fs = makeMockFs({ "/src/encoded/anime_hevc.mkv": { size: 1_100_000_000 } });
    const result = await postProcess({
      item: baseItem, exitCode: 0, stderr: "",
      probe: okProbe, fs, path: mockPath,
    });
    expect(result.verdict).toBe("no_gain");
    expect(result.reason).toBe("output_>=_source");
    expect(result.suppressDelete).toBe(true);
    expect(fs.unlinkSync).toHaveBeenCalledWith("/src/encoded/anime_hevc.mkv");
  });

  test("'no_gain' curto-circuita probe (não chama ffprobe)", async () => {
    const probeMock = jest.fn();
    const fs = makeMockFs({ "/src/encoded/anime_hevc.mkv": { size: 1_500_000_000 } });
    await postProcess({
      item: baseItem, exitCode: 0, stderr: "",
      probe: probeMock, fs, path: mockPath,
    });
    expect(probeMock).not.toHaveBeenCalled();
  });

  test("verdict 'quarantine' quando duração diverge > 2s da source", async () => {
    const fs = makeMockFs({ "/src/encoded/anime_hevc.mkv": { size: 400_000_000 } });
    const badProbe = jest.fn(async () => ({
      codec: "hevc", height: 1080, duracao: 1190, bitrate: 2500000,  // -10s vs source
    }));
    const result = await postProcess({
      item: baseItem, exitCode: 0, stderr: "",
      probe: badProbe, fs, path: mockPath,
    });
    expect(result.verdict).toBe("quarantine");
    expect(result.reason).toBe("duration_mismatch");
    expect(result.suppressDelete).toBe(true);
    expect(result.quarantinePath).toBeDefined();
  });

  test("aceita output quando item.duracao===0 e probe.duracao > 0 (fallback)", async () => {
    const fs = makeMockFs({ "/src/encoded/anime_hevc.mkv": { size: 400_000_000 } });
    const item = { ...baseItem, duracao: 0 };
    const result = await postProcess({
      item, exitCode: 0, stderr: "",
      probe: okProbe, fs, path: mockPath,
    });
    expect(result.verdict).toBe("ok");
  });

  test("'quarantine' com reason 'no_video_stream' quando probe.height = 0", async () => {
    const fs = makeMockFs({ "/src/encoded/anime_hevc.mkv": { size: 400_000_000 } });
    const probe = jest.fn(async () => ({ codec: "", height: 0, duracao: 1200, bitrate: 0 }));
    const result = await postProcess({
      item: baseItem, exitCode: 0, stderr: "",
      probe, fs, path: mockPath,
    });
    expect(result.verdict).toBe("quarantine");
    expect(result.reason).toBe("no_video_stream");
  });

  test("'quarantine' com reason 'zero_bitrate' quando probe.bitrate = 0", async () => {
    const fs = makeMockFs({ "/src/encoded/anime_hevc.mkv": { size: 400_000_000 } });
    const probe = jest.fn(async () => ({ codec: "hevc", height: 1080, duracao: 1200, bitrate: 0 }));
    const result = await postProcess({
      item: baseItem, exitCode: 0, stderr: "",
      probe, fs, path: mockPath,
    });
    expect(result.verdict).toBe("quarantine");
    expect(result.reason).toBe("zero_bitrate");
  });

  test("quarentena cria diretório '_quarantine' com recursive: true", async () => {
    const fs = makeMockFs({ "/src/encoded/anime_hevc.mkv": { size: 400_000_000 } });
    const probe = jest.fn(async () => ({ codec: "hevc", height: 0, duracao: 1200, bitrate: 0 }));
    await postProcess({
      item: baseItem, exitCode: 0, stderr: "",
      probe, fs, path: mockPath,
    });
    expect(fs.mkdirSync).toHaveBeenCalledWith("/src/encoded/_quarantine", { recursive: true });
  });

  test("quarentena move o arquivo via renameSync", async () => {
    const fs = makeMockFs({ "/src/encoded/anime_hevc.mkv": { size: 400_000_000 } });
    const probe = jest.fn(async () => ({ codec: "hevc", height: 0, duracao: 1200, bitrate: 0 }));
    await postProcess({
      item: baseItem, exitCode: 0, stderr: "",
      probe, fs, path: mockPath,
    });
    expect(fs.renameSync).toHaveBeenCalledWith(
      "/src/encoded/anime_hevc.mkv",
      "/src/encoded/_quarantine/anime_hevc.mkv"
    );
  });
});
