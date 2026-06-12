# Editar preset custom é destrutivo e tem efeitos colaterais

**Prioridade:** 🟡 Média · **Confirmado:** por inspeção de código

## Problema

`handleEditPreset` (`index.html` ~1824) implementa "editar nome/ícone/descrição" como:

```js
await window.api.applyPreset(target.id);        // 1. muda a config ATIVA do app!
await window.api.deletePreset(target.id);       // 2. deleta o preset
await window.api.savePresetFromConfig(name, …); // 3. recria a partir da config
```

Três problemas:

1. **Efeito colateral:** editar a descrição de um preset troca a configuração ativa do usuário para os campos daquele preset (encoder, CQ, sufixo, jobs...), sem ele pedir.
2. **Perda de dados:** se o passo 3 falhar (nome vazio, erro de IPC, app fechado no meio), o preset já foi deletado no passo 2 — perdido sem volta.
3. O preset recriado ganha **novo id**, invalidando qualquer referência (ex.: `_activePresetId`).

## Correção proposta

Criar um IPC dedicado `update-preset` no `main.js`:

```js
ipcMain.handle("update-preset", (_, { presetId, name, icon, description }) => {
  // localizar em config.customPresets, atualizar APENAS metadados in-place,
  // preservar id e fields, salvar config, emitConfigLoaded()
});
```

Expor no `preload.js` e trocar o `handleEditPreset` para uma chamada única. Sem apply, sem delete, id preservado, operação atômica.

## Arquivos

- `main.js` — novo handler `update-preset` (junto dos demais handlers de preset, ~320-356)
- `preload.js`
- `index.html` — `handleEditPreset` (~1824-1831)
