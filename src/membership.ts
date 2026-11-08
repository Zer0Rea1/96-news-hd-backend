import type { Express, RequestHandler } from "express";
import type { Services } from "./app.js";
import { z } from "zod";
import multer from "multer";
import rateLimit from "express-rate-limit";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { credentialStatus } from "./profiles/domain.js";

const text = (max: number) => z.string().trim().min(1).max(max);
export const applicationSchema = z.object({
  name: text(100), father_name: text(100), phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,25}$/).refine(v => /^\+?\d{7,15}$/.test(v.replace(/[ ()-]/g, ""))),
  cnic: z.string().trim().regex(/^(?:\d{13}|\d{5}-\d{7}-\d)$/).transform(v => v.replace(/^(\d{5})(\d{7})(\d)$/, "$1-$2-$3")),
  address: text(500), role: text(100), role_id: z.uuid(), role_version: z.number().int().positive(),
  province: z.enum(["Punjab", "Sindh", "Khyber Pakhtunkhwa", "Balochistan", "Azad Kashmir", "Gilgit Baltistan", "Islamabad"]), district: z.string().trim().max(100), tehsil: z.string().trim().max(100), city: z.string().trim().max(100),

}).strict();
export const roleSchema = z.object({ name: text(100), level: z.enum(["province", "district", "tehsil", "city"]), fee: z.number().int().min(1).max(1000000), fixed_province: z.enum(["Punjab", "Sindh", "Khyber Pakhtunkhwa", "Balochistan", "Azad Kashmir", "Gilgit Baltistan", "Islamabad"]).nullable(), active: z.boolean() }).strict();
export const designationChangeSchema = z.object({ role_id: z.uuid(), role_version: z.number().int().positive(), version: z.number().int().positive() }).strict();
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
  z.object({ decision: z.literal("approve"), version }).strict(),
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
  app.post("/api/membership/signup-form", rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false }), upload.single("photo"), async (req, res, next) => {
    let path: string | undefined;
    try {
      const raw = JSON.parse(req.body.details || "null");
      const input = applicationSchema.parse(raw);
      const email = z.email().max(254).parse(req.body.email).toLowerCase();
      const { data: role, error: roleError } = await db!.from("membership_roles").select("*").eq("id", input.role_id).eq("active", true).maybeSingle();
      if (roleError) throw roleError;
      if (!role || role.version !== input.role_version) { res.status(409).json({ error: "The role or fee changed. Reload the form before signing up." }); return; }
      const details = designationDetails(input, role);
      const { data: duplicate, error: duplicateError } = await db!.from("reporters").select("id").eq("cnic", details.cnic).maybeSingle();
      if (duplicateError) throw duplicateError;
      if (duplicate) { res.status(409).json({ error: "A reporter with this CNIC already exists. Contact the newsroom." }); return; }
      const id = randomUUID();
      if (req.file) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(req.file.mimetype)) { res.status(400).json({ error: "Upload a JPG, PNG or WebP portrait." }); return; }
        const buffer = await privateImage(req.file.buffer, 1200, 1600);
        path = `signup/${id}/${randomUUID()}.webp`;
        const { error } = await db!.storage.from(bucket).upload(path, buffer, { contentType: "image/webp", upsert: false });
        if (error) throw error;
      }
      const { data, error } = await db!.rpc("save_membership_signup_form", { p_id: id, p_email: email, p_details: details, p_role_id: role.id, p_role_version: input.role_version, p_photo_path: path || null });
      if (error) throw error;
      path = undefined;
      res.status(201).json(data);
    } catch (e) {
      if (path) await db!.storage.from(bucket).remove([path]).catch(() => undefined);
      if (e instanceof SyntaxError) { res.status(400).json({ error: "Invalid application details." }); return; }
      next(e);
    }
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
  app.patch("/api/member/application/father", async (req, res, next) => {
    try {
      const input = z.object({ version, father_name: text(100) }).strict().parse(req.body);
      const { data, error } = await db!.rpc("complete_application_father", { p_user_id: res.locals.member.id, p_version: input.version, p_father: input.father_name });
      if (error) throw error;
      res.json(data);
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
      const { data: duplicate, error: duplicateError } = await db!.from("reporters").select("id").eq("cnic", details.cnic).maybeSingle();
      if (duplicateError) throw duplicateError;
      if (duplicate) { res.status(409).json({ error: "A reporter with this CNIC already exists. Contact the newsroom before making a payment." }); return; }
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
  app.post("/api/member/designation-change", async (req, res, next) => {
    try {
      const input = designationChangeSchema.parse(req.body);
      const { data, error } = await db!.rpc("request_member_designation", { p_user_id: res.locals.member.id, p_version: input.version, p_role_id: input.role_id, p_role_version: input.role_version });
      if (error) throw error;
      res.json(data);
    } catch (e) { next(e); }
  });
  app.delete("/api/member/designation-change", async (req, res, next) => {
    try {
      const input = z.object({ version }).strict().parse(req.body);
      const { data, error } = await db!.rpc("cancel_member_designation", { p_user_id: res.locals.member.id, p_version: input.version });
      if (error) throw error;
      res.json(data);
    } catch (e) { next(e); }
  });
  app.post("/api/member/payment", upload.single("proof"), async (req, res, next) => {
    let path: string | undefined;
    try {
      if (!(await paymentSettings()).enabled) { res.status(503).json({ error: "Payment collection is not open yet." }); return; }
      const application = await own(res.locals.member.id);
      if (!application || (!["awaiting_payment", "rejected", "approved"].includes(application.status) || application.renewal_status === "pending")) { res.status(409).json({ error: "This application cannot accept another payment proof." }); return; }
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
      res.json({ reporter, membership: { status: reporter.membership_expires_at && Date.parse(reporter.membership_expires_at) > Date.now() ? "active" : "expired", issue_date: reporter.membership_started_at, expiry_date: reporter.membership_expires_at, fee: application.fee, currency: "PKR" }, profile_url: `https://profile.96newshd.com/p/${reporter.id}` });
    } catch (e) { next(e); }
  });
  // /api/admin is already protected by the shared owner guard.
  app.delete("/api/admin/accounts/:id", async (req, res, next) => {
    try {
      const id = z.uuid().parse(req.params.id);
      if (id === services!.ownerId) { res.status(403).json({ error: "The owner account cannot be deleted." }); return; }
      const { error } = await db!.auth.admin.deleteUser(id);
      if (error) throw error;
      res.status(204).end();
    } catch (e) { next(e); }
  });
  app.get("/api/admin/accounts", async (req, res, next) => {
    try {
      const page = z.coerce.number().int().min(1).max(100000).parse(req.query.page ?? 1);
      const { data, error } = await db!.auth.admin.listUsers({ page, perPage: 50 });
      if (error) throw error;
      const users = data.users;
      const { data: applications, error: applicationError } = users.length
        ? await db!.from("membership_applications").select("user_id,status,renewal_status,reporter_id,details").in("user_id", users.map(user => user.id))
        : { data: [], error: null };
      if (applicationError) throw applicationError;
      const ids = (applications || []).map(a => a.reporter_id).filter(Boolean);
      const { data: reporters, error: reporterError } = ids.length
        ? await db!.from("reporters").select("id,name,status,issue_date,expiry_date,membership_expires_at").in("id", ids)
        : { data: [], error: null };
      if (reporterError) throw reporterError;
      const apps = new Map((applications || []).map(a => [a.user_id, a]));
      const profiles = new Map((reporters || []).map(r => [r.id, r]));
      res.set("Cache-Control", "private, no-store").json({ total: data.total, page, accounts: users.map(user => {
        const application = apps.get(user.id);
        const reporter = application?.reporter_id ? profiles.get(application.reporter_id) : null;
        return { id: user.id, email: user.email || null, phone: application?.details?.phone || user.phone || null, email_verified: Boolean(user.email_confirmed_at),
          created_at: user.created_at, last_sign_in_at: user.last_sign_in_at || null, owner: user.id === services!.ownerId,
          application_status: application?.status || null, renewal_status: application?.renewal_status || null,
          reporter_id: reporter?.id || null, name: reporter?.name || application?.details?.name || null,
          membership_expires_at: reporter?.membership_expires_at || null,
          membership_status: reporter ? (reporter.membership_expires_at && Date.parse(reporter.membership_expires_at) > Date.now() ? "active" : "expired") : null,
          card_status: reporter ? credentialStatus(reporter) : null, card_expiry_date: reporter?.expiry_date || null };
      }) });
    } catch (e) { next(e); }
  });

  app.get("/api/admin/applications", async (req, res, next) => {
    try {
      const page = z.coerce.number().int().min(1).max(100000).parse(req.query.page ?? 1);
      const { data, count, error } = await db!.from("membership_applications").select("id,user_id,email,details,fee,status,renewal_status,pending_designation,rejection_reason,reporter_id,version,created_at,reviewed_at", { count: "exact" }).order("created_at", { ascending: false }).order("id").range((page - 1) * 50, page * 50 - 1);
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
  app.post("/api/admin/applications/:id/renew", async (req, res, next) => {
    try {
      const input = z.object({ version, reason: text(1000) }).strict().parse(req.body);
      const { data, error } = await db!.rpc("renew_membership_without_payment", { p_id: z.uuid().parse(req.params.id), p_actor: res.locals.actor.id, p_actor_email: res.locals.actor.email, p_version: input.version, p_reason: input.reason });
      if (error) throw error;
      res.json(data);
    } catch (e) { next(e); }
  });
  app.post("/api/admin/applications/:id/decision", async (req, res, next) => {
    try {
      const id = z.uuid().parse(req.params.id);
      const input = decisionSchema.parse(req.body);
      let photoUrl = "";
      if (input.decision === "approve") {
        const { data: application, error } = await db!.from("membership_applications").select("status,renewal_status,version,photo_path,details").eq("id", id).maybeSingle();
        if (error) throw error;
        if (!application || (application.status !== "pending" && !(application.status === "approved" && application.renewal_status === "pending")) || application.version !== input.version) { res.status(409).json({ error: "Reload this application before reviewing." }); return; }
        if (application.status !== "approved" && !application.details?.father_name?.trim()) { res.status(409).json({ error: "The applicant must add their father’s name before approval." }); return; }
        if (application.photo_path && application.status !== "approved") {
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
