import { z } from "zod";
import sanitizeHtml from "sanitize-html";

export const starterTags = [
  { slug: "pakistan", name: "پاکستان", legacy_category: "pakistan-news" },
  { slug: "world", name: "دنیا", legacy_category: "international-news" },
  { slug: "sports", name: "کھیل", legacy_category: "sports-news" },
  { slug: "business", name: "کاروبار", legacy_category: "business-news" },
  { slug: "health", name: "صحت", legacy_category: "health-news" },
  { slug: "science", name: "سائنس", legacy_category: "science-news" },
];
export function slugText(value: string) {
  return value.normalize("NFC").toLowerCase().trim().replace(/[^\p{L}\p{M}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
}
export function postSlug(title: string, id: string) {
  const titlePart = Array.from(slugText(title)).slice(0, 80).join("").replace(/-$/, "");
  return `${titlePart || "خبر"}-${id.replaceAll("-", "").slice(-12)}`;
}
export function cleanArticle(value: string) {
  return sanitizeHtml(value, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, "img", "h1", "h2"],
    allowedAttributes: { a: ["href", "title"], img: ["src", "alt", "title"] },
    allowedSchemes: ["http", "https", "mailto"], allowedSchemesByTag: { img: ["https"] },
    allowProtocolRelative: false,
  });
}
export const tagSchema = z.object({
  name: z.string().trim().min(1).max(80).transform(value => value.normalize("NFC")),
  slug: z.string().min(1).max(100).regex(/^[\p{L}\p{N}][\p{L}\p{M}\p{N}-]*$/u).optional(),
}).strict();
export const tagRenameSchema = tagSchema.pick({ name: true });
export const postSchema = z.object({
  title: z.string().trim().min(1).max(500),
  article: z.string().trim().min(1).max(100_000),
  thumbnailImage: z.url().max(2000).refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "res.cloudinary.com" && !url.username && !url.password && !url.search && !url.hash;
  }, "Use an uploaded news thumbnail."),
  tags: z.array(z.uuid()).min(1).max(10).refine(value => new Set(value).size === value.length, "Duplicate labels are not allowed."),
  status: z.enum(["draft", "published"]).default("draft"),
}).strict();
export const postUpdateSchema = postSchema.extend({ version: z.number().int().positive() }).strict();
export const feedSchema = z.object({
  skip: z.coerce.number().int().min(0).max(1_000_000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  tag: z.string().trim().min(1).max(100).optional(),
  category: z.string().trim().min(1).max(100).optional(),
  query: z.string().trim().min(1).max(100).optional(),
}).strict();
export function isNewsImage(value: string, cloudName?: string) {
  if (!cloudName) return false;
  const url = new URL(value);
  return url.origin === "https://res.cloudinary.com" &&
    new RegExp(`^/${cloudName}/image/upload/v[0-9]+/96news/posts/[a-zA-Z0-9_-]+[.]webp$`).test(url.pathname);
}
