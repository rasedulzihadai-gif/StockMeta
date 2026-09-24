# StockMeta — Microstock metadata generator

Content-type-aware titles, keywords and CSVs for **Adobe Stock, Shutterstock, Freepik and iStock**.
DeepSeek is the default provider; Gemini, Anthropic, OpenAI and any OpenAI/Anthropic/Gemini-compatible
gateway can be configured per slot in Settings.

## Run it locally

```bash
npm install
npm run dev          # http://localhost:3000
```

No database required — without `DATABASE_URL` everything is stored in `.data/stockmeta/` (JSON files).
Set `DATABASE_URL` (PostgreSQL) for durable storage; the schema is created automatically on first use.

```bash
npm run build && npm start   # production
bash scripts/run-e2e.sh      # offline end-to-end test (50 checks, needs `npm run build` first)
```

## Uploading files

- **JPEG / PNG / WebP / GIF / SVG / AVIF / BMP** — upload directly. Images are downscaled in your
  browser before upload (1280px analysis copy + 320px thumbnail), so big files are fine.
- **.eps / .ai / .pdf vector sources** — can't be previewed in a browser, so upload the
  **JPEG/PNG/SVG preview with the same base name** (e.g. `design.eps` + `design.jpg`). The two are
  paired automatically and the asset is marked as a vector.
- **HEIC (iPhone) / TIFF / PSD / RAW** — browsers can't decode these on canvas. Convert to JPEG/PNG first;
  the app tells you which file was skipped and why.

## API keys

Settings → expand a provider → paste the key → **Save**. Keys are stored server-side and never sent
back to the browser (only a masked preview like `sk-••••cdef` is shown). Keys can also come from
environment variables (`DEEPSEEK_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).

**Test connection** makes one real vision round-trip, so it needs working internet access from the
machine running the app.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| "Couldn't reach api.deepseek.com — … This is a network problem, NOT an API key problem" | The machine running the app has no outbound internet. **Hosted preview sandboxes have no internet** — run the app on your own computer (`npm install && npm run dev`) and add the key there. The key itself is fine. |
| "Storage is temporary …" banner | The filesystem is read-only (e.g. serverless deploy) and data is kept in a temp folder — it survives until restart. Set `DATABASE_URL` for durable storage. |
| Nothing uploads | Check the toast: it names each skipped file and the reason (HEIC/TIFF/PSD unsupported, or vector sources need a same-named raster preview). |
| An .eps/.ai file didn't appear | It's a vector *source* — upload it together with a JPEG/PNG/SVG preview of the same base name. |
| `Test connection` fails with 401 | The API key is wrong/expired. 402 = the provider account has no balance. |

### সংক্ষেপে (বাংলা)

- **API key দেওয়ার পরেও "Couldn't reach …" এরর দেখালে** — key-এর সমস্যা না, ওই সার্ভারের ইন্টারনেট নেই।
  অ্যাপটি নিজের কম্পিউটারে চালান: `npm install` → `npm run dev` → http://localhost:3000 → Settings → key দিন।
- **Preview/হোস্টেড স্যান্ডবক্সে Generate/Test কাজ করবে না** (ইন্টারনেট নেই), কিন্তু আপলোড ও অন্য সব ফিচার কাজ করবে।
- **.eps/.ai ফাইল আসলেই হাওয়া** — এগুলো ভেক্টর সোর্স; একই নামের JPEG/PNG প্রিভিউ-র সাথে একসাথে আপলোড করুন (যেমন `design.eps` + `design.jpg`)।
- **iPhone-এর ছবি (HEIC) আপলোড হয় না** — আগে JPEG-এ কনভার্ট করুন।

## Architecture

- **Next.js 16** app router, React 19, Tailwind 4, drizzle-orm.
- Storage: PostgreSQL (`DATABASE_URL`) or a local JSON store — same code path, chosen at runtime.
- Provider adapters (`src/lib/server/adapters.ts`): OpenAI Chat Completions, Anthropic Messages and
  Gemini generateContent wire formats, with retry/backoff and typed error codes.
- Validation layer (`src/lib/validation.ts`): enforces per-platform title/keyword/category rules
  (A–K) and auto-fixes what it can; every change is listed in the UI.
