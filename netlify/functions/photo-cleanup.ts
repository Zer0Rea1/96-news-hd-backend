import { services } from "../../src/runtime";
export const config = { schedule: "0 2 * * *" };
export async function handler() {
  if (!services?.cleanupPhotos) throw new Error("Photo cleanup is not configured");
  const result = await services.cleanupPhotos();
  if (result.failed) throw new Error("Some photo cleanup operations failed; they will be retried");
  return { statusCode: 200 };
}
