const { parseProgressFile } = require("../src/utils/progressParser");

const makeMockFs = (content) => ({
  readFileSync: jest.fn(() => content),
});

describe("parseProgressFile", () => {
  test("retorna null quando fs lança erro (arquivo ausente)", () => {
    const mockFs = { readFileSync: jest.fn(() => { throw new Error("ENOENT"); }) };
    expect(parseProgressFile("/fake/path", mockFs)).toBeNull();
  });

  test("parseia out_time_ms corretamente", () => {
    const content = "out_time_ms=5000000\nfps=24.0\nspeed=1.5x\nbitrate=2000kbps\n";
    const result = parseProgressFile("/fake/path", makeMockFs(content));
    expect(result.out_time_ms).toBe(5000000);
  });

  test("parseia fps como float", () => {
    const content = "out_time_ms=1000\nfps=23.976\nspeed=1x\nbitrate=500kbps\n";
    const result = parseProgressFile("/fake/path", makeMockFs(content));
    expect(result.fps).toBeCloseTo(23.976);
  });

  test("retorna o último valor quando a chave aparece múltiplas vezes (ffmpeg faz append)", () => {
    const content = "fps=10.0\nout_time_ms=1000\nfps=24.0\n";
    const result = parseProgressFile("/fake/path", makeMockFs(content));
    expect(result.fps).toBe(24.0);
  });

  test("retorna zero para out_time_ms quando campo está ausente", () => {
    const result = parseProgressFile("/fake/path", makeMockFs("fps=24.0\n"));
    expect(result.out_time_ms).toBe(0);
  });

  test("retorna zero para fps quando campo está ausente", () => {
    const result = parseProgressFile("/fake/path", makeMockFs("out_time_ms=1000\n"));
    expect(result.fps).toBe(0);
  });

  test("retorna a string de bitrate como está", () => {
    const content = "out_time_ms=1000\nfps=24\nspeed=1x\nbitrate=1500.2kbps\n";
    const result = parseProgressFile("/fake/path", makeMockFs(content));
    expect(result.bitrate).toBe("1500.2kbps");
  });

  test("retorna string vazia para speed quando ausente", () => {
    const result = parseProgressFile("/fake/path", makeMockFs("out_time_ms=1000\nfps=24\n"));
    expect(result.speed).toBe("");
  });

  test("parseia progresso no formato real do ffmpeg (múltiplos blocos)", () => {
    const content = [
      "fps=0.0", "out_time_ms=0", "speed=0x", "bitrate=0kbps", "progress=continue",
      "fps=18.5", "out_time_ms=2000000", "speed=1.2x", "bitrate=3200kbps", "progress=continue",
    ].join("\n");
    const result = parseProgressFile("/fake/path", makeMockFs(content));
    expect(result.fps).toBe(18.5);
    expect(result.out_time_ms).toBe(2000000);
    expect(result.speed).toBe("1.2x");
  });
});
