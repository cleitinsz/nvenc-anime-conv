const fs   = require("fs");
const os   = require("os");
const path = require("path");
const { canReveal } = require("../src/utils/revealPath");

// Estrutura real em disco: <tmp>/biblioteca/temporada1/ep01.mkv e <tmp>/fora.txt
let tmp, root, episode, outside;
beforeEach(() => {
  tmp     = fs.mkdtempSync(path.join(os.tmpdir(), "reveal-"));
  root    = path.join(tmp, "biblioteca");
  episode = path.join(root, "temporada1", "ep01.mkv");
  outside = path.join(tmp, "fora.txt");
  fs.mkdirSync(path.dirname(episode), { recursive: true });
  fs.writeFileSync(episode, "");
  fs.writeFileSync(outside, "");
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

// ──────────────────────────────────────────────
//  canReveal (backlog #04: "Abrir pasta" só para arquivos da pasta escaneada)
// ──────────────────────────────────────────────

describe("canReveal", () => {
  test("aceita um arquivo existente dentro da pasta escaneada", () => {
    expect(canReveal(episode, root, fs, path)).toBe(true);
  });

  test("recusa arquivo fora da pasta escaneada", () => {
    expect(canReveal(outside, root, fs, path)).toBe(false);
  });

  test("recusa caminho que sai da pasta com ..", () => {
    expect(canReveal(path.join(root, "..", "fora.txt"), root, fs, path)).toBe(false);
  });

  test("aceita arquivo cujo nome começa com .. (não é sair da pasta)", () => {
    const dotted = path.join(root, "..extra.mkv");
    fs.writeFileSync(dotted, "");
    expect(canReveal(dotted, root, fs, path)).toBe(true);
  });

  test("recusa pasta irmã com prefixo igual (biblioteca-2)", () => {
    const sibling = path.join(tmp, "biblioteca-2", "x.mkv");
    fs.mkdirSync(path.dirname(sibling));
    fs.writeFileSync(sibling, "");
    expect(canReveal(sibling, root, fs, path)).toBe(false);
  });

  test("recusa arquivo que não existe", () => {
    expect(canReveal(path.join(root, "sumiu.mkv"), root, fs, path)).toBe(false);
  });

  test("recusa diretório (o menu revela arquivos)", () => {
    expect(canReveal(path.dirname(episode), root, fs, path)).toBe(false);
  });

  test("recusa caminho relativo ou que não é texto", () => {
    expect(canReveal("temporada1/ep01.mkv", root, fs, path)).toBe(false);
    expect(canReveal(undefined, root, fs, path)).toBe(false);
    expect(canReveal({ toString: () => episode }, root, fs, path)).toBe(false);
  });

  test("recusa tudo antes de qualquer scan (sem pasta escaneada)", () => {
    expect(canReveal(episode, null, fs, path)).toBe(false);
  });
});
