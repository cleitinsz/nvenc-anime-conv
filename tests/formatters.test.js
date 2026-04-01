const { fmtBitrate, runParallel } = require("../src/utils/formatters");

describe("fmtBitrate", () => {
  test("retorna string vazia para null", () => {
    expect(fmtBitrate(null)).toBe("");
  });
  test("retorna string vazia para N/A", () => {
    expect(fmtBitrate("N/A")).toBe("");
  });
  test("formata kbps abaixo de 1000", () => {
    expect(fmtBitrate("512")).toBe("512 kbps");
  });
  test("formata Mbps no limiar de 1000", () => {
    expect(fmtBitrate("1000")).toBe("1.0 Mbps");
  });
  test("formata Mbps acima de 1000", () => {
    expect(fmtBitrate("5500")).toBe("5.5 Mbps");
  });
  test("arredonda kbps abaixo de 1000", () => {
    expect(fmtBitrate("750.7")).toBe("751 kbps");
  });
  test("retorna string vazia para undefined", () => {
    expect(fmtBitrate(undefined)).toBe("");
  });
});

describe("runParallel", () => {
  test("executa todas as tarefas e retorna resultados em ordem", async () => {
    const tasks = [
      () => Promise.resolve(1),
      () => Promise.resolve(2),
      () => Promise.resolve(3),
    ];
    const results = await runParallel(tasks, 2);
    expect(results).toEqual([1, 2, 3]);
  });

  test("respeita concorrência: no máximo N tarefas simultâneas", async () => {
    let activeCount = 0;
    let peakActive  = 0;
    const makeTask = () => async () => {
      activeCount++;
      peakActive = Math.max(peakActive, activeCount);
      await new Promise(r => setTimeout(r, 10));
      activeCount--;
    };
    const tasks = Array.from({ length: 6 }, makeTask);
    await runParallel(tasks, 2);
    expect(peakActive).toBe(2);
  });

  test("chama onProgress após cada tarefa concluída", async () => {
    const calls = [];
    const tasks = [() => Promise.resolve(), () => Promise.resolve()];
    await runParallel(tasks, 2, (done, total) => calls.push({ done, total }));
    expect(calls).toHaveLength(2);
    expect(calls[calls.length - 1].total).toBe(2);
  });

  test("lida com array vazio de tarefas", async () => {
    const results = await runParallel([], 4);
    expect(results).toEqual([]);
  });

  test("funciona com concorrência maior que o número de tarefas", async () => {
    const tasks = [() => Promise.resolve("a"), () => Promise.resolve("b")];
    const results = await runParallel(tasks, 10);
    expect(results).toEqual(["a", "b"]);
  });
});
