# Visual Comparison Slider — Before/After Preview

## Context

Currently the app converts anime videos with NVENC H.265 and applies filters (hqdn3d denoise, gradfun debanding) for anime profiles. Users have no way to visually validate the result before committing to a full encode. They must wait for the entire conversion to finish, only then noticing if quality is not as expected.

This spec adds a visual before/after comparison feature inspired by Upscayl's comparison slider, allowing users to:

- Validate filter impact (line preservation, banding reduction)
- Compare original vs converted frame at a chosen timestamp
- Adjust timestamp dynamically before generating preview
- Choose between frame-single view, fullscreen, and 1:1 zoom

## Design

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  [×]  Comparação Visual — episode01.mkv              [?]   │
│─────────────────────────────────────────────────────────────│
│                                                             │
│   Timestamp: [====●=====] 30%  (0:04:32)                    │
│                                                             │
│   ┌──────────────────────────────────────────────────┐     │
│   │                                                  │     │
│   │      ORIGINAL          │         CONVERTIDO      │     │
│   │                        │                         │     │
│   │     (frame original)   ║   (frame convertido)   │     │
│   │                        │                         │     │
│   └──────────────────────────────────────────────────┘     │
│                                                             │
│   ◄═══════════●═════════════════════════════════►         │
│   Original                              Convertido          │
│                                                             │
│   [Frame único]  [Tela cheia]  [Zoom 1:1]                   │
│                                                             │
│   Status: Gerando preview... ████░░░░░░ 40%                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Components

| Component | Responsibility |
|---|---|
| `ComparisonModal` | Modal container — open/close state, selected file reference, view mode |
| `ComparisonSlider` | Horizontal slider — two stacked images, clip-path based divider, drag handle |
| `TimestampSelector` | Range slider to pick reference point (0–100% of video duration) |
| `ViewModeToggle` | Button group: frame-single / fullscreen / zoom-1:1 |
| `useComparison` (hook) | Manages preview generation state (idle/generating/done/error), frame data lifecycle |
| `PreviewGenerator` (main process) | Runs FFmpeg commands to produce excerpt and extract frames |

### States

| State | UI |
|---|---|
| `idle` | File name displayed, timestamp slider active, "Gerar Preview" button |
| `generating` | Progress bar with stage label ("Gerando excerpt..." → "Extraindo frames...") |
| `done` | ComparisonSlider visible with both frames, view mode buttons active |
| `error` | Error message + "Tentar novamente" button |

### View Modes

- **Frame único**: slider horizontal padrão, imagens com `object-fit: contain`
- **Tela cheia**: modal expandido para 90% viewport, mesma lógica de slider
- **Zoom 1:1**: imagens em resolução nativa sem scale, container com overflow scroll

### Preview Generation Flow

1. User clicks "Comparar" on a file (context menu or button)
2. `ComparisonModal` opens in `idle` state
3. User adjusts timestamp slider (0–100%)
4. User clicks "Gerar Preview" → state becomes `generating`
5. Background (main process):
   - Run `ffmpeg -ss <timestamp> -i <input> -vframes 1 <temp>/preview_orig_<id>.png`
   - Run `ffmpeg -ss <timestamp> -t 10 -c:v libx265 -crf <cq> -vf <filters> <input> <temp>/preview_<id>.mkv`
   - Run `ffmpeg -ss 5 -i <temp>/preview_<id>.mkv -vframes 1 <temp>/preview_conv_<id>.png`
6. Main sends `preview-done` with base64 or file paths to renderer
7. State becomes `done`, `ComparisonSlider` renders frames

### Non-Blocking Constraint

Preview generation runs in a separate isolated process — does NOT consume job slots. Conversion continues uninterrupted. Only one preview can be generated at a time.

### Files and Cleanup

Frames stored in `os.tmpdir()` as `preview_orig_<id>.png` and `preview_conv_<id>.png`. Excerpt stored as `preview_<id>.mkv`. All cleaned on modal close.

## IPC Channels

| Channel | Direction | Payload |
|---|---|---|
| `preview-generate` | renderer → main | `{ fullPath, timestampPct, config }` |
| `preview-progress` | main → renderer | `{ stage: string, pct: number }` |
| `preview-done` | main → renderer | `{ frameOrig: base64, frameConv: base64 }` |
| `preview-error` | main → renderer | `{ message: string }` |

## UI Integration

- "Comparar" option added to file list context menu (right-click on any file row)
- Context menu item: `{ icon: "🔍", label: "Comparar visual", action: openPreviewModal }`
- Modal does not replace file list — opens as overlay
- Settings panel and file list remain interactive while modal is open

## Technical Notes

- Preview config uses same `encoder`, `profile`, `cq`, `preset` as the main config
- For CPU encoder, excerpt uses libx265 with configured `cpuPreset` and CRF value
- For NVENC, excerpt uses NVENC H.265 with configured `preset` and CQ value
- Filter chain (hqdn3d, gradfun for anime or none for liveaction) preserved exactly
- Image format: PNG for quality (no compression artifacts)

## Verification Criteria

1. Modal opens and timestamp slider allows 0–100% selection
2. "Gerar Preview" triggers FFmpeg in background without freezing UI
3. Progress bar shows stage and percentage during generation
4. Slider divider can be dragged smoothly to reveal before/after
5. View mode buttons switch between frame-single, fullscreen, zoom-1:1
6. Preview generation does not block conversion slots or job pool
7. Context menu "Comparar" option appears for all file row types (queue, done, error)
8. Cleanup of temp files occurs on modal close
9. Error state shows message and retry option if FFmpeg fails