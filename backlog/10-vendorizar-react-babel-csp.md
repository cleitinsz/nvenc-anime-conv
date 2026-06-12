# Vendorizar React/Babel/fontes + CSP (app não funciona offline)

**Prioridade:** 🟡 Média · **Confirmado ao vivo:** warning de CSP no console; dependência de CDN verificada no código

## Problema

`index.html` carrega do CDN em runtime:

- `react@18` e `react-dom@18` (unpkg, builds de **desenvolvimento**)
- `@babel/standalone` (unpkg) — todo o JSX é recompilado **a cada boot** (custo de segundos)
- Fonte JetBrains Mono (Google Fonts)

Consequências:

1. **Sem internet o app abre uma janela vazia** — nada renderiza, sem mensagem de erro. Para um conversor de arquivos locais, é uma dependência desnecessária.
2. **Supply chain / segurança:** código remoto roda no renderer com acesso à bridge `window.api`. O Electron emite o aviso "Insecure Content-Security-Policy" no console (visto no E2E) — não há CSP definida.
3. **Performance:** React de desenvolvimento + Babel standalone em produção (o próprio Babel alerta no console).

## Correção proposta

Em ordem de esforço:

1. **Mínimo:** baixar react/react-dom (produção) + babel standalone + woff2 da fonte para `vendor/` e referenciar localmente. Adicionar `vendor/` ao `files` do electron-builder.
2. **Ideal:** passo de build (esbuild é o mais simples) que pré-compila o JSX de `index.html` para um `renderer.js` estático — elimina Babel em runtime e permite CSP estrita sem `unsafe-eval`.
3. Adicionar meta CSP no `index.html` (ex.: `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`) — `img-src data:` é necessário para os frames base64 do preview.

## Arquivos

- `index.html` — `<head>` (linhas 6-9) e meta CSP
- `package.json` — `build.files` (+ script de build se for a opção 2)
