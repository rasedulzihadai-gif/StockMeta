// End-to-end test through the real HTTP API (run against `next start` + scripts/mock-deepseek.mjs).
// Verifies: DeepSeek default + registry, request wire format, content-type handling for both
// genuine sample images, rules A–K via the validation layer, repair path, hint enforcement,
// file-type decisions, CSV formats and the acceptance self-test. Cleans up afterwards.
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
async function j(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, data: text };
  }
}
function jpegSize(buf) {
  let o = 2;
  while (o < buf.length) {
    if (buf[o] !== 0xff) { o++; continue; }
    const m = buf[o + 1];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
    o += 2 + buf.readUInt16BE(o + 2);
  }
  return { w: 0, h: 0 };
}
async function upload(file, name, hint = "auto") {
  const bytes = readFileSync(`public/samples/${file}`);
  const { w, h } = jpegSize(bytes);
  const fd = new FormData();
  fd.append("filename", name);
  fd.append("width", String(w));
  fd.append("height", String(h));
  fd.append("hint", hint);
  fd.append("analysis", new Blob([bytes], { type: "image/jpeg" }), "a.jpg");
  fd.append("thumb", new Blob([bytes], { type: "image/jpeg" }), "t.jpg");
  const res = await fetch(BASE + "/api/assets", { method: "POST", body: fd });
  return (await res.json()).asset;
}
const allKeywords = (r) => Object.values(r.platforms).flatMap((p) => p.keywords);
const allText = (r) => [r.description, ...Object.values(r.platforms).flatMap((p) => [p.title, p.description].filter(Boolean)), ...allKeywords(r)].join(" | ");

// ---------- 0. registry & defaults ----------
let r = await j("GET", "/api/providers");
check("DeepSeek is the default-selected provider", r.data.activeProviderId === "deepseek", r.data.activeProviderId);
const ds = r.data.providers.find((p) => p.id === "deepseek");
check(
  "DeepSeek registry entry (openai-chat-completions · api.deepseek.com/v1 · deepseek-flash)",
  ds?.defaultBaseUrl === "https://api.deepseek.com/v1" && ds?.defaultModel === "deepseek-flash" && ds?.wireFormat === "openai-chat-completions" && ds?.isDefault,
  `${ds?.defaultBaseUrl} · ${ds?.defaultModel} · ${ds?.wireFormat}`,
);
const others = ["gemini", "anthropic", "openai", "xkiro", "vyce", "helyx", "agentrouter", "seekai"];
check("Every other provider slot is still in the registry", others.every((id) => r.data.providers.some((p) => p.id === id)), r.data.providers.map((p) => p.id).join(", "));
const home = await fetch(BASE + "/");
const html = await home.text();
check("Home page renders with DeepSeek pre-selected", home.status === 200 && html.includes("DeepSeek") && html.includes("StockMeta"), `HTTP ${home.status}`);

// ---------- 1. point the DeepSeek slot at the local mock ----------
r = await j("PUT", "/api/providers/deepseek", { apiKey: "sk-mock-123", baseUrl: "http://127.0.0.1:4010/v1" });
check("DeepSeek slot configured and ready", r.data.provider?.ready === true, r.data.provider?.readyReason ?? "ready");
check("API key is never echoed back to the browser", !JSON.stringify(r.data).includes("sk-mock-123"), r.data.provider?.keyPreview);
r = await j("POST", "/api/providers/deepseek/test");
check("Connection test — vision round-trip", r.data.ok === true, r.data.reply ?? r.data.error);

// ---------- 2. upload the genuine sample images ----------
const single = await upload("single-background.jpg", "single-background.jpg");
const template = await upload("template-pack.jpg", "abstract-blue-poster-templates-collection-01.jpg");
const broken = await upload("single-background.jpg", "broken-json-case.jpg");
const hinted = await upload("template-pack.jpg", "hint-override.jpg", "single_asset");
check("Uploads stored", [single, template, broken, hinted].every((a) => a?.id), [single, template, broken, hinted].map((a) => a?.filename).join(", "));

const gen = {};
for (const [k, a] of Object.entries({ single, template, broken, hinted })) {
  const g = await j("POST", `/api/assets/${a.id}/generate`, {});
  gen[k] = g.data.asset;
}

// ---------- 3. single background → rules A–G ----------
const S = gen.single.result;
console.log("\n[single] adobe title:", S?.platforms.adobe.title);
check("single → classified single_asset", S?.content_type === "single_asset");
check("single → literal title kept (≤70, names colors)", S?.platforms.adobe.title.length <= 70 && /blue|violet|pink/i.test(S?.platforms.adobe.title), `${S?.platforms.adobe.title.length} chars`);
check("single → filler removed (rule C: 'stunning')", !allKeywords(S).includes("stunning"));
check("single → singular/plural dupes removed (rule C: 'backgrounds')", !S.platforms.adobe.keywords.includes("backgrounds"));
check("single → Backgrounds/Textures category kept (K not applied)", S.platforms.shutterstock.categories.includes("Backgrounds/Textures") && S.category_suggestion === "Backgrounds/Textures", S.platforms.shutterstock.categories.join(","));
check("single → no rule H–K rewrites happened", !gen.single.issues.some((i) => ["H", "J", "K"].includes(i.rule) && i.level === "fixed"), gen.single.issues.map((i) => i.rule).join(","));

// ---------- 4. template pack → rules A–F + H–K ----------
const T = gen.template.result;
console.log("[template] adobe title:", T?.platforms.adobe.title);
console.log("[template] adobe first 12 keywords:", T?.platforms.adobe.keywords.slice(0, 12).join(", "));
check("template → classified template_pack", T?.content_type === "template_pack");
check("template → category_suggestion = Graphic Resources (rule K)", T?.category_suggestion === "Graphic Resources", T?.category_suggestion);
check("template → Adobe category 8 (rule K)", T?.platforms.adobe.category === 8);
check("template → Shutterstock: no Backgrounds/Textures, Abstract first (rule K)", T.platforms.shutterstock.categories[0] === "Abstract" && !T.platforms.shutterstock.categories.includes("Backgrounds/Textures"), T.platforms.shutterstock.categories.join(","));
check("template → Adobe/Freepik titles ≤70 (H keeps G limits)", T.platforms.adobe.title.length <= 70 && T.platforms.freepik.title.length <= 70, `${T.platforms.adobe.title.length} / ${T.platforms.freepik.title.length}`);
const els = (T.platforms.adobe.title.toLowerCase().split(/\bwith\b/)[1] ?? "").split(/,|\band\b/).filter((s) => s.trim()).length;
check("template → title lists 2–4 contained elements (rule H)", els >= 2 && els <= 4, `${els} elements`);
check("template → 'editable text' swapped to 'replaceable text' everywhere (rule J)", !/editable (text|headline|font)/i.test(allText(T)) && /replaceable text/.test(allText(T)));
check("template → 'replaceable text' keyword on every platform (rule J)", Object.values(T.platforms).every((p) => p.keywords.includes("replaceable text")));
check("template → design-purpose keywords present (rule I)", ["poster", "template", "layout", "cover", "flier"].every((k) => T.platforms.adobe.keywords.includes(k)));
check("template → colors kept alongside (rule A)", ["blue", "purple"].every((k) => T.platforms.adobe.keywords.includes(k)));
check("template → filler + dupes removed, ≤49 Adobe keywords (C/E)", !T.platforms.adobe.keywords.includes("4k") && !T.platforms.adobe.keywords.includes("posters") && T.platforms.adobe.keywords.length <= 49, `${T.platforms.adobe.keywords.length} keywords`);
check("template → POSSIBLE_VECTOR + CONTAINS_TEXT flags normalized", ["POSSIBLE_VECTOR", "CONTAINS_TEXT"].every((c) => T.flags.some((f) => f.code === c)));
check("template → 'vertical' kept (posters are vertical inside a landscape sheet)", T.platforms.adobe.keywords.includes("vertical"));

// ---------- 5. repair + hint enforcement ----------
check("invalid JSON → one repair turn → valid result", gen.broken.status === "done" && gen.broken.issues.some((i) => i.rule === "REPAIR"), gen.broken.status);
check("hint single_asset on a template image → hint enforced via repair", gen.hinted.result?.content_type === "single_asset" && gen.hinted.result.flags.some((f) => f.code === "HINT_MISMATCH"), gen.hinted.result?.content_type);

// ---------- 6. file-type confirmation ----------
r = await j("PATCH", `/api/assets/${template.id}`, { fileType: "raster" });
const R = r.data.asset?.result;
check("raster confirmation strips vector wording (rule D)", R && !allKeywords(R).some((k) => /\bvector\b/.test(k)) && !/^vector/i.test(R.platforms.istock.description), R?.platforms.istock.description.slice(0, 40));
r = await j("PATCH", `/api/assets/${template.id}`, { fileType: "vector" });
check("vector confirmation → Shutterstock Illustration = Yes", r.data.asset?.result.platforms.shutterstock.illustration === true && r.data.asset?.fileType === "vector");
r = await j("PATCH", `/api/assets/${single.id}`, { result: { ...S, platforms: { ...S.platforms, adobe: { ...S.platforms.adobe, title: "Beautiful " + S.platforms.adobe.title } } } });
check("user edits are re-validated but never rewritten", r.data.asset?.result.platforms.adobe.title.startsWith("Beautiful") && r.data.asset.issues.some((i) => i.rule === "C" && i.level === "warning"));

// ---------- 7. CSV exports ----------
const ids = [single.id, template.id];
const ex = {};
for (const p of ["adobe", "shutterstock", "freepik", "istock"]) ex[p] = (await j("POST", "/api/export", { platform: p, ids })).data;
const lines = (p) => ex[p].content.trim().split("\n");
console.log("\n[adobe csv]\n" + lines("adobe").join("\n").slice(0, 400));
check("Adobe CSV header + double quotes", lines("adobe")[0] === "Filename,Title,Keywords,Category,Releases" && lines("adobe")[1].startsWith('"single-background.jpg","'));
const tplRow = lines("adobe").find((l) => l.includes("abstract-blue"));
const cappedName = tplRow?.split('","')[0].replace(/^"/, "");
check("Adobe 30-char filename cap + warning", cappedName && cappedName.length <= 30 && cappedName.endsWith(".jpg") && ex.adobe.warnings.some((w) => w.includes("30-character")), cappedName);
check("Shutterstock CSV header + categories + Illustration", lines("shutterstock")[0] === "Filename,Description,Keywords,Categories,Illustration,Mature Content,Editorial" && lines("shutterstock").some((l) => l.includes('"Abstract,Technology","Yes","No","No"')));
check("Freepik CSV semicolon + single quotes", lines("freepik")[0] === "File name;Title;Keywords;Prompt;Model" && lines("freepik")[1].startsWith("'single-background.jpg';'"), lines("freepik")[1]?.slice(0, 60));
check("iStock CSV header + controlled-vocabulary caveat", lines("istock")[0] === "file name,created date,description,country,brief code,title,keywords" && ex.istock.warnings.some((w) => w.includes("controlled vocabulary")));

// ---------- 8. acceptance self-test endpoint ----------
r = await j("POST", "/api/selftest", {});
const cs = (id) => r.data.cases?.find((c) => c.id === id);
const chk = (c, id, key) => c?.[key].find((x) => x.id === id)?.pass;
check("selftest: single sample → single_asset, PASS", cs("single")?.modelContentType === "single_asset" && cs("single")?.ok, cs("single")?.error ?? "");
check("selftest: template sample → template_pack, PASS", cs("template")?.modelContentType === "template_pack" && cs("template")?.ok);
check("selftest: raw vs final scored separately (raw category wrong → fixed)", chk(cs("template"), "k_category", "rawChecks") === false && chk(cs("template"), "k_category", "finalChecks") === true);
check("selftest: raw 'editable text' caught, final uses 'replaceable text'", chk(cs("template"), "j_replaceable", "rawChecks") === false && chk(cs("template"), "j_replaceable", "finalChecks") === true);

// ---------- 9. wire format actually sent to DeepSeek ----------
const reqs = readFileSync("/tmp/mock-requests.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l));
const meta = reqs.filter((x) => !x.userText.includes("Which single color"));
check("requests use model deepseek-flash", reqs.every((x) => x.model === "deepseek-flash"), [...new Set(reqs.map((x) => x.model))].join(","));
check("image sent as OpenAI image_url data URL", meta.every((x) => x.imagePrefix === "data:image/jpeg;base64,"));
check("JSON mode + thinking disabled", meta.every((x) => x.response_format?.type === "json_object" && x.thinking?.type === "disabled"));
check("system prompt identical on every call (prefix-cache friendly) and contains all branches", new Set(meta.map((x) => x.systemHash)).size === 1 && meta.every((x) => x.systemMarkers === 8), `${meta.length} calls · ${meta[0]?.systemLength} chars`);
check("hint travels in the user message", meta.some((x) => x.userText.includes("content_type_hint: single_asset")) && meta.some((x) => x.userText.includes("content_type_hint: auto")));
check("selftest uses neutral filenames", meta.some((x) => x.userText.includes("filename: sample-2.jpg")) && !meta.some((x) => x.userText.includes("filename: template-pack.jpg")));

// ---------- 10. image endpoints used by the virtualized list ----------
const thumb = await fetch(`${BASE}/api/assets/${single.id}/thumb`);
const preview = await fetch(`${BASE}/api/assets/${template.id}/image`);
check("thumbnail + preview endpoints serve cached JPEGs", thumb.status === 200 && preview.status === 200 && thumb.headers.get("content-type") === "image/jpeg" && /immutable/.test(thumb.headers.get("cache-control") ?? ""));
const missing = await fetch(`${BASE}/api/assets/not-a-uuid/thumb`);
check("invalid asset id → 404 (no DB error)", missing.status === 404);

// ---------- cleanup ----------
await j("DELETE", "/api/assets", { all: true });
await j("PUT", "/api/providers/deepseek", { apiKey: null, baseUrl: null });
const after = await j("GET", "/api/providers");
check("cleanup: DeepSeek slot reset to defaults", after.data.providers.find((p) => p.id === "deepseek")?.baseUrl === "https://api.deepseek.com/v1");

const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
