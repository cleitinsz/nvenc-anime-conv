# NVENC Anime Converter — FFmpeg Reference

Arquivo de referência explicando todas as ferramentas externas e argumentos FFmpeg utilizados pelo projeto.

---

## Ferramentas Externas

### ffmpeg

Conversor de mídia multifuncional. Responsável por:
- Decoder do arquivo fonte (H.264, H.265, etc.)
- Aplicação de filtros de vídeo (denoise, debanding, escala)
- Encode final em H.265 via GPU (NVENC) ou CPU (libx265)
- Geração de arquivo de progresso para monitoramento em tempo real

**Instalação:** https://ffmpeg.org/download.html

### ffprobe

Leitor de metadados de arquivos de mídia. Utilizado pelo projeto durante o **scan** da pasta para extrair:
- Resolução (height)
- Duração
- Codec de vídeo
- Streams de áudio e legendas

**Instalação:** Included na mesma suite do ffmpeg.

---

## Encode Profiles

O projeto possui dois perfis de encode otimizados para diferentes tipos de conteúdo:

### Anime (`anime`)

```javascript
{
  vf:         "hqdn3d=1.2:1.2:5:5,gradfun",
  aqStrength: "8",
  x265params: "aq-mode=3:aq-strength=0.8:deblock=-1,-1",
}
```

Filtros aplicados:
- **hqdn3d** — Denoise adaptativo leve (1.2:1.2:5:5). Preserva detalhes de linhas de anime enquanto remove ruído de compressão.
- **gradfun** — Debanding. Remove banding artefactual comum em anime por compressão.

### Live Action (`liveaction`)

```javascript
{
  vf:         null,
  aqStrength: "10",
  x265params: "aq-mode=2:aq-strength=1.0",
}
```

Sem filtros de vídeo. Preserva o grain cinematográfico de live action.

---

## Filtros de Vídeo

### hqdn3d (Denoise)

```
hqdn3d=lumaSpatial=1.2:chromaSpatial=1.2:lumaTemporal=5:chromaTemporal=5
```

- **lumaSpatial / chromaSpatial** — Denoise espacial (por frame). Valores mais altos = mais suavização.
- **lumaTemporal / chromaTemporal** — Denoise temporal (entre frames). Cuidado: valores altos causam ghosting em cenas com movimento.

Valores usados no perfil anime são **leves** (1.2) para não degradar linhas finas características do anime.

### gradfun (Debanding)

```
gradfun
```

Filtro de debanding em 2 passes. Suaviza gradientes com poucas cores (bandaing) sem afetar其余 da imagem.

### Scale (Redimensionamento)

```
scale=-2:1080:flags=lanczos
scale=-2:720:flags=lanczos
```

- `-2` na largura mantém aspect ratio (múltiplo de 2 requerido pelo x265).
- **lanczos** — Algoritmo de interpolação com boa preservação de detalhes comparado a bilinear.

---

## Encoder: GPU NVENC (`hevc_nvenc`)

Usa o hardware de encode da GPU NVIDIA.

### Argumentos Principais

```bash
ffmpeg -y -hwaccel cuda -i input.mkv \
  -map 0:V -map 0:a:0 -map 0:s? \
  -vf "scale=-2:1080:flags=lanczos,hqdn3d=1.2:1.2:5:5,gradfun" \
  -c:v hevc_nvenc \
  -gpu 0 \
  -preset p4 \
  -rc vbr \
  -cq 20 -b:v 0 \
  -spatial-aq 1 -aq-strength 8 \
  -profile:v main10 -pix_fmt p010le \
  -c:a copy -c:s copy -tag:v hvc1 -ignore_unknown \
  -progress progress.txt \
  output.mp4
```

| Argumento | Descrição |
|---|---|
| `-hwaccel cuda` | Aceleração CUDA para decodificação. Desabilitado se filtros de CPU forem usados. |
| `-c:v hevc_nvenc` | Codec H.265 via hardware NVENC. |
| `-gpu 0` | Índice da GPU (0 = principal). |
| `-preset p4` | Qualidade vs velocidade. p4 (rápido) → p7 (lento/melhor). |
| `-rc vbr` | Rate control VBR (variable bitrate). Usa `-cq` para target de qualidade. |
| `-cq 20` | Constant Quality. Menor = melhor qualidade (18–28 typical para anime). |
| `-b:v 0` | Desabilita bitrate médio (VBR usa apenas `-cq`). |
| `-spatial-aq 1` | Adaptive Quantization espacial. Melhora uniformidade em texturas complexas. |
| `-aq-strength 8` | Intensidade do AQ (1–15). Perfil anime usa 8 para manter detalhes. |
| `-profile:v main10` | Perfil H.265 Main 10 (10-bit). Necessário para `p010le`. |
| `-pix_fmt p010le` | Formato de pixel YUV 4:2:0 10-bit. Formato nativo do NVENC. |
| `-tag:v hvc1` | Tag de compatibilidade Apple (H.265 dentro de MP4). |
| `-ignore_unknown` | Ignora streams desconhecidos em vez de falhar. |
| `-progress progress.txt` | Arquivo de progressoupdated a cada frame. |

### Por que 10-bit (Main 10 / p010le)?

Anime encodes tipicamente usam 10-bit mesmo sem conteúdo 10-bit intencional. Reasons:
- Melhor eficiência de compressão com gradientes (menos banding antes mesmo do gradfun)
- gradfun e hqdn3d trabalham melhor em 10-bit
- NVENC hardware suporta nativamente

---

## Encoder: CPU libx265

Fallback para sistemas sem GPU NVIDIA.

### Argumentos Principais

```bash
ffmpeg -y -i input.mkv \
  -map 0:V -map 0:a:0 -map 0:s? \
  -vf "scale=-2:1080:flags=lanczos,hqdn3d=1.2:1.2:5:5,gradfun" \
  -c:v libx265 \
  -preset medium \
  -crf 20 \
  -x265-params "aq-mode=3:aq-strength=0.8:deblock=-1,-1" \
  -pix_fmt yuv420p10le \
  -c:a copy -c:s copy -tag:v hvc1 -ignore_unknown \
  -progress progress.txt \
  output.mp4
```

| Argumento | Descrição |
|---|---|
| `-c:v libx265` | Codec H.265 via software (CPU). |
| `-preset medium` | Preset de encoding. medium → veryfast (mais rápido) ou veryslow (melhor compressão). |
| `-crf 20` | Constant Rate Factor. Menor = melhor qualidade (18–28 typical). |
| `-x265-params` | Parâmetros avançados passados diretamente para x265. |
| `aq-mode=3` | Mode 3 do AQ — variance-aware adaptive quantization. |
| `aq-strength=0.8` | Força do AQ. 0.8 é moderado. |
| `deblock=-1,-1` | Deblocking: -1 = automático. Permite mais ringing em troca de preservamento de detalhes. |
| `-pix_fmt yuv420p10le` | 10-bit YUV 4:2:0 para mesmo motivo do NVENC. |

---

## Mapas de Streams

```
-map 0:V       # Primeira stream de vídeo (todas as tracks de vídeo)
-map 0:a:0     # Primeira track de áudio
-map 0:s?      # Todas as legendas (opcional — o ? permite ausência sem erro)
```

Para anime, isso tipicamente preserva:
- Video principal
- Áudio principal (geralmente japonês)
- Legendas embebidas (ass,srt,etc)

---

## Formato de Progresso

O argumento `-progress progress.txt` gera um arquivo atualizado a cada frame:

```
out_time_ms=1234000
frame=123
fps=47.5
bitrate=4.2M
total_size=524288
speed=1.2x
```

O projeto faz polling desse arquivo a cada 800ms para atualizar a UI com:
- Tempo decorrido
- Frame atual
- FPS de encode
- Bitrate estimado
- Velocidade relative to realtime

---

## Seletor GPU vs CPU

```javascript
function buildArgs(item, config) {
  return config.encoder === "cpu" ? buildArgsCPU(item, config) : buildArgsGPU(item, config);
}
```

- `encoder: "gpu"` → `hevc_nvenc` com argumentos `-gpu`, `-rc vbr`, `-cq`, `-spatial-aq`, `-pix_fmt p010le`
- `encoder: "cpu"` → `libx265` com argumentos `-preset`, `-crf`, `-x265-params`, `-pix_fmt yuv420p10le`
