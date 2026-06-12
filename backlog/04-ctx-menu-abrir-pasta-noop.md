# Menu de contexto "Abrir pasta" não faz nada

**Prioridade:** 🟠 Alta (feature visível quebrada) · **Confirmado ao vivo:** sim (E2E 2026-06-12)

## Problema

O item "Abrir pasta" do menu de contexto da lista de arquivos chama:

```js
{icon:"📂", label:t("ctxOpenFolder"), action:()=>window.api?.openPath?.(file.dir)}
```

(`index.html` ~1097). Mas o `preload.js` **não expõe `openPath`** — verificado em runtime: `typeof window.api.openPath === "undefined"`. O optional chaining engole o erro e o clique não faz nada, sem feedback.

## Correção proposta

1. `preload.js`: expor `openPath: (p) => ipcRenderer.send("open-path", p)`.
2. `main.js`: registrar `ipcMain.on("open-path", (_, p) => shell.openPath(p))` — ou `shell.showItemInFolder(fullPath)` para já destacar o arquivo (provavelmente melhor UX; nesse caso passar `file.fullPath` no renderer em vez de `file.dir`).
3. Validar o caminho recebido antes de abrir (existe? é diretório/arquivo esperado?) — handler IPC não deve abrir caminho arbitrário sem checagem.

Já existe padrão análogo no código: `open-quarantine-folder` usa `shell.showItemInFolder` (`main.js` ~700).

## Arquivos

- `preload.js`
- `main.js` (novo handler IPC)
- `index.html` — `ctxItems` (~1094-1100)
