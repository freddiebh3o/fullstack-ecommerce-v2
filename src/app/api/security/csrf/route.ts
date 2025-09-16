import { issueCsrfTokenResponse } from "@/lib/security/csrf";

export async function GET() {
  return issueCsrfTokenResponse();
}
