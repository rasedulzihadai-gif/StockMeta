// Word lists shared by the system prompt (so the model sees the same pools)
// and by the validation layer (so the same pools are enforced).

export const COLOR_WORDS = [
  "red", "crimson", "scarlet", "burgundy", "maroon", "pink", "rose", "magenta", "fuchsia", "coral",
  "salmon", "peach", "orange", "amber", "yellow", "gold", "golden", "lime", "green", "mint", "olive",
  "emerald", "sage", "teal", "turquoise", "aqua", "cyan", "blue", "navy", "azure", "cobalt", "indigo",
  "violet", "purple", "lavender", "lilac", "plum", "brown", "beige", "tan", "cream", "ivory", "khaki",
  "black", "white", "gray", "grey", "silver", "charcoal", "pastel", "neon", "monochrome", "colorful",
  "multicolor", "multicolored", "rainbow",
];

export const COLOR_EXAMPLES =
  "blue, navy blue, light blue, teal, turquoise, green, mint, yellow, gold, orange, red, pink, magenta, purple, violet, lavender, brown, beige, black, white, gray, silver, pastel, neon, monochrome";

/** Rule B — general buyer use-case pool. */
export const USE_CASE_POOL = [
  "background", "backdrop", "wallpaper", "banner", "header", "cover", "card", "poster", "flyer",
  "presentation", "website", "web design", "landing page", "social media", "post", "story",
  "advertising", "marketing", "branding", "packaging", "print", "invitation", "greeting card",
  "copy space", "text space", "design element", "template", "screen", "desktop", "mobile",
];

/** Rule I — design-purpose pool for template packs (sits alongside rule B, never instead of it). */
export const DESIGN_PURPOSE_POOL = [
  "template", "poster", "layout", "cover", "flier", "booklet", "banner", "collection", "set",
  "presentation", "mockup", "print", "editable design", "vector template", "business card", "brochure",
];

/** Rule C — filler removed from titles/descriptions (whole-word, case-insensitive). */
export const FILLER_TITLE_TERMS = [
  "beautiful", "amazing", "stunning", "awesome", "gorgeous", "fantastic", "wonderful", "perfect", "best",
  "high quality", "high-quality", "premium quality", "hd", "4k", "8k", "hq", "high resolution",
  "high-resolution", "royalty free", "royalty-free", "stock image", "stock photo",
];

/** Rule C — keywords that are filler when they appear as a whole keyword. */
export const FILLER_KEYWORDS = [
  ...FILLER_TITLE_TERMS,
  "stock", "nice", "great", "unique", "image", "images", "photo", "photos", "photograph", "picture",
  "pictures", "pic", "jpeg", "jpg", "png", "file", "download", "free", "copyright", "generated", "quality",
  "hi res", "hires",
];

/** Rule C — filler words stripped from inside multi-word keywords ("stunning background" → "background"). */
export const FILLER_PHRASE_WORDS = [
  "beautiful", "amazing", "stunning", "awesome", "gorgeous", "fantastic", "wonderful", "hd", "4k", "8k", "hq",
];

/** The filler list shown to the model in rule C. */
export const FILLER_PROMPT_LIST =
  "beautiful, amazing, stunning, awesome, gorgeous, nice, perfect, best, great, fantastic, wonderful, unique, high quality, hd, 4k, 8k, hq, high resolution, stock, image, photo, picture, jpeg, jpg, png, royalty free, free, download";

/** Rule F — software / AI-tool / brand-ish keywords that are always dropped. */
export const IP_TERMS = [
  "photoshop", "adobe photoshop", "illustrator", "adobe illustrator", "adobe", "midjourney", "dall-e",
  "dalle", "stable diffusion", "firefly", "adobe firefly", "chatgpt", "openai", "ai", "ai generated",
  "ai-generated", "generative ai", "ai art", "ai image", "ai generated image",
];

/** Rule F — phrases removed from titles/descriptions. */
export const IP_TITLE_TERMS = [
  "ai generated", "ai-generated", "generative ai", "midjourney", "dall-e", "stable diffusion", "photoshop",
];

export const IP_EXAMPLES = "photoshop, illustrator, midjourney, dall-e, stable diffusion, firefly";

/** Nouns that name a kind of template/collection (rule H). */
export const TEMPLATE_KIND_RE =
  /\b(templates?|sets?|collections?|packs?|bundles?|kits?|layouts?|covers?|posters?|banners?|flyers?|fliers?|brochures?|booklets?|mockups?|cards?|designs?)\b/i;

/** Collection wording that should NOT lead a single-asset title (rule G: one visual). */
export const COLLECTION_WORDING_RE = /\b(templates|set of|sets|collection|pack|bundle|mockups?|layouts)\b/i;
