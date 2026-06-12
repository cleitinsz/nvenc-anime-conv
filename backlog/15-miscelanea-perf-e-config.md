# Miscelânea: pollProgress lê progress file 3× por tick + chaves órfãs no config

**Prioridade:** 🟢 Baixa · **Confirmado:** por inspeção de código (chaves órfãs vistas no config real do usuário)

Dois itens pequenos de manutenção, sem impacto visível para o usuário — agrupados.

## 1. `pollProgress` lê o mesmo arquivo até 3× por slot a cada 800ms

Em `main.js`, dentro do mesmo tick do `pollProgress`:

- ~571: `parseProgressFile(slot.progressFile)` — loop principal dos slots
- ~607: de novo, no cálculo da velocidade média do ETA global
- ~617: de novo, no cálculo do vídeo restante

São 3 leituras síncronas de disco por slot × até 3 slots × ~1,25 ticks/s. Não é gargalo real, mas é trabalho desnecessário no main process (que também atende IPC).

**Fix:** ler uma vez por slot no início do tick (`const progress = {}` mapeando slotId → resultado) e reutilizar nas três etapas.

## 2. Config acumula chaves órfãs de versões antigas

`loadConfig()` (`main.js` ~68-87) faz `{ ...defaults, ...JSON.parse(file) }` — chaves que não existem mais nos defaults sobrevivem para sempre. Config real encontrado durante o E2E continha `theme`, `accent`, `compact` e `tweaks` (objeto inteiro) de versões anteriores.

Inofensivo hoje, mas: (a) cresce indefinidamente; (b) uma chave antiga pode colidir com feature futura de mesmo nome com semântica diferente.

**Fix:** filtrar pelo conjunto de chaves dos defaults ao carregar:

```js
const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const known = Object.fromEntries(
  Object.keys(defaults).map(k => [k, raw[k] !== undefined ? raw[k] : defaults[k]])
);
return known;
```

(O primeiro `saveConfig` após o boot persiste o arquivo já limpo.)

## Arquivos

- `main.js` — `pollProgress` (~566-638), `loadConfig` (~68-87)
