import { z } from "zod";
const text = (max: number) =>
  z.string().trim().min(1, "This field is required").max(max);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Enter a valid date",
  );
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,24}$/, "Enter a valid phone number")
  .refine(
    (v) =>
      v.replace(/\D/g, "").length >= 7 && v.replace(/\D/g, "").length <= 15,
    "Use 7 to 15 digits",
  );
export const renewalSchema = z
  .object({ issue_date: date, expiry_date: date })
  .strict()
  .refine((value) => value.expiry_date >= value.issue_date, {
    path: ["expiry_date"],
    message: "Expiry must be on or after issue date",
  });
export type RenewalInput = z.infer<typeof renewalSchema>;
export const reporterSchema = z
  .object({
    name: text(100),
    serial_number: z.string().trim().max(100).optional(),
    father_name: text(100),
    designation: text(100),
    city: text(100),
    cnic: z.string().regex(/^\d{5}-\d{7}-\d$/, "Use 12345-1234567-1"),
    contact: phone,
    whatsapp: phone,
    address: text(500),
    issue_date: date,
    expiry_date: date,
    status: z.enum(["active", "draft", "revoked"]),
    show_sensitive: z.boolean(),
    photo_url: z
      .string()
      .max(1000)
      .refine(
        (v) =>
          !v ||
          /^https:\/\/res\.cloudinary\.com\/[a-zA-Z0-9_-]+\/image\/upload\//.test(
            v,
          ),
        "Upload a photo using the image uploader",
      ),
  })
  .strict()
  .refine((v) => v.expiry_date >= v.issue_date, {
    path: ["expiry_date"],
    message: "Expiry must be on or after issue date",
  });
export type ReporterInput = z.infer<typeof reporterSchema>;
export type Reporter = ReporterInput & {
  id: string;
  card_number: number;
  created_at: string;
  updated_at: string;
};
export type PublicReporter = Omit<
  Reporter,
  "cnic" | "address" | "show_sensitive"
> & { cnic?: string; address?: string };
export function credentialStatus(
  reporter: Pick<ReporterInput, "status" | "issue_date" | "expiry_date">,
  today = new Date().toISOString().slice(0, 10),
) {
  if (reporter.status !== "active") return reporter.status;
  if (reporter.issue_date > today) return "scheduled";
  return reporter.expiry_date < today ? "expired" : "active";
}
export function expiringSoon(
  reporter: Pick<ReporterInput, "status" | "issue_date" | "expiry_date">,
  today = new Date().toISOString().slice(0, 10),
) {
  if (credentialStatus(reporter, today) !== "active") return false;
  const days = (Date.parse(reporter.expiry_date) - Date.parse(today)) / 86_400_000;
  return days >= 0 && days <= 30;
}
export function publicReporter(reporter: Reporter): PublicReporter {
  const { id, card_number, serial_number, name, father_name, designation, city, contact, whatsapp,
    issue_date, expiry_date, status, photo_url, created_at, updated_at, cnic, address, show_sensitive } = reporter;
  const visible = { id, card_number, serial_number, name, father_name, designation, city, contact, whatsapp,
    issue_date, expiry_date, status, photo_url, created_at, updated_at };
  return show_sensitive ? { ...visible, cnic, address } : visible;
}
export function whatsappUrl(number: string) {
  let digits = number.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("03") && digits.length === 11)
    digits = `92${digits.slice(1)}`;
  return `https://wa.me/${digits}`;
}
export function profileUrl(id: string, origin = window.location.origin) {
  return `${origin.replace(/\/$/, "")}/p/${id}`;
}
export const statusLabels = {
  active: "Active",
  expired: "Expired",
  draft: "Draft",
  revoked: "Revoked",
  scheduled: "Scheduled",
};
