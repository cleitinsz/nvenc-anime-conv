# Colisão sufixo × nome de arquivo faz episódios sumirem do scan

**Prioridade:** 🟠 Alta (silencioso e provável em releases reais) · **Confirmado ao vivo:** sim (E2E 2026-06-12)

## Problema

O scan exclui qualquer arquivo cujo nome-base termina com o sufixo configurado (`main.js` ~246: `if (base.endsWith(sufixo)) continue;`) — a intenção é pular os próprios outputs. Mas nomes de release de anime frequentemente terminam em `_720p`, `_1080p` etc., que são exatamente os sufixos dos presets built-in ("Anime 720p" → `_720p`, "Anime 4K→1080p" → `_1080p`, "Mobile 480p" → `_mobile`...).

Resultado: com o preset "Anime 720p" ativo, um arquivo fonte `Show_ep01_720p.mkv` **desaparece do scan sem nenhum aviso** — não entra na fila, não aparece como ignorado, simplesmente não existe para o app.

## Evidência

E2E: com sufixo `_720p` ativo, `ep01_720p.mp4` sumiu da listagem ("4 arquivos" em vez de 5). Caso de borda extra: sufixo vazio (`""`) faria `endsWith("")` ser sempre true → **todos** os arquivos seriam excluídos.

## Correção proposta

Opções (da mais simples à mais robusta):

1. **Mínima:** só excluir pelo sufixo se existir o arquivo-fonte correspondente ao lado (ex.: `Show_ep01_720p.mkv` só é tratado como output se `Show_ep01.mkv`/`.mp4`/... existir na mesma pasta de origem esperada). Resolve o caso comum.
2. **Robusta:** marcar outputs de forma explícita — gravar uma tag de metadado no container na hora do encode (ex.: `-metadata comment=nvenc-anime-conv` já vai no ffmpeg) e o scan checar a tag via o ffprobe que já roda por arquivo. Custo zero de chamadas extras.
3. **Guard-rail:** rejeitar sufixo vazio em `set-config`/presets.

A opção 2 também beneficia o item 02 do backlog (validação de parciais).

## Arquivos

- `main.js` — `walk()` dentro de `scan-folder` (~243-249), handler `set-config`
- `src/utils/ffmpegArgs.js` — se for adotada a tag de metadado
- `src/utils/presets.js` — validação de `sufixo`
