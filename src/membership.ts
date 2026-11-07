import type { Express, RequestHandler } from "express";
import type { Services } from "./app.js";
import { z } from "zod";
import multer from "multer";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { credentialStatus } from "./profiles/domain.js";

const text = (max: number) => z.string().trim().min(1).max(max);
export const applicationSchema = z.object({
  name: text(100), phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,25}$/).refine(v => /^\+?\d{7,15}$/.test(v.replace(/[ ()-]/g, ""))),
  cnic: z.string().trim().regex(/^(?:\d{13}|\d{5}-\d{7}-\d)$/).transform(v => v.replace(/^(\d{5})(\d{7})(\d)$/, "$1-$2-$3")),
  address: text(500), role: text(100), role_id: z.uuid(), role_version: z.number().int().positive(),
  province: z.enum(["Punjab", "Sindh", "Khyber Pakhtunkhwa", "Balochistan", "Azad Kashmir", "Gilgit Baltistan", "Islamabad"]), district: z.string().trim().max(100), tehsil: z.string().trim().max(100), city: z.string().trim().max(100),

}).strict();
export const roleSchema = z.object({ name: text(100), level: z.enum(["province", "district", "tehsil", "city"]), fee: z.number().int().min(1).max(1000000), fixed_province: z.enum(["Punjab", "Sindh", "Khyber Pakhtunkhwa", "Balochistan", "Azad Kashmir", "Gilgit Baltistan", "Islamabad"]).nullable(), active: z.boolean() }).strict();
export function designationDetails(details: z.infer<typeof applicationSchema>, role: { name: string; level: string; fixed_province: string | null }) {
  const { role_id: _id, role_version: _version, ...input } = details;
  if (role.fixed_province && input.province !== role.fixed_province) throw new z.ZodError([{ code: "custom", path: ["province"], message: "Choose the role's fixed province." }]);
  if (role.level !== "province") text(100).parse(input.district);
  const area = text(100).parse(input[role.level === "province" ? "province" : role.level === "district" ? "district" : role.level === "tehsil" ? "tehsil" : "city"]);
  return { ...input, role: role.name, designation_area: area === "Punjab" ? "پنجاب" : area };
}
export const paymentSettingsSchema = z.object({ enabled: z.boolean(), version: z.number().int().positive(), accounts: z.array(z.object({ name: text(100), number: text(100), title: text(200) }).strict()).max(10), instructions: z.string().trim().max(2000) }).strict().refine(v => !v.enabled || v.accounts.length > 0, "Add a receiving account before enabling payments");
const version = z.number().int().positive();
const decisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve"), version, father_name: text(100) }).strict(),
  z.object({ decision: z.literal("reject"), version, reason: text(1000) }).strict(),
]);
const bucket = "membership-private";
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1 } });
async function privateImage(buffer: Buffer, width: number, height: number) {
  try {
    const image = sharp(buffer, { limitInputPixels: 20_000_000 });
    const { format } = await image.metadata();
    if (!format || !["jpeg", "png", "webp"].includes(format)) throw new Error("Unsupported image format");
    return await image.rotate().resize(width, height, { fit: "inside", withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
  } catch { throw Object.assign(new Error("Invalid image"), { code: "INVALID_IMAGE" }); }
}
export function mountMembership(app: Express, services?: Services) {
  const db = services?.db;
  const member: RequestHandler = async (req, res, next) => {
    try {
      const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
      if (!token) { res.status(401).json({ error: "Sign in to continue." }); return; }
      const { data, error } = await db!.auth.getUser(token);
      if (error || !data.user) { res.status(401).json({ error: "Sign in again." }); return; }
      if (data.user.id === services!.ownerId || !data.user.email_confirmed_at || data.user.is_anonymous) {
        res.status(403).json({ error: "A verified member email is required. The owner account cannot apply." }); return;
      }
      res.locals.member = { id: data.user.id, email: data.user.email };
      next();
    } catch (error) { next(error); }
  };
  async function paymentSettings() {
    const { data, error } = await db!.from("membership_payment_settings").select("enabled,accounts,instructions,version").eq("singleton", true).single();
    if (error) throw error;
    return data;
  }
  app.get("/api/admin/membership/payment-settings", async (_req, res, next) => {
    try { res.json(await paymentSettings()); } catch (e) { next(e); }
  });
  app.put("/api/admin/membership/payment-settings", async (req, res, next) => {
    try { const input = paymentSettingsSchema.parse(req.body); const { data, error } = await db!.rpc("save_membership_payment_settings", { p_actor: res.locals.actor.id, p_input: input }); if (error) throw error; res.json(data); } catch (e) { next(e); }
  });
  app.get("/api/membership/options", async (_req, res, next) => {
    try { const { data, error } = await db!.from("membership_roles").select("*").eq("active", true).order("fee").order("name"); if (error) throw error; const settings = await paymentSettings(); res.json({ paymentsEnabled: settings.enabled, accounts: settings.accounts, instructions: settings.instructions, version: settings.version, currency: "PKR", roles: data }); } catch (e) { next(e); }
  });
  app.get("/api/admin/membership/roles", async (_req, res, next) => {
    try { const { data, error } = await db!.from("membership_roles").select("*").order("fee").order("name"); if (error) throw error; res.json({ roles: data }); } catch (e) { next(e); }
  });
  app.post("/api/admin/membership/roles", async (req, res, next) => {
    try { const input = roleSchema.parse(req.body); const { data, error } = await db!.rpc("save_membership_role", { p_actor: res.locals.actor.id, p_id: null, p_input: input }); if (error) throw error; res.status(201).json(data); } catch (e) { next(e); }
  });
  app.put("/api/admin/membership/roles/:id", async (req, res, next) => {
    try { const input = roleSchema.extend({ version: z.number().int().positive() }).parse(req.body); const { data, error } = await db!.rpc("save_membership_role", { p_actor: res.locals.actor.id, p_id: z.uuid().parse(req.params.id), p_input: input }); if (error) throw error; res.json(data); } catch (e) { next(e); }
  });
  app.use("/api/member", member);
  async function own(userId: string) {
    const { data, error } = await db!.from("membership_applications").select("*").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    return data;
  }
  app.get("/api/member/application", async (_req, res, next) => {
    try {
      const application = await own(res.locals.member.id);
      if (application) { delete application.proof_path; delete application.photo_path; }
      res.json(application);
    } catch (e) { next(e); }
  });
  app.post("/api/member/application", upload.single("photo"), async (req, res, next) => {
    let path: string | undefined;
    try {
      const input = applicationSchema.parse(req.file || req.is("multipart/form-data") ? JSON.parse(req.body.details || "null") : req.body);
      const { data: role, error: roleError } = await db!.from("membership_roles").select("*").eq("id", input.role_id).eq("active", true).maybeSingle();
      if (roleError) throw roleError;
      if (!role || role.version !== input.role_version) { res.status(409).json({ error: "The role or fee changed. Reload the application form." }); return; }
      const details = designationDetails(input, role);
      const existing = await own(res.locals.member.id);
      if (existing) { delete existing.proof_path; delete existing.photo_path; res.json(existing); return; }
      if (req.file) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(req.file.mimetype)) { res.status(400).json({ error: "Upload a JPG, PNG or WebP portrait." }); return; }
        const buffer = await privateImage(req.file.buffer, 1200, 1600);
        path = `${res.locals.member.id}/${randomUUID()}.webp`;
        const { error } = await db!.storage.from(bucket).upload(path, buffer, { contentType: "image/webp", upsert: false });
        if (error) throw error;
      }
      const { data, error } = await db!.rpc("create_membership_application", { p_user_id: res.locals.member.id, p_email: res.locals.member.email, p_details: details, p_role_id: input.role_id, p_role_version: input.role_version, p_photo_path: path ?? null });
      if (error) throw error;
      if (data.photo_path === path) path = undefined;
      if (path) { await db!.storage.from(bucket).remove([path]); path = undefined; }
      delete data.proof_path; delete data.photo_path;
      res.status(201).json(data);
    } catch (e) {
      if (path) await db!.storage.from(bucket).remove([path]).catch(() => undefined);
      if (e instanceof SyntaxError) { res.status(400).json({ error: "Invalid application details." }); return; }
      next(e);
    }
  });
  app.post("/api/member/payment", upload.single("proof"), async (req, res, next) => {
    let path: string | undefined;
    try {
      if (!(await paymentSettings()).enabled) { res.status(503).json({ error: "Payment collection is not open yet." }); return; }
      const application = await own(res.locals.member.id);
      if (!application || !["awaiting_payment", "rejected"].includes(application.status)) { res.status(409).json({ error: "This application cannot accept another payment proof." }); return; }
      const inputVersion = z.coerce.number().int().positive().parse(req.body.version);
      if (inputVersion !== application.version) { res.status(409).json({ error: "Reload the application before uploading." }); return; }
      if (!req.file || !["image/jpeg", "image/png", "image/webp"].includes(req.file.mimetype)) { res.status(400).json({ error: "Upload a JPG, PNG or WebP receipt, up to 4 MB." }); return; }
      const buffer = await privateImage(req.file.buffer, 1800, 2400);
      path = `${application.id}/${randomUUID()}.webp`;
      const { error: uploadError } = await db!.storage.from(bucket).upload(path, buffer, { contentType: "image/webp", upsert: false });
      if (uploadError) throw uploadError;
      const { data, error } = await db!.rpc("submit_membership_payment", { p_user_id: res.locals.member.id, p_version: inputVersion, p_path: path });
      if (error) throw error;
      path = undefined; // The database now owns the receipt; a failed response must not delete it.
      delete data.proof_path; delete data.photo_path;
      res.json(data);
    } catch (e) {
      if (path) await db!.storage.from(bucket).remove([path]).catch(() => undefined);
      next(e);
    }
  });
  app.get("/api/member/profile", async (_req, res, next) => {
    try {
      const application = await own(res.locals.member.id);
      if (application?.status !== "approved" || !application.reporter_id) { res.status(403).json({ error: "Payment approval is required." }); return; }
      const { data: reporter, error } = await db!.from("reporters").select("*").eq("id", application.reporter_id).maybeSingle();
      if (error) throw error;
      if (!reporter || reporter.status === "draft") { res.status(403).json({ error: "Your profile is unavailable. Contact the newsroom." }); return; }
      res.json({ reporter, membership: { status: credentialStatus(reporter), issue_date: reporter.issue_date, expiry_date: reporter.expiry_date, fee: application.fee, currency: "PKR" }, profile_url: `https://profile.96newshd.com/p/${reporter.id}` });
    } catch (e) { next(e); }
  });
  // /api/admin is already protected by the shared owner guard.
  app.get("/api/admin/applications", async (req, res, next) => {
    try {
      const page = z.coerce.number().int().min(1).max(100000).parse(req.query.page ?? 1);
      const { data, count, error } = await db!.from("membership_applications").select("id,user_id,email,details,fee,status,rejection_reason,reporter_id,version,created_at,reviewed_at", { count: "exact" }).order("created_at", { ascending: false }).order("id").range((page - 1) * 50, page * 50 - 1);
      if (error) throw error;
      res.json({ applications: data, total: count });
    } catch (e) { next(e); }
  });
  app.get("/api/admin/applications/:id/proof", async (req, res, next) => {
    try {
      const id = z.uuid().parse(req.params.id);
      const kind = z.enum(["proof", "photo"]).parse(req.query.kind || "proof");
      const { data, error } = await db!.from("membership_applications").select("proof_path,photo_path").eq("id", id).maybeSingle();
      if (error) throw error;
      const path = kind === "photo" ? data?.photo_path : data?.proof_path;
      if (!path) { res.status(404).json({ error: "No payment receipt." }); return; }
      const { data: signed, error: signError } = await db!.storage.from(bucket).createSignedUrl(path, 60);
      if (signError) throw signError;
      res.json({ url: signed!.signedUrl });
    } catch (e) { next(e); }
  });
  app.post("/api/admin/applications/:id/decision", async (req, res, next) => {
    try {
      const id = z.uuid().parse(req.params.id);
      const input = decisionSchema.parse(req.body);
      let photoUrl = "";
      if (input.decision === "approve") {
        const { data: application, error } = await db!.from("membership_applications").select("status,version,photo_path").eq("id", id).maybeSingle();
        if (error) throw error;
        if (!application || application.status !== "pending" || application.version !== input.version) { res.status(409).json({ error: "Reload this application before reviewing." }); return; }
        if (application.photo_path) {
          const { data: photo, error: downloadError } = await db!.storage.from(bucket).download(application.photo_path);
          if (downloadError) throw downloadError;
          photoUrl = await services!.upload(Buffer.from(await photo!.arrayBuffer()));
        }
      }
      const { data, error } = await db!.rpc("review_membership_application", { p_id: id, p_actor: res.locals.actor.id, p_actor_email: res.locals.actor.email, p_input: input, p_photo_url: photoUrl });
      if (error) throw error;
      res.json(data);
    } catch (e) { next(e); }
  });
}
