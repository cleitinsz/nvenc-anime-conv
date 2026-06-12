# Backlog de correções — E2E de 2026-06-12

Achados do teste end-to-end (Playwright + Electron real, GTX 1060, ffmpeg 8.0.1) e da revisão de código da v1.4.0. Evidências (screenshots e drivers) em `.e2e-test/`.

| # | Item | Prioridade | Confirmado ao vivo |
|---|------|-----------|--------------------|
| 01 | [Conversão falha em vídeo sem áudio](01-conversao-falha-sem-audio.md) | 🔴 Crítica | ✅ |
| 02 | [PARAR deixa output parcial que vira "completo"](02-stop-deixa-output-parcial.md) | 🔴 Crítica | ✅ |
| 03 | [Preview com frames invertidos + fidelidade](03-preview-frames-invertidos.md) | 🟠 Alta | parcial |
| 04 | [Menu "Abrir pasta" não faz nada](04-ctx-menu-abrir-pasta-noop.md) | 🟠 Alta | ✅ |
| 05 | [Colisão sufixo × nome de arquivo some com episódios](05-colisao-sufixo-nome-arquivo.md) | 🟠 Alta | ✅ |
| 06 | [HEVC re-encodado sem necessidade com downscale](06-hevc-reencode-downscale.md) | 🟡 Média | ✅ |
| 07 | [Crash se ffmpeg/ffprobe ausente (spawn sem handler)](07-crash-ffmpeg-ausente-spawn-error.md) | 🟠 Alta | código |
| 08 | [Editar preset custom é destrutivo](08-editar-preset-destrutivo.md) | 🟡 Média | código |
| 09 | [Retry durante sessão não preenche slots livres](09-retry-nao-preenche-slots.md) | 🟢 Baixa | código |
| 10 | [Vendorizar React/Babel + CSP](10-vendorizar-react-babel-csp.md) | 🟡 Média | ✅ (warning) |
| 11 | [Arquivos pulados invisíveis na UI](11-arquivos-pulados-invisiveis.md) | 🟡 Média | ✅ |
| 12 | [Boot com lastFolder não re-escaneia](12-boot-lastfolder-sem-rescan.md) | 🟢 Baixa | ✅ |
| 13 | [Renderer: i18n dos listeners + código duplicado + key warning](13-renderer-i18n-e-codigo-duplicado.md) | 🟢 Baixa | ✅ (warning) |
| 14 | [ESPAÇO SALVO mostra "0.00 GB" em sessões pequenas](14-espaco-salvo-formatacao-mb.md) | 🟢 Baixa | ✅ |
| 15 | [Miscelânea: perf do pollProgress + chaves órfãs no config](15-miscelanea-perf-e-config.md) | 🟢 Baixa | parcial |

Ordem sugerida de ataque: 01 → 02 → 03 → 04 (fixes de poucas linhas, maior impacto), depois 05/07 (robustez), e o resto conforme oportunidade.
