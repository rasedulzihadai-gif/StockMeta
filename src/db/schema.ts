import { boolean, customType, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Issue, MetadataResult, UsageInfo } from "@/lib/types";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/** One row per provider slot — each slot is configured independently. */
export const providerSettings = pgTable("provider_settings", {
  id: text("id").primaryKey(),
  apiKey: text("api_key"),
  baseUrl: text("base_url"),
  model: text("model"),
  wireFormat: text("wire_format"),
  enabled: boolean("enabled").notNull().default(true),
  options: jsonb("options").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  activeProviderId: text("active_provider_id").notNull().default("deepseek"),
  platforms: jsonb("platforms").$type<string[]>().notNull().default(["adobe", "shutterstock", "freepik", "istock"]),
  defaultHint: text("default_hint").notNull().default("auto"),
  concurrency: integer("concurrency").notNull().default(3),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    filename: text("filename").notNull(),
    width: integer("width").notNull().default(0),
    height: integer("height").notNull().default(0),
    hint: text("hint").notNull().default("auto"),
    status: text("status").notNull().default("pending"),
    error: text("error"),
    providerId: text("provider_id"),
    model: text("model"),
    result: jsonb("result").$type<MetadataResult>(),
    rawResult: jsonb("raw_result").$type<unknown>(),
    issues: jsonb("issues").$type<Issue[]>().notNull().default([]),
    fileType: text("file_type"),
    vectorCompanion: text("vector_companion"),
    usage: jsonb("usage").$type<UsageInfo>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("assets_created_idx").on(t.createdAt)],
);

/** Image bytes live in their own table so list queries never touch them. */
export const assetImages = pgTable("asset_images", {
  assetId: uuid("asset_id")
    .primaryKey()
    .references(() => assets.id, { onDelete: "cascade" }),
  mime: text("mime").notNull().default("image/jpeg"),
  thumb: bytea("thumb").notNull(),
  analysis: bytea("analysis").notNull(),
});
