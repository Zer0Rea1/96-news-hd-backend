import type { PublicReporter } from "./domain.js";
import { whatsappUrl } from "./domain.js";

function escapeVcard(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export function contactVcard(reporter: PublicReporter) {
  return [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:;${escapeVcard(reporter.name)};;;`,
    `FN:${escapeVcard(reporter.name)}`,
    "ORG:96 News HD",
    `TITLE:${escapeVcard(reporter.designation)}`,
    `TEL;TYPE=WORK:${escapeVcard(reporter.contact)}`,
    ...(whatsappUrl(reporter.whatsapp) !== whatsappUrl(reporter.contact)
      ? [`TEL;TYPE=CELL:${escapeVcard(reporter.whatsapp)}`]
      : []),
    `ADR;TYPE=WORK:;;;${escapeVcard(reporter.city)};;;Pakistan`,
    "END:VCARD",
    "",
  ].join("\r\n");
}
