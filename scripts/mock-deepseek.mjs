// Local stand-in for https://api.deepseek.com/v1 used ONLY for the offline e2e test.
// It speaks the OpenAI Chat Completions wire format, enforces the Bearer key, logs every
// request, and returns realistic "raw model" answers — the template answer deliberately
// contains mistakes (editable text, Backgrounds/Textures, over-long title, filler, dupes)
// so the strict validation layer can be exercised. It does NOT do real vision.
import http from "node:http";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const KEY = "sk-mock-123";
const LOG = "/tmp/mock-requests.jsonl";
const SAMPLES = {
  single: readFileSync("public/samples/single-background.jpg").toString("base64"),
  template: readFileSync("public/samples/template-pack.jpg").toString("base64"),
};
writeFileSync(LOG, "");

const SINGLE_RAW = {
  content_type: "single_asset",
  description: "Smooth gradient backdrop blending deep navy blue, violet and warm pink with a soft glow and fine grain.",
  platforms: {
    adobe: {
      title: "Navy blue and violet gradient background with soft pink glow",
      keywords: [
        "gradient", "background", "navy blue", "violet", "pink", "blue", "purple", "abstract", "smooth", "glow",
        "backdrop", "wallpaper", "banner", "presentation", "website", "social media", "copy space", "cover", "header",
        "card", "soft", "blur", "modern", "minimal", "dreamy", "calm", "night", "twilight", "dusk", "ombre",
        "color", "grain", "light", "vibrant", "design element", "empty", "stunning", "backgrounds", "poster", "screen",
      ],
      category: 8,
    },
    shutterstock: {
      description: "Smooth navy blue, violet and pink gradient background with a soft glow and subtle grain for banners, presentations and web headers.",
      keywords: [
        "gradient", "background", "navy blue", "violet", "pink", "blue", "purple", "abstract", "smooth", "glow",
        "backdrop", "wallpaper", "banner", "presentation", "website", "social media", "copy space", "cover", "header",
        "card", "soft", "blur", "modern", "minimal", "dreamy", "calm", "night", "twilight", "ombre", "grain",
      ],
      categories: ["Backgrounds/Textures", "Abstract"],
      illustration: true,
    },
    freepik: {
      title: "Navy blue violet and pink gradient background with soft glow",
      keywords: [
        "gradient", "background", "navy blue", "violet", "pink", "blue", "purple", "abstract", "smooth", "glow",
        "backdrop", "wallpaper", "banner", "presentation", "website", "social media", "copy space", "cover", "soft", "blur",
        "modern", "minimal", "dreamy", "ombre",
      ],
    },
    istock: {
      title: "Navy blue and violet gradient background with pink glow",
      description: "Smooth abstract gradient backdrop in navy blue, violet and pink with a soft glow and fine grain, with copy space.",
      keywords: [
        "gradient", "background", "navy blue", "violet", "pink", "blue", "purple", "abstract", "smooth", "glow",
        "backdrop", "wallpaper", "banner", "presentation", "website", "social media", "copy space", "cover", "soft", "blur",
        "modern", "minimal", "dreamy", "night", "twilight", "ombre",
      ],
    },
  },
  category_suggestion: "Backgrounds/Textures",
  flags: [],
};

const TEMPLATE_RAW = {
  content_type: "template_pack",
  description: "Four vertical poster templates with blue to purple gradients featuring flowing wave lines, glossy 3D spheres, a wireframe mesh and geometric bars, with editable text blocks.",
  platforms: {
    adobe: {
      title: "Beautiful blue gradient poster templates set with flowing waves, 3D spheres, mesh grid and geometric bars for covers",
      keywords: [
        "poster", "template", "vector", "layout", "cover", "flier", "blue", "purple", "gradient", "flowing waves",
        "3d spheres", "mesh grid", "geometric bars", "editable text", "banner", "booklet", "collection", "set", "presentation", "print",
        "brochure", "abstract", "modern", "corporate", "business", "annual report", "background", "wallpaper", "digital", "futuristic",
        "technology", "4k", "posters", "templates", "glowing lines", "violet", "design element", "social media", "website", "advertising",
        "marketing", "cover design", "a4", "magazine", "catalog", "event", "flyer", "report", "vertical", "mockup", "sphere",
      ],
      category: "Backgrounds",
    },
    shutterstock: {
      description: "Set of four abstract poster templates with blue and purple gradients, flowing wave lines, glossy 3D spheres, wireframe mesh and geometric bars, editable text for covers and flyers.",
      keywords: [
        "poster", "template", "layout", "cover", "flier", "blue", "purple", "gradient", "waves", "3d spheres",
        "mesh", "geometric", "banner", "booklet", "collection", "set", "presentation", "print", "brochure", "abstract",
        "modern", "corporate", "business", "report", "background", "digital", "technology", "flyer", "magazine", "vector",
      ],
      categories: ["Backgrounds/Textures", "Technology"],
      illustration: true,
    },
    freepik: {
      title: "Blue gradient poster templates with waves, 3D spheres and mesh lines",
      keywords: [
        "poster", "template", "vector template", "layout", "cover", "flier", "blue", "purple", "gradient", "waves",
        "3d spheres", "mesh", "geometric bars", "replaceable text", "banner", "booklet", "collection", "set", "presentation", "print",
        "brochure", "abstract", "modern", "business", "background",
      ],
    },
    istock: {
      title: "Abstract blue gradient poster templates set with waves and spheres",
      description: "Vector collection of four vertical poster layouts with blue purple gradients, flowing lines, 3D spheres, wireframe mesh and geometric bars; editable text headlines.",
      keywords: [
        "poster", "template", "layout", "cover", "flyer", "blue", "purple", "gradient", "wave", "sphere",
        "mesh", "geometric", "banner", "booklet", "collection", "presentation", "print", "brochure", "abstract", "modern",
        "business", "report", "background", "technology", "magazine", "vector",
      ],
    },
  },
  category_suggestion: "Backgrounds/Textures",
  flags: [
    "POSSIBLE_VECTOR: flat fills and crisp geometric edges suggest an AI/EPS source file",
    { code: "CONTAINS_TEXT", message: "Placeholder headline, lorem ipsum body copy and date labels" },
  ],
};

const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content ?? []).filter((p) => p.type === "text").map((p) => p.text).join("\n"));
const send = (res, status, obj) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
};

http
  .createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) return send(res, 404, { error: { message: "not found" } });
      if (req.headers.authorization !== `Bearer ${KEY}`) return send(res, 401, { error: { message: "Authentication Fails (mock)" } });
      const b = JSON.parse(body);
      const system = textOf(b.messages.find((m) => m.role === "system"));
      const users = b.messages.filter((m) => m.role === "user");
      const firstParts = Array.isArray(users[0]?.content) ? users[0].content : [];
      const userText = textOf(users[0]);
      const lastText = textOf(users[users.length - 1]);
      const img = firstParts.find((p) => p.type === "image_url")?.image_url?.url ?? "";
      const b64 = img.split(",")[1] ?? "";
      const which = b64 === SAMPLES.template ? "template" : b64 === SAMPLES.single ? "single" : "other";
      const isRepair = b.messages.some((m) => m.role === "assistant");
      appendFileSync(
        LOG,
        JSON.stringify({
          model: b.model,
          which,
          isRepair,
          imagePrefix: img.slice(0, 23),
          response_format: b.response_format ?? null,
          thinking: b.thinking ?? null,
          temperature: b.temperature ?? null,
          max_tokens: b.max_tokens ?? null,
          systemLength: system.length,
          systemHash: createHash("sha1").update(system).digest("hex").slice(0, 12),
          systemMarkers: ["STEP 1 — CONTENT-TYPE CLASSIFICATION", "G. LITERAL TITLE", "H. COLLECTION-STYLE TITLE", "I. DESIGN-PURPOSE KEYWORDS", "J. VECTOR-TEXT WORDING", "K. FILE-TYPE-AWARE CATEGORY", "SELF-CHECK", "\"content_type\""].filter((m) => system.includes(m)).length,
          userText,
        }) + "\n",
      );
      let content;
      if (userText.includes("Which single color fills this image")) content = JSON.stringify({ ok: true, color: "blue" });
      else if (userText.includes("broken-json-case") && !isRepair) content = 'Sure! Here is the metadata: {"content_type": "single_asset", "platforms": {';
      else if (isRepair && lastText.includes('content_type must be "single_asset"'))
        content = JSON.stringify({ ...SINGLE_RAW, flags: [{ code: "HINT_MISMATCH", message: "Image shows four poster layouts, but the user hint says single background." }] });
      else if (isRepair) content = JSON.stringify(SINGLE_RAW);
      else content = JSON.stringify(which === "template" ? TEMPLATE_RAW : SINGLE_RAW);
      send(res, 200, {
        id: "mock-1",
        object: "chat.completion",
        model: b.model,
        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
        usage: { prompt_tokens: 3100, completion_tokens: 900, total_tokens: 4000 },
      });
    });
  })
  .listen(4010, "127.0.0.1", () => console.log("mock deepseek listening on 127.0.0.1:4010"));
