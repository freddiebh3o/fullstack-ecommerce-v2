import type { Prisma } from "@prisma/client";

export function assertOne(result: Prisma.BatchPayload, msg = "Expected 1 row affected") {
  if (result.count !== 1) throw new NotFoundError(msg);
}

export class NotFoundError extends Error {
  constructor(msg = "Not found") { super(msg); this.name = "NotFoundError"; }
}
