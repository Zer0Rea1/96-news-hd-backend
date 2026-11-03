import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Services } from "./app.js";
import { cleanArticle, feedSchema, isNewsImage, postSchema, postSlug, postUpdateSchema, slugText, tagRenameSchema, tagSchema } from "./news-domain.js";

const reference = z.string().min(1).max(200);
const tagId = z.uuid();
function html(value: string) { return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!); }
export function mountNews(app: Express, services?: Services) {
  const db = services?.db;
  async function feed(query: unknown, drafts = false) {
    const input = feedSchema.parse(query);
    const { data, error } = await db!.rpc("get_news", {
      p_limit: input.limit, p_skip: input.skip, p_tag: input.tag || input.category || null,
      p_query: input.query || null, p_include_drafts: drafts,
    });
    if (error) throw error;
    return data;
  }
  async function getPost(ref: string, drafts = false) {
    const { data, error } = await db!.rpc("get_news_post", { p_reference: ref, p_include_drafts: drafts });
    if (error) throw error;
    return data;
  }
  app.get(["/api/posts", "/api/getpost"], async (req, res, next) => {
    try { res.json(await feed(req.query)); } catch (error) { next(error); }
  });
  app.get("/api/search", async (req, res, next) => {
    try {
      if (!req.query.query) { res.status(400).json({ error: "Enter a search query." }); return; }
      const result = await feed(req.query);
      res.json({ success: true, results: result.posts, totalCount: result.totalCount });
    } catch (error) { next(error); }
  });
  app.get(["/api/posts/:reference", "/api/getpostbyid/:reference"], async (req, res, next) => {
    try {
      const parsed = reference.safeParse(req.params.reference);
      const post = parsed.success ? await getPost(parsed.data) : null;
      if (!post) { res.status(404).json({ error: "Post not found." }); return; }
      res.json({ post, authorname: post.authorname });
    } catch (error) { next(error); }
  });
  app.get("/post/:reference", async (req, res, next) => {
    try {
      const parsed = reference.safeParse(req.params.reference);
      const post = parsed.success ? await getPost(parsed.data) : null;
      if (!post) { res.status(404).send("Post not found."); return; }
      const url = new URL(`/news/${encodeURIComponent(post.slug)}`, process.env.PUBLIC_WEB_ORIGIN || "https://www.96newshd.com").href;
      res.type("html").send(`<!doctype html><html lang="ur" dir="rtl"><head><meta charset="utf-8"><title>${html(post.title)} | 96 News HD | ہر خبر باوثوق</title><link rel="canonical" href="${html(url)}"><meta property="og:title" content="${html(post.title)}"><meta property="og:description" content="${html(post.title.slice(0, 160))}"><meta property="og:image" content="${html(post.thumbnailImage)}"><meta property="og:url" content="${html(url)}"><meta property="og:type" content="article"><meta name="twitter:card" content="summary_large_image"><meta http-equiv="refresh" content="0;url=${html(url)}"></head><body><a href="${html(url)}">خبر پڑھیں</a></body></html>`);
    } catch (error) { next(error); }
  });
  app.get(["/api/tags", "/api/admin/news/tags"], async (req, res, next) => {
    try {
      const { data, error } = await db!.rpc("get_news_tags", { p_include_drafts: req.path.startsWith("/api/admin/") });
      if (error) throw error;
      res.json({ tags: data });
    } catch (error) { next(error); }
  });
  app.get("/api/tags/:slug", async (req, res, next) => {
    try {
      const { data, error } = await db!.rpc("get_news_tags", { p_include_drafts: false });
      if (error) throw error;
      const tag = data.find((item: { slug: string }) => item.slug === req.params.slug);
      if (!tag) { res.status(404).json({ error: "Label not found." }); return; }
      res.json({ tag });
    } catch (error) { next(error); }
  });
  app.get("/api/admin/session", (_req, res) => res.json({ owner: true, user: { id: res.locals.actor.id } }));
  app.get("/api/admin/news/posts", async (req, res, next) => {
    try { res.json(await feed(req.query, true)); } catch (error) { next(error); }
  });
  app.get("/api/admin/news/posts/:reference", async (req, res, next) => {
    try {
      const parsed = reference.safeParse(req.params.reference);
      const post = parsed.success ? await getPost(parsed.data, true) : null;
      if (!post) { res.status(404).json({ error: "Post not found." }); return; }
      res.json({ post });
    } catch (error) { next(error); }
  });
  async function save(action: "create" | "update", req: Request, res: Response) {
    const parsed = action === "create" ? postSchema.parse(req.body) : postUpdateSchema.parse(req.body);
    const id = action === "create" ? randomUUID() : reference.parse(req.params.reference);
    let previous;
    if (action === "update") {
      previous = await getPost(id, true);
      if (!previous) { res.status(404).json({ error: "Post not found." }); return; }
    }
    if (parsed.thumbnailImage !== previous?.thumbnailImage && !isNewsImage(parsed.thumbnailImage, services!.cloudName)) {
      res.status(400).json({ error: "Upload this thumbnail using the news image endpoint." }); return;
    }
    const article = cleanArticle(parsed.article);
    if (!article.replace(/<[^>]*>/g, "").trim()) { res.status(400).json({ error: "Enter article text." }); return; }
    const input = { title: parsed.title, thumbnailImage: parsed.thumbnailImage, tags: parsed.tags, status: parsed.status, article, author_name: "96 نیوز ایچ ڈی", ...(action === "create" ? { slug: postSlug(parsed.title, id) } : {}) };
    const { data, error } = await db!.rpc("mutate_news_post", {
      p_action: action, p_id: previous?.id || id, p_actor_id: res.locals.actor.id,
      p_input: input, p_expected_version: action === "update" ? (parsed as z.infer<typeof postUpdateSchema>).version : null,
    });
    if (error) throw error;
    if (!data) { res.status(404).json({ error: "Post not found." }); return; }
    res.status(action === "create" ? 201 : 200).json({ post: data });
  }
  app.post("/api/admin/news/posts", async (req, res, next) => { try { await save("create", req, res); } catch (error) { next(error); } });
  app.put("/api/admin/news/posts/:reference", async (req, res, next) => { try { await save("update", req, res); } catch (error) { next(error); } });
  app.delete("/api/admin/news/posts/:reference", async (req, res, next) => {
    try {
      const version = z.coerce.number().int().positive().parse(req.get("If-Match")?.replaceAll('"', ""));
      const post = await getPost(reference.parse(req.params.reference), true);
      if (!post) { res.status(404).json({ error: "Post not found." }); return; }
      const { error } = await db!.rpc("mutate_news_post", { p_action: "delete", p_id: post.id, p_actor_id: res.locals.actor.id, p_input: {}, p_expected_version: version });
      if (error) throw error;
      res.status(204).end();
    } catch (error) { next(error); }
  });
  app.post("/api/admin/news/tags", async (req, res, next) => {
    try {
      const input = tagSchema.parse(req.body);
      const slug = input.slug || slugText(input.name);
      if (!slug) { res.status(400).json({ error: "Enter a label containing letters or numbers." }); return; }
      const { data, error } = await db!.from("news_tags").insert({ name: input.name, slug }).select("id,name,slug,legacy_category").single();
      if (error) throw error;
      res.status(201).json({ tag: data });
    } catch (error) { next(error); }
  });
  app.put("/api/admin/news/tags/:id", async (req, res, next) => {
    try {
      const input = tagRenameSchema.parse(req.body);
      const { data, error } = await db!.from("news_tags").update(input).eq("id", tagId.parse(req.params.id)).select("id,name,slug,legacy_category").maybeSingle();
      if (error) throw error;
      if (!data) { res.status(404).json({ error: "Label not found." }); return; }
      res.json({ tag: data });
    } catch (error) { next(error); }
  });
  app.delete("/api/admin/news/tags/:id", async (req, res, next) => {
    try {
      const { data, error } = await db!.from("news_tags").delete().eq("id", tagId.parse(req.params.id)).is("legacy_category", null).select("id");
      if (error) throw error;
      if (!data?.length) { res.status(404).json({ error: "Label not found or reserved for legacy links." }); return; }
      res.status(204).end();
    } catch (error) { next(error); }
  });
}
