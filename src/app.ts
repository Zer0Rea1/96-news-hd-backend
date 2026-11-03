import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from "express";
import helmet from "helmet";
import cors from "cors";
import { mountNews } from "./news.js";
import rateLimit from "express-rate-limit";
import multer from "multer";
import sharp from "sharp";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reporterSchema, renewalSchema, publicReporter, credentialStatus, type Reporter } from "./profiles/domain.js";
import { contactVcard } from "./profiles/contact.js";

export interface Services {
  db: SupabaseClient;
  ownerId: string;
  cloudName?: string;
  uploadNews?: (buffer: Buffer) => Promise<string>;
  upload: (buffer: Buffer) => Promise<string>;
  cleanupPhotos?: (url?: string) => Promise<{ deleted: number; failed: number }>;
}
const idSchema = z.uuid();
export function createApp(services?: Services) {
  const app = express();
  app.disable("x-powered-by");
  const origins = (process.env.CORS_ORIGINS || "https://96newshd.com,https://www.96newshd.com,https://admin.96newshd.com,https://profile.96newshd.com,https://96newshd-profile.vercel.app,http://localhost:5173,http://localhost:5174").split(",").map(value => value.trim()).filter(Boolean);
  app.use(cors({ origin(origin, callback) {
    if (!origin || origins.includes(origin)) callback(null, true);
    else callback(Object.assign(new Error("Origin not allowed"), { status: 403 }));
  }, credentials: false, methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], allowedHeaders: ["Content-Type", "Authorization", "If-Match"], maxAge: 600 }));
  if (process.env.VERCEL) app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          "img-src": ["'self'", "data:", "blob:", "https://res.cloudinary.com"],
          "connect-src": ["'self'", "https://*.supabase.co"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'"],
        },
      },
    }),
  );
  // shortcut: rate limits are process-local; use a shared store before adding server instances.
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 150,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "256kb" }));
  app.get("/", (_req, res) => res.json({ service: "96 News HD API", health: "/api/health" }));
  app.get("/api/health", (_req, res) => res.json({ ready: Boolean(services) }));
  app.use("/api", (_req, res, next) =>
    services
      ? next()
      : res.status(503).json({
          error:
            "Configure Supabase and Cloudinary in .env, then restart the server.",
        }),
  );
  const admin: RequestHandler = async (req, res, next) => {
    const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
    if (!token) {
      res.status(401).json({ error: "Sign in to continue." });
      return;
    }
    try {
      const { data, error } = await services!.db.auth.getUser(token);
      if (error || !data.user) {
        res
          .status(401)
          .json({ error: "Your session has expired. Sign in again." });
        return;
      }
      if (data.user.id !== services!.ownerId) {
        res.status(403).json({ error: "Owner access is required." });
        return;
      }
      res.locals.actor = { id: data.user.id, email: data.user.email || data.user.id };
      next();
    } catch (error) {
      next(error);
    }
  };
  app.use("/api/admin", admin);
  mountNews(app, services);
  async function mutate(action: string, id: string | null, input: unknown, actor: { id: string; email: string }) {
    const { data, error } = await services!.db.rpc("mutate_reporter", {
      p_action: action,
      p_actor_id: actor.id,
      p_actor_email: actor.email,
      p_reporter_id: id,
      p_input: input,
    });
    if (error) throw error;
    return data as { reporter: Reporter; previous_photo_url: string } | null;
  }
  async function cleanupPhoto(url: string) {
    if (!url || !services?.cleanupPhotos) return;
    try {
      const result = await services.cleanupPhotos(url);
      if (result.failed) console.error("Photo cleanup deferred");
    } catch {
      console.error("Photo cleanup deferred");
    }
  }
  app.get(["/api/profiles/:id", "/api/profiles/:id/contact.vcf"], async (req, res, next) => {
    if (!idSchema.safeParse(req.params.id).success) {
      res.status(404).json({ error: "Profile not found." });
      return;
    }
    try {
      const { data, error } = await services!.db
        .from("reporters")
        .select("*")
        .eq("id", req.params.id)
        .neq("status", "draft")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        res.status(404).json({ error: "Profile not found." });
        return;
      }
      if (req.path.endsWith("/contact.vcf")) {
        if (credentialStatus(data) !== "active") {
          res.status(404).json({ error: "Contact unavailable." });
          return;
        }
        res.set({
          "Content-Type": "text/vcard; charset=utf-8",
          "Content-Disposition": `inline; filename="96news-${data.id}.vcf"`,
        });
        res.send(contactVcard(publicReporter(data)));
        return;
      }
      res.json(publicReporter(data));
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/cron/photos", async (req, res, next) => {
    if (!process.env.CRON_SECRET || req.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
      res.status(401).json({ error: "Unauthorized." });
      return;
    }
    if (!services?.cleanupPhotos) {
      res.status(503).json({ error: "Photo cleanup is unavailable." });
      return;
    }
    try { res.json(await services.cleanupPhotos()); }
    catch (error) { next(error); }
  });
  app.post("/api/admin/photos/cleanup", async (_req, res, next) => {
    if (!services?.cleanupPhotos) {
      res.status(503).json({ error: "Photo cleanup is unavailable." });
      return;
    }
    try { res.json(await services.cleanupPhotos()); }
    catch (error) { next(error); }
  });
  app.get("/api/admin/activity", async (req, res, next) => {
    const page = z.coerce.number().int().min(1).max(100000).safeParse(req.query.page ?? 1);
    if (!page.success) {
      res.status(400).json({ error: "Invalid page." });
      return;
    }
    try {
      const start = (page.data - 1) * 50;
      const { data, error, count } = await services!.db.from("activity_log")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false }).order("id", { ascending: false })
        .range(start, start + 49);
      if (error) throw error;
      res.json({ activities: data, total: count });
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/admin/reporters", async (req, res, next) => {
    const page = z.coerce
      .number()
      .int()
      .min(1)
      .max(100000)
      .safeParse(req.query.page ?? 1);
    if (!page.success) {
      res.status(400).json({ error: "Invalid page." });
      return;
    }
    try {
      const start = (page.data - 1) * 100;
      const { data, error, count } = await services!.db
        .from("reporters")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .order("id")
        .range(start, start + 99);
      if (error) throw error;
      res.json({ reporters: data, total: count });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/admin/reporters", async (req, res, next) => {
    const result = reporterSchema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: "Check the reporter details.",
        fields: result.error.flatten().fieldErrors,
      });
      return;
    }
    try {
      const data = await mutate("create", null, result.data, res.locals.actor);
      res.status(201).json(data!.reporter);
    } catch (error) {
      next(error);
    }
  });
  app.put("/api/admin/reporters/:id", async (req, res, next) => {
    const result = reporterSchema.safeParse(req.body);
    if (!idSchema.safeParse(req.params.id).success || !result.success) {
      res.status(400).json({
        error: "Check the reporter details.",
        fields: !result.success
          ? result.error.flatten().fieldErrors
          : undefined,
      });
      return;
    }
    try {
      const data = await mutate("update", req.params.id as string, result.data, res.locals.actor);
      if (!data) {
        res.status(404).json({ error: "Reporter not found." });
        return;
      }
      if (data.previous_photo_url !== data.reporter.photo_url) await cleanupPhoto(data.previous_photo_url);
      res.json(data.reporter);
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/admin/reporters/:id/renew", async (req, res, next) => {
    const result = renewalSchema.safeParse(req.body);
    if (!idSchema.safeParse(req.params.id).success || !result.success) {
      res.status(400).json({ error: "Check the renewal dates." });
      return;
    }
    try {
      const data = await mutate("renew", req.params.id as string, result.data, res.locals.actor);
      if (!data) {
        res.status(404).json({ error: "Reporter not found." });
        return;
      }
      res.json(data.reporter);
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/admin/reporters/:id", async (req, res, next) => {
    if (!idSchema.safeParse(req.params.id).success) {
      res.status(400).json({ error: "Invalid reporter ID." });
      return;
    }
    try {
      const data = await mutate("delete", req.params.id as string, {}, res.locals.actor);
      if (!data) {
        res.status(404).json({ error: "Reporter not found." });
        return;
      }
      await cleanupPhoto(data.previous_photo_url);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 0 },
  });
  app.post(
    ["/api/admin/photos", "/api/admin/news/photos"],
    rateLimit({ windowMs: 60_000, limit: 15 }),
    upload.single("photo"),
    async (req, res, next) => {
      if (
        !req.file ||
        !["image/jpeg", "image/png", "image/webp"].includes(req.file.mimetype)
      ) {
        res.status(400).json({ error: "Choose a JPG, PNG, or WebP image." });
        return;
      }
      let buffer: Buffer;
      try {
        buffer = await sharp(req.file.buffer, { limitInputPixels: 40_000_000 })
          .rotate()
          .resize(800, 1000, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer();
      } catch {
        res.status(400).json({
          error:
            "This image could not be read. Choose a valid JPG, PNG, or WebP.",
        });
        return;
      }
      try {
        const uploader = req.path === "/api/admin/news/photos" ? services!.uploadNews : services!.upload;
        if (!uploader) { res.status(503).json({ error: "Image uploads are unavailable." }); return; }
        res.status(201).json({ url: await uploader(buffer) });
      } catch (error) {
        next(error);
      }
    },
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Endpoint not found." }),
  );
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof z.ZodError) { res.status(400).json({ error: "Invalid request details.", fields: error.flatten().fieldErrors }); return; }
    if (error.status === 403) { res.status(403).json({ error: "Origin not allowed." }); return; }
    if (error.code === "PGRST202" || error.code === "42P01") { res.status(503).json({ error: "Database setup is incomplete. Run the schema setup before serving news." }); return; }
    if (error.code === "40001") { res.status(409).json({ error: "This post changed. Reload it before saving." }); return; }
    if (error.code === "23503" || error.code === "23001") { res.status(409).json({ error: "This label is in use or a referenced record no longer exists." }); return; }
    if (error.code === "22023") { res.status(400).json({ error: "Invalid news details or labels." }); return; }
    if (error.code === "55000") {
      res.status(409).json({ error: "This photo is no longer available. Upload it again." });
      return;
    }
    if (error.code === "P0001") {
      res.status(409).json({ error: "Renewal must extend the current expiry date. Draft or revoked credentials must be edited before renewal." });
      return;
    }
    if (error instanceof multer.MulterError) {
      res.status(400).json({
        error:
          error.code === "LIMIT_FILE_SIZE"
            ? "Compressed images must be smaller than 4 MB."
            : "Upload one image at a time.",
      });
      return;
    }
    if (
      error.type === "entity.parse.failed" ||
      error.type === "entity.too.large"
    ) {
      res.status(400).json({ error: "Invalid or oversized request." });
      return;
    }
    if (error.code === "23505") {
      res
        .status(409)
        .json({ error: "A record with this CNIC, label or slug already exists." });
      return;
    }
    console.error(
      "API request failed:",
      error.code || error.name || "Unknown error",
    );
    res
      .status(500)
      .json({ error: "The request could not be completed. Please try again." });
  };
  app.use(errors);
  return app;
}
