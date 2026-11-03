import { describe, expect, test } from "bun:test";
import {
  reporterSchema,
  renewalSchema,
  credentialStatus,
  expiringSoon,
  publicReporter,
  whatsappUrl,
  profileUrl,
} from "../src/profiles/domain";
import { reporterFixtures } from "./fixtures";
const row = reporterFixtures[0]!;
const { id, card_number, created_at, updated_at, ...input } = row;
describe("reporter validation", () => {
  test("serial numbers retain leading zeros and accept legacy records", () => {
    expect(reporterSchema.parse({ ...input, serial_number: "  00042  " }).serial_number).toBe("00042");
    expect(reporterSchema.safeParse({ ...input, serial_number: "x".repeat(101) }).success).toBe(false);
    const { serial_number, ...legacy } = input;
    expect(reporterSchema.safeParse(legacy).success).toBe(true);
    expect(reporterSchema.safeParse({ ...input, serial_number: "" }).success).toBe(true);
    expect(publicReporter(row).serial_number).toBe(row.serial_number);
  });
  test("accepts and trims valid details", () =>
    expect(
      reporterSchema.parse({ ...input, name: "  Ahmed Raza  " }).name,
    ).toBe("Ahmed Raza"));
  test.each(["", "abc", "1234567890123"])("rejects invalid CNIC %s", (cnic) =>
    expect(reporterSchema.safeParse({ ...input, cnic }).success).toBe(false),
  );
  test("rejects unknown server-owned fields", () =>
    expect(reporterSchema.safeParse({ ...input, id }).success).toBe(false));
  test.each(["2026-02-30", "2026-13-01", "bad-date"])(
    "rejects invalid date %s",
    (issue_date) =>
      expect(reporterSchema.safeParse({ ...input, issue_date }).success).toBe(
        false,
      ),
  );
  test("rejects expiry before issue", () =>
    expect(
      reporterSchema.safeParse({ ...input, expiry_date: "2025-12-31" }).success,
    ).toBe(false));
  test.each([
    "https://evil.test/a.jpg",
    "javascript:alert(1)",
    "http://res.cloudinary.com/test/image/upload/a.webp",
  ])("rejects untrusted photo %s", (photo_url) =>
    expect(reporterSchema.safeParse({ ...input, photo_url }).success).toBe(
      false,
    ),
  );
  test("accepts Cloudinary photos", () =>
    expect(
      reporterSchema.safeParse({
        ...input,
        photo_url: "https://res.cloudinary.com/news/image/upload/portrait.webp",
      }).success,
    ).toBe(true));
  test.each(["123", "1234567890123456", "+92 hello"])(
    "rejects phone %s",
    (contact) =>
      expect(reporterSchema.safeParse({ ...input, contact }).success).toBe(
        false,
      ),
  );
});
describe("credential renewal and reminders", () => {
  test("30-day reminders include today and the boundary in UTC", () => {
    const today = "2026-12-15";
    expect(expiringSoon({ ...row, expiry_date: today }, today)).toBe(true);
    expect(expiringSoon({ ...row, expiry_date: "2027-01-14" }, today)).toBe(true);
    expect(expiringSoon({ ...row, expiry_date: "2027-01-15" }, today)).toBe(false);
    expect(expiringSoon({ ...row, expiry_date: "2026-12-14" }, today)).toBe(false);
  });
  test("draft, revoked and scheduled credentials never trigger reminders", () => {
    expect(expiringSoon({ ...row, status: "draft", expiry_date: "2026-12-15" }, "2026-12-15")).toBe(false);
    expect(expiringSoon({ ...row, status: "revoked", expiry_date: "2026-12-15" }, "2026-12-15")).toBe(false);
    expect(expiringSoon({ ...row, issue_date: "2026-12-16", expiry_date: "2026-12-20" }, "2026-12-15")).toBe(false);
  });
  test("renewal dates are real ordered dates and cannot change other fields", () => {
    expect(renewalSchema.safeParse({ issue_date: "2026-12-15", expiry_date: "2027-12-15" }).success).toBe(true);
    expect(renewalSchema.safeParse({ issue_date: "2026-12-15", expiry_date: "2026-02-30" }).success).toBe(false);
    expect(renewalSchema.safeParse({ issue_date: "2026-12-15", expiry_date: "2026-12-14" }).success).toBe(false);
    expect(renewalSchema.safeParse({ issue_date: "2026-12-15", expiry_date: "2027-12-15", status: "active" }).success).toBe(false);
  });
});
describe("credential authorization dates", () => {
  test("valid through expiry day in UTC", () =>
    expect(
      credentialStatus({ ...row, expiry_date: "2026-10-24" }, "2026-10-24"),
    ).toBe("active"));
  test("expires the next day", () =>
    expect(
      credentialStatus({ ...row, expiry_date: "2026-10-23" }, "2026-10-24"),
    ).toBe("expired"));
  test("future issue is scheduled", () =>
    expect(
      credentialStatus({ ...row, issue_date: "2026-10-25" }, "2026-10-24"),
    ).toBe("scheduled"));
  test.each(["draft", "revoked"] as const)("%s overrides dates", (status) =>
    expect(credentialStatus({ ...row, status }, "2030-01-01")).toBe(status),
  );
});
describe("public profile data", () => {
  test("omits sensitive details by default", () => {
    const result = publicReporter(row);
    expect(result).not.toHaveProperty("cnic");
    expect(result).not.toHaveProperty("address");
    expect(result).not.toHaveProperty("show_sensitive");
    expect(result.name).toBe(row.name);
  });
  test("includes details only with explicit publication", () =>
    expect(publicReporter({ ...row, show_sensitive: true }).cnic).toBe(
      row.cnic,
    ));
  test("normalizes Pakistani and international WhatsApp numbers", () => {
    expect(whatsappUrl("0300 1234567")).toBe("https://wa.me/923001234567");
    expect(whatsappUrl("+92 300-1234567")).toBe("https://wa.me/923001234567");
    expect(whatsappUrl("0044 7700 900123")).toBe("https://wa.me/447700900123");
  });
  test("stable QR and NFC URL", () =>
    expect(profileUrl(id, "https://press.example.com/")).toBe(
      `https://press.example.com/p/${id}`,
    ));
});
