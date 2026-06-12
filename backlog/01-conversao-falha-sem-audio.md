# Conversão falha em vídeo sem trilha de áudio

**Prioridade:** 🔴 Crítica · **Confirmado ao vivo:** sim (E2E 2026-06-12)

## Problema

Qualquer arquivo de vídeo **sem trilha de áudio** falha na conversão com erro do ffmpeg, tanto no caminho GPU quanto CPU. Causa: `-map 0:a:0` é obrigatório (sem o sufixo `?`), enquanto legendas já usam o opcional `0:s?`.

## Evidência

Mesmo comando, mesma máquina (ffmpeg 8.0.1):

- Arquivo **com** áudio → exit 0, converte normal.
- Arquivo **sem** áudio → `Failed to set value '0:a:0' for option 'map': Invalid argument` → exit ≠ 0 → arquivo marcado como ERRO na UI.

Reproduzido no E2E com `ep06_tiny.mp4` (gerado com `-an`).

## Correção proposta

Em `src/utils/ffmpegArgs.js`, trocar `"0:a:0"` por `"0:a:0?"` nos dois builders:

- `buildArgsGPU` — linha ~54: `args.push("-i", item.fullPath, "-map", "0:v:0", "-map", "0:a:0", "-map", "0:s?")`
- `buildArgsCPU` — linha ~90: mesmo padrão

Atualizar os testes em `tests/ffmpegArgs.test.js` que asserem os args de map.

## Arquivos

- `src/utils/ffmpegArgs.js` (fix)
- `tests/ffmpegArgs.test.js` (asserts)
