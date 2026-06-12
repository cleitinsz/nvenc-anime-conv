# Renderer: i18n congelado nos listeners + funções duplicadas + key warning

**Prioridade:** 🟢 Baixa (higiene + i18n parcial) · **Confirmado ao vivo:** key warning no console; demais por código

Três fixes pequenos do `index.html`, mesma área — faz sentido sair num único PR.

## 1. Toasts/log usam o idioma do primeiro render

O `useEffect` que registra os listeners IPC (`index.html` ~1732-1770) tem deps `[addLog, updateFile]` mas usa `t` (e `lang` indiretamente) dentro de `file-status` e `conversion-done`. Como `addLog`/`updateFile` são `useCallback` estáveis, o efeito roda uma vez e os closures capturam o `t` do primeiro render: depois de trocar PT→EN, toasts e a linha de log de sessão continuam em português.

**Fix:** guardar `t` num ref (`const tRef = useRef(t); tRef.current = t;` a cada render) e usar `tRef.current(...)` dentro dos listeners — evita re-registrar listeners a cada troca de idioma.

## 2. `now()` e `etaHorario()` declarados duas vezes dentro de `App`

- `etaHorario`: ~1719 (locale hardcoded `"pt-BR"`) e ~1851 (usa `t("locale")`) — a segunda vence (hoisting), a primeira é código morto.
- `now`: ~1849 (usa `t("locale")`) e ~1863 (hardcoded `"pt-BR"`) — **a hardcoded vence**, então timestamps do log do renderer ficam sempre em formato pt-BR mesmo em EN.

**Fix:** deletar as duplicatas mantendo as versões com `t("locale")`.

## 3. Warning do React: "Each child in a list should have a unique key" em `SettingsPanel`

`optionBtn` (~805) retorna `<button>` sem `key` e é usado dentro de `.map()` em várias seções (perfil, pasta de saída, resolução, presets NVENC/CPU, GPU). Visto no console em todo boot.

**Fix:** aceitar `key` no `optionBtn` (ex.: passar o valor da opção) ou envolver os call sites com `<React.Fragment key=...>`.

## Arquivos

- `index.html` — `App` (~1707-1880), `SettingsPanel`/`optionBtn` (~805-815 e call sites)
