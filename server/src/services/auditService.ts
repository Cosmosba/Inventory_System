import prisma from "../config/database.js";

export interface AuditEntry {
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  ipAddress?: string;
}

// Prisma 7 requires its own internal JSON type for Json fields.
// Casting through unknown is the standard workaround for plain objects.
type JsonInput = Parameters<typeof prisma.auditLog.create>[0]["data"]["oldValues"];
function toJson(v: Record<string, unknown> | undefined): JsonInput {
  return v === undefined ? undefined : (v as unknown as JsonInput);
}

/**
 * Write an audit log entry using the global Prisma client.
 * Use writeAuditTx when inside an existing transaction.
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  await prisma.auditLog.create({
    data: {
      ...entry,
      oldValues: toJson(entry.oldValues),
      newValues: toJson(entry.newValues),
    },
  });
}

/**
 * Write an audit log entry inside an existing transaction.
 */
export async function writeAuditTx(
  entry: AuditEntry,
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
): Promise<void> {
  await tx.auditLog.create({
    data: {
      ...entry,
      oldValues: toJson(entry.oldValues),
      newValues: toJson(entry.newValues),
    },
  });
}
