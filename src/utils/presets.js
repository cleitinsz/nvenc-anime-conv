const PRESET_FIELDS = [
  "profile", "encoder", "outputRes", "cqHD", "cqSD",
  "preset", "cpuPreset", "jobs", "sufixo",
];

const BUILTIN_PRESETS = [
  { id: "builtin:anime-1080p", builtin: true, icon: "🎌",
    name:        { ptBR: "Anime 1080p", en: "Anime 1080p" },
    description: { ptBR: "Padrão para a maioria dos animes (NVENC)",
                   en: "Default for most anime (NVENC)" },
    fields: { profile: "anime", encoder: "nvenc", outputRes: "original",
              cqHD: 28, cqSD: 26, preset: "p6", cpuPreset: "medium",
              jobs: 2, sufixo: "_hevc" } },

  { id: "builtin:anime-720p", builtin: true, icon: "🎌",
    name:        { ptBR: "Anime 720p", en: "Anime 720p" },
    description: { ptBR: "Mais economia de espaço",
                   en: "More storage savings" },
    fields: { profile: "anime", encoder: "nvenc", outputRes: "720p",
              cqHD: 26, cqSD: 24, preset: "p6", cpuPreset: "medium",
              jobs: 2, sufixo: "_720p" } },

  { id: "builtin:anime-4k-to-1080p", builtin: true, icon: "🎌",
    name:        { ptBR: "Anime 4K → 1080p", en: "Anime 4K → 1080p" },
    description: { ptBR: "Downscale de fontes 4K",
                   en: "Downscale 4K sources" },
    fields: { profile: "anime", encoder: "nvenc", outputRes: "1080p",
              cqHD: 28, cqSD: 26, preset: "p6", cpuPreset: "medium",
              jobs: 2, sufixo: "_1080p" } },

  { id: "builtin:anime-archive", builtin: true, icon: "💾",
    name:        { ptBR: "Anime arquivo (CPU)", en: "Anime archive (CPU)" },
    description: { ptBR: "Máxima qualidade, lento",
                   en: "Max quality, slow" },
    fields: { profile: "anime", encoder: "cpu", outputRes: "original",
              cqHD: 20, cqSD: 18, preset: "p6", cpuPreset: "slower",
              jobs: 1, sufixo: "_archive" } },

  { id: "builtin:live-1080p", builtin: true, icon: "🎬",
    name:        { ptBR: "Live-action 1080p", en: "Live-action 1080p" },
    description: { ptBR: "Filmes e séries",
                   en: "Movies and series" },
    fields: { profile: "liveaction", encoder: "nvenc", outputRes: "original",
              cqHD: 26, cqSD: 24, preset: "p6", cpuPreset: "medium",
              jobs: 2, sufixo: "_hevc" } },

  { id: "builtin:live-720p", builtin: true, icon: "🎬",
    name:        { ptBR: "Live-action 720p", en: "Live-action 720p" },
    description: { ptBR: "Filmes menores",
                   en: "Smaller movies" },
    fields: { profile: "liveaction", encoder: "nvenc", outputRes: "720p",
              cqHD: 24, cqSD: 22, preset: "p6", cpuPreset: "medium",
              jobs: 2, sufixo: "_720p" } },

  { id: "builtin:live-archive", builtin: true, icon: "💾",
    name:        { ptBR: "Live-action arquivo (CPU)", en: "Live-action archive (CPU)" },
    description: { ptBR: "Preservar grain cinematográfico",
                   en: "Preserve cinematic grain" },
    fields: { profile: "liveaction", encoder: "cpu", outputRes: "original",
              cqHD: 19, cqSD: 18, preset: "p6", cpuPreset: "slower",
              jobs: 1, sufixo: "_archive" } },

  { id: "builtin:preview-quick", builtin: true, icon: "⚡",
    name:        { ptBR: "Pré-visualização rápida", en: "Quick preview" },
    description: { ptBR: "Teste rápido antes de batch grande",
                   en: "Fast test before large batch" },
    fields: { profile: "anime", encoder: "nvenc", outputRes: "720p",
              cqHD: 32, cqSD: 30, preset: "p4", cpuPreset: "medium",
              jobs: 3, sufixo: "_preview" } },

  { id: "builtin:storage-saver", builtin: true, icon: "💾",
    name:        { ptBR: "Storage saver", en: "Storage saver" },
    description: { ptBR: "Máxima compressão (lento)",
                   en: "Max compression (slow)" },
    fields: { profile: "anime", encoder: "cpu", outputRes: "original",
              cqHD: 28, cqSD: 26, preset: "p6", cpuPreset: "slower",
              jobs: 1, sufixo: "_min" } },

  { id: "builtin:mobile-480p", builtin: true, icon: "📱",
    name:        { ptBR: "Mobile 480p", en: "Mobile 480p" },
    description: { ptBR: "Para assistir no celular",
                   en: "For watching on phone" },
    fields: { profile: "anime", encoder: "nvenc", outputRes: "480p",
              cqHD: 26, cqSD: 24, preset: "p6", cpuPreset: "medium",
              jobs: 2, sufixo: "_mobile" } },
];

function applyPreset(preset, currentConfig) {
  return { ...currentConfig, ...preset.fields };
}

function isPresetActive(preset, currentConfig) {
  return PRESET_FIELDS.every(f => preset.fields[f] === currentConfig[f]);
}

function findActivePreset(currentConfig, allPresets) {
  const sorted = [...allPresets].sort((a, b) => (b.builtin ? 1 : 0) - (a.builtin ? 1 : 0));
  for (const p of sorted) {
    if (isPresetActive(p, currentConfig)) return p;
  }
  return null;
}

function generateCustomId() {
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  const block = (len) => Array.from({ length: len }, hex).join("");
  return `custom:${block(8)}-${block(4)}-4${block(3)}-${block(4)}-${block(12)}`;
}

function getLocaleField(preset, field, lang) {
  const v = preset[field];
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    if (v[lang]) return v[lang];
    if (v.ptBR)  return v.ptBR;
    if (v.en)    return v.en;
    const firstKey = Object.keys(v)[0];
    if (firstKey) return v[firstKey];
  }
  return "";
}

module.exports = { PRESET_FIELDS, BUILTIN_PRESETS, applyPreset, isPresetActive, findActivePreset, generateCustomId, getLocaleField };
