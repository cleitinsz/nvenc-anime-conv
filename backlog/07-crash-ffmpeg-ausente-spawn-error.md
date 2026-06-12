# Crash do main process se ffmpeg/ffprobe não estiver no PATH

**Prioridade:** 🟠 Alta (primeira experiência de usuário sem ffmpeg = crash) · **Confirmado:** por inspeção de código

## Problema

Nenhum `cp.spawn` do projeto registra handler para o evento `error`:

- `ffprobeAll` — `main.js` ~144 (spawn de `ffprobe`)
- `startSlot` — `main.js` ~404 (spawn de `ffmpeg`)
- `preview-generate` — `main.js` ~733, ~780, ~789 (3 spawns de `ffmpeg`)

Se o binário não existe no PATH (ENOENT), o ChildProcess emite `error`; evento `error` sem listener em EventEmitter vira **exceção não capturada e derruba o main process** — o app fecha sem mensagem. Como ffmpeg/ffprobe são pré-requisitos não instalados pelo app, esse é o primeiro cenário de um usuário novo.

## Problemas relacionados (agrupados aqui)

- **`ffprobeAll` sem timeout:** um ffprobe pendurado (arquivo em rede/drive dormindo) trava o slot do scan paralelo para sempre. Adicionar timeout (ex.: 30s) com `proc.kill()` e resolve com metadados vazios.
- O `resolve` do `ffprobeAll` só acontece no `close`; com handler de `error` adicionado, garantir que também resolva nesse caso (senão o scan trava aguardando a Promise).

## Correção proposta

1. Handler de `error` em todos os spawns: logar via `log("ERRO", ...)`, marcar o arquivo como erro/resolver a Promise — nunca deixar sem listener.
2. **Checagem de pré-requisito no boot:** ao iniciar (`app.whenReady`), rodar `ffmpeg -version` / `ffprobe -version`; se falhar, mostrar `dialog.showErrorBox` com instrução de instalação em vez de quebrar depois.
3. Timeout no `ffprobeAll`.

## Arquivos

- `main.js` — `ffprobeAll` (~142-168), `startSlot` (~404), `preview-generate` (~733, ~780, ~789), `app.whenReady` (~115)
