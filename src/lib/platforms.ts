import type { PlatformId } from "./types";

export interface PlatformSpec {
  id: PlatformId;
  label: string;
  short: string;
  /** Which field acts as the buyer-facing title on this platform. */
  titleField: "title" | "description";
  titleLabel: string;
  /** Real ceiling used by rule G (and by rule H for template packs). */
  titleMax: number;
  /** The platform's own hard limit. */
  titleHardMax: number;
  /** Secondary description field (iStock only). */
  descriptionMax?: number;
  keywordsMin: number;
  keywordsTarget: number;
  keywordsMax: number;
}

export const PLATFORM_SPECS: Record<PlatformId, PlatformSpec> = {
  adobe: {
    id: "adobe",
    label: "Adobe Stock",
    short: "Adobe",
    titleField: "title",
    titleLabel: "Title",
    titleMax: 70,
    titleHardMax: 200,
    keywordsMin: 5,
    keywordsTarget: 30,
    keywordsMax: 49,
  },
  shutterstock: {
    id: "shutterstock",
    label: "Shutterstock",
    short: "Shutterstock",
    titleField: "description",
    titleLabel: "Description",
    titleMax: 200,
    titleHardMax: 200,
    keywordsMin: 7,
    keywordsTarget: 30,
    keywordsMax: 50,
  },
  freepik: {
    id: "freepik",
    label: "Freepik",
    short: "Freepik",
    titleField: "title",
    titleLabel: "Title",
    titleMax: 70,
    titleHardMax: 100,
    keywordsMin: 5,
    keywordsTarget: 20,
    keywordsMax: 50,
  },
  istock: {
    id: "istock",
    label: "iStock / Getty",
    short: "iStock",
    titleField: "title",
    titleLabel: "Title",
    titleMax: 100,
    titleHardMax: 100,
    descriptionMax: 200,
    keywordsMin: 5,
    keywordsTarget: 25,
    keywordsMax: 50,
  },
};

/** Adobe Stock category numbers used in the CSV "Category" column. */
export const ADOBE_CATEGORIES: Record<number, string> = {
  1: "Animals",
  2: "Buildings and Architecture",
  3: "Business",
  4: "Drinks",
  5: "The Environment",
  6: "States of Mind",
  7: "Food",
  8: "Graphic Resources",
  9: "Hobbies and Leisure",
  10: "Industry",
  11: "Landscapes",
  12: "Lifestyle",
  13: "People",
  14: "Plants and Flowers",
  15: "Culture and Religion",
  16: "Science",
  17: "Social Issues",
  18: "Sports",
  19: "Technology",
  20: "Transport",
  21: "Travel",
};

/** Shutterstock's fixed category list (CSV accepts 1–2, comma separated). */
export const SHUTTERSTOCK_CATEGORIES = [
  "Abstract",
  "Animals/Wildlife",
  "Arts",
  "Backgrounds/Textures",
  "Beauty/Fashion",
  "Buildings/Landmarks",
  "Business/Finance",
  "Celebrities",
  "Education",
  "Food and drink",
  "Healthcare/Medical",
  "Holidays",
  "Industrial",
  "Interiors",
  "Miscellaneous",
  "Nature",
  "Objects",
  "Parks/Outdoor",
  "People",
  "Religion",
  "Science",
  "Signs/Symbols",
  "Sports/Recreation",
  "Technology",
  "Transportation",
  "Vintage",
] as const;

export const ADOBE_FILENAME_CAP = 30;

export const ISTOCK_CV_CAVEAT =
  "iStock/Getty maps every keyword to its controlled vocabulary (CV). Keywords that don't match a CV term are dropped or need disambiguation in the contributor portal after upload — review them there before submitting.";
