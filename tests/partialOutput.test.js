const fs   = require("fs");
const os   = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { removePartialOutput, isOutputComplete, parseOutputDuration } = require("../src/utils/partialOutput");

// Processo ffmpeg falso: só o que removePartialOutput observa (exitCode + evento close)
const makeProc = (exitCode = null) => Object.assign(new EventEmitter(), { exitCode, signalCode: null });

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "partial-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const writePartial = () => {
  const p = path.join(dir, "ep01_hevc.mkv");
  fs.writeFileSync(p, Buffer.alloc(2 * 1024 * 1024)); // > 1 MB, passaria no filtro antigo
  return p;
};

// ──────────────────────────────────────────────
//  removePartialOutput (backlog #02, camada 1: no PARAR)
// ──────────────────────────────────────────────

describe("removePartialOutput", () => {
  test("apaga a saída parcial só depois que o processo fecha", async () => {
    const saida = writePartial();
    const proc  = makeProc();

    const pending = removePartialOutput(proc, saida, fs);
    expect(fs.existsSync(saida)).toBe(true);   // ainda rodando: handle aberto no Windows

    proc.emit("close", null);
    await expect(pending).resolves.toBe(true);
    expect(fs.existsSync(saida)).toBe(false);
  });

  test("apaga na hora quando o processo já tinha terminado", async () => {
    const saida = writePartial();
    await expect(removePartialOutput(makeProc(1), saida, fs)).resolves.toBe(true);
    expect(fs.existsSync(saida)).toBe(false);
  });

  test("tenta de novo enquanto o arquivo está bloqueado (EBUSY)", async () => {
    const saida = writePartial();
    let blocked = 2;
    const busyFs = {
      unlinkSync: (p) => {
        if (blocked-- > 0) throw Object.assign(new Error("busy"), { code: "EBUSY" });
        fs.unlinkSync(p);
      },
    };

    await expect(removePartialOutput(makeProc(1), saida, busyFs, { delayMs: 1 })).resolves.toBe(true);
    expect(fs.existsSync(saida)).toBe(false);
  });

  test("não lança quando não há saída para apagar", async () => {
    await expect(removePartialOutput(makeProc(1), path.join(dir, "nada.mkv"), fs)).resolves.toBe(false);
  });
});

// ──────────────────────────────────────────────
//  isOutputComplete (backlog #02, camada 2: no scan)
// ──────────────────────────────────────────────

describe("isOutputComplete", () => {
  test("saída com a mesma duração da fonte está completa", () => {
    expect(isOutputComplete(1420.1, 1420.0)).toBe(true);
  });

  test("saída truncada (encode interrompido) está incompleta", () => {
    expect(isOutputComplete(5.2, 1420.0)).toBe(false);
  });

  test("saída sem duração legível está incompleta quando a fonte tem duração", () => {
    expect(isOutputComplete(0, 1420.0)).toBe(false);
  });

  test("sem duração da fonte (ffprobe falhou) não condena a saída", () => {
    expect(isOutputComplete(0, 0)).toBe(true);
  });
});

// ──────────────────────────────────────────────
//  parseOutputDuration (backlog #02, camada 2)
//  Fixtures = JSON real do ffprobe (-show_entries stream_tags=DURATION:format=format_name,duration)
// ──────────────────────────────────────────────

describe("parseOutputDuration", () => {
  // Encode morto aos 3s de uma fonte de 300s: o cabeçalho MKV já diz 300s,
  // mas a tag DURATION do stream só é gravada quando o arquivo é finalizado.
  const killedMkv = {
    streams: [{ tags: {} }],
    format:  { format_name: "matroska,webm", duration: "300.000000" },
  };
  const finishedMkv = {
    streams: [{ tags: { DURATION: "00:00:20.000000000" } }],
    format:  { format_name: "matroska,webm", duration: "20.000000" },
  };

  test("MKV finalizado usa a tag DURATION do stream", () => {
    expect(parseOutputDuration(finishedMkv)).toBeCloseTo(20.0);
  });

  test("MKV interrompido (sem tag DURATION) tem duração 0, mesmo com o cabeçalho dizendo 300s", () => {
    expect(parseOutputDuration(killedMkv)).toBe(0);
  });

  test("lê horas, minutos e frações da tag", () => {
    const mkv = { streams: [{ tags: { DURATION: "01:23:45.500000000" } }], format: { format_name: "matroska,webm" } };
    expect(parseOutputDuration(mkv)).toBeCloseTo(5025.5);
  });

  test("encode interrompido é detectado pela comparação com a fonte", () => {
    expect(isOutputComplete(parseOutputDuration(killedMkv), 300.0)).toBe(false);
  });

  test("JSON vazio (ffprobe não leu o arquivo) dá duração 0", () => {
    expect(parseOutputDuration({})).toBe(0);
  });
});
