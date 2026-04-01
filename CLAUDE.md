# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start                # roda o app Electron em modo desenvolvimento
npm test                 # roda todos os testes (Jest)
npm run test:watch       # modo watch — ideal para TDD
npm run test:cover       # testes + relatório de cobertura
npm run build            # gera instalador .exe em dist/
```

**Rodar um arquivo de teste específico:**
```bash
npx jest tests/ffmpegArgs.test.js
npx jest tests/ffmpegArgs.test.js -t "buildVF"   # filtrar por nome de teste
```

**Requisitos de sistema** (não instalados via npm):
- `ffmpeg` e `ffprobe` no PATH
- GPU NVIDIA com NVENC (GTX 900+ / RTX) — opcional, há fallback CPU

## Arquitetura

### Processo Electron
O app usa o modelo padrão Electron com isolamento de contexto:

- **`main.js`** — processo principal Node.js. Orquestra ffprobe (scan), pool de jobs ffmpeg, leitura de progresso e comunicação com o renderer via IPC.
- **`preload.js`** — bridge IPC segura: expõe métodos selecionados ao renderer via `contextBridge`, sem `nodeIntegration`.
- **`index.html`** — processo renderer com React 18 via CDN e Babel standalone (sem bundler/build step). Todo o código UI está em `<script>` inline.

### Módulos extraídos (testáveis)

A lógica de negócio foi extraída de `main.js` para módulos em `src/utils/` para permitir testes unitários:

| Módulo | Conteúdo |
|---|---|
| `src/utils/ffmpegArgs.js` | `buildArgs`, `buildArgsGPU`, `buildArgsCPU`, `buildVF` — monta os argumentos CLI do ffmpeg. Recebe `config` como parâmetro explícito (não fecha sobre variável de módulo). |
| `src/utils/formatters.js` | `fmtBitrate` (formata kbps/Mbps), `runParallel` (pool async com concorrência limitada) |
| `src/utils/progressParser.js` | `parseProgressFile` — lê o arquivo de progresso do ffmpeg. Aceita `fsModule` como parâmetro opcional para injeção em testes. |

`main.js` importa esses módulos e passa `config` explicitamente nos call sites. A variável `config` (estado do módulo) permanece em `main.js`.

### Fluxo de dados IPC

```
Renderer (index.html)
  └─ window.electronAPI.*        ← exposto pelo preload via contextBridge
       ├─ invoke: select-folder, select-output-folder, scan-folder, get-config
       └─ send:   set-config, start-conversion, stop-conversion, retry-errors, open-log-folder

main.js → renderer (eventos push):
  log, file-status, slot-update, slot-clear, stats, conversion-done,
  scan-progress, reset-converting, config-loaded, output-folder-changed
```

### Pool de jobs e pipeline de encode

`main.js` mantém um pool de até 3 slots (`slots = {}`). Cada slot roda um processo `ffmpeg` filho. O ciclo é: `fillSlots()` → `startSlot()` → processo ffmpeg → `finishSlot()` → `fillSlots()`.

Um `setInterval` de 800ms (`pollProgress`) lê o arquivo de progresso temporário de cada slot (gerado via `-progress <file>` no ffmpeg) e envia atualizações ao renderer.

### Config persistida

`loadConfig()` / `saveConfig()` usam um JSON em `app.getPath("userData")/config.json`. Os defaults estão em `loadConfig`. O objeto `config` é mutado in-place pelos handlers IPC e salvo imediatamente.

### Testes

Os testes ficam em `tests/`. O mock do Electron está em `tests/__mocks__/electron.js` e é carregado automaticamente via `moduleNameMapper` no `jest.config.js` — isso impede o crash de `app.getPath()` ao importar o módulo fora do processo Electron.

Padrão de injeção nos testes:
- `ffmpegArgs`: passa `config` como objeto literal (ex: `buildArgs(item, { ...baseConfig, encoder: "cpu" })`)
- `progressParser`: passa `makeMockFs(content)` como segundo argumento
- `formatters`: funções puras, sem setup necessário
