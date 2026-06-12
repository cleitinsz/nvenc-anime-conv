# Retry durante sessão ativa não preenche slots livres

**Prioridade:** 🟢 Baixa · **Confirmado:** por inspeção de código

## Problema

No handler `retry-errors` (`main.js` ~673-690), quando uma sessão **já está rodando**, os arquivos com erro são apenas adicionados à fila:

```js
} else {
  queue.push(...errorFiles.map(f => ({ ...f, status: "queue" })));
}
```

`fillSlots()` não é chamado. Se houver slots livres (ex.: `jobs=3` mas só 1 encode ativo porque a fila tinha esvaziado), os arquivos re-enfileirados ficam parados até que o encode atual termine e `finishSlot` → `fillSlots` rode.

## Correção proposta

Adicionar `fillSlots();` após o `queue.push(...)` no ramo `else`. (No ramo `if (!running)` o `fillSlots()` já é chamado.)

## Arquivos

- `main.js` — `retry-errors` (~688)
