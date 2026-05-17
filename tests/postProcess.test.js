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
  test("verdict 'ok' quando exit 0, output menor, probe casa duração", async () => {
    const fs = makeMockFs({ "/src/encoded/anime_hevc.mkv": { size: 400_000_000 } });
    const result = await postProcess({
      item: baseItem, exitCode: 0, stderr: "",
      probe: okProbe, fs, path: mockPath,
    });
    expect(result.verdict).toBe("ok");
  });
});
