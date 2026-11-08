import { cleanupSignupForms } from "../../src/signup-cleanup";
import { services } from "../../src/runtime";
export const config = { schedule: "0 2 * * *" };
export async function handler() {
  if (!services?.cleanupPhotos) throw new Error("Photo cleanup is not configured");
  const result = await services.cleanupPhotos();
  const signups = await cleanupSignupForms(services.db);
  if (result.failed || signups.failed) throw new Error("Some photo cleanup operations failed; they will be retried");
  return { statusCode: 200 };
}
