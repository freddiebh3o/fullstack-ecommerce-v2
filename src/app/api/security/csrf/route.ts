// src/app/api/security/csrf/route.ts
import { issueCsrfTokenResponse } from "@/lib/security/csrf";
import { withApi } from "@/lib/utils/with-api";

export const GET = withApi(async (req: Request) => {
  return issueCsrfTokenResponse(req);
});
