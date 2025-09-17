import { Prisma } from "@prisma/client";

export function isUniqueViolation(e: unknown, targets?: string[]) {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (e.code !== "P2002") return false;
  if (!targets?.length) return true;
  const t = (e.meta as any)?.target as string[] | undefined;
  if (!t) return true;
  return targets.some(x => t.includes(x));
}
