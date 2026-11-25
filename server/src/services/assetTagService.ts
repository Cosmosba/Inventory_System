/**
 * Asset Tag Generation Service
 *
 * Tag format: {PREFIX}-{YEAR}-{SEQ}
 *   PREFIX  — category tagPrefix (2–5 uppercase letters)
 *   YEAR    — 4-digit calendar year of registration
 *   SEQ     — monotonically increasing sequence, minimum 4 digits (zero-padded)
 *             e.g. 0001, 0042, 9999, 10000
 *
 * Concurrency strategy:
 *   - READ COMMITTED isolation (PostgreSQL default).
 *   - Row-level lock via SELECT ... FOR UPDATE on the sequence row.
 *   - Atomic upsert: INSERT ... ON CONFLICT DO UPDATE with the locked row.
 *   - Sequence allocation commits in its own transaction BEFORE the asset insert.
 *   - If the asset insert fails with P2002 on the asset_tag unique constraint,
 *     the caller retries (up to MAX_RETRIES = 10).
 *   - Only P2002 on the asset_tag constraint triggers a retry.
 *     All other errors propagate immediately.
 */

import prisma from "../config/database.js";

export const MAX_TAG_RETRIES = 10;
const INT_MAX = 2_147_483_647; // PostgreSQL INTEGER max

export class AssetTagError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = "AssetTagError";
  }
}

/**
 * Format a sequence number with minimum 4-digit zero-padding.
 * Sequences >= 10000 are not padded (they are already ≥ 5 digits).
 */
export function formatSequence(seq: number): string {
  return seq.toString().padStart(4, "0");
}

/**
 * Build the asset tag string from its components.
 */
export function buildAssetTag(prefix: string, year: number, seq: number): string {
  return `${prefix}-${year}-${formatSequence(seq)}`;
}

/**
 * Allocate the next sequence number for a given category/year combination.
 *
 * Uses a raw SQL upsert with SELECT FOR UPDATE to prevent concurrent
 * double-allocation. The sequence row is locked for the duration of the
 * allocation transaction, which commits immediately after incrementing.
 *
 * Returns the newly allocated sequence number.
 */
export async function allocateNextSequence(
  assetCategoryId: string,
  year: number
): Promise<number> {
  return await prisma.$transaction(async (tx) => {
    // Lock the existing row if it exists, or proceed to upsert.
    // We use $queryRaw to issue SELECT ... FOR UPDATE which Prisma does not
    // expose natively.
    const existing = await tx.$queryRaw<Array<{ lastSequence: number }>>`
      SELECT "lastSequence"
      FROM   "asset_tag_sequences"
      WHERE  "assetCategoryId" = ${assetCategoryId}::uuid
        AND  "year" = ${year}::smallint
      FOR UPDATE
    `;

    let nextSeq: number;

    if (existing.length === 0) {
      // First asset in this category/year — insert with lastSequence = 1.
      await tx.$executeRaw`
        INSERT INTO "asset_tag_sequences"
          ("id", "assetCategoryId", "year", "lastSequence", "createdAt", "updatedAt")
        VALUES
          (gen_random_uuid(), ${assetCategoryId}::uuid, ${year}::smallint, 1,
           NOW(), NOW())
        ON CONFLICT ("assetCategoryId", "year")
        DO UPDATE SET
          "lastSequence" = "asset_tag_sequences"."lastSequence" + 1,
          "updatedAt"    = NOW()
      `;
      nextSeq = 1;
    } else {
      const current = Number(existing[0].lastSequence);
      if (current >= INT_MAX) {
        throw new AssetTagError(
          "Asset tag sequence exhausted for this category and year.",
          "SEQUENCE_EXHAUSTED"
        );
      }
      nextSeq = current + 1;
      await tx.$executeRaw`
        UPDATE "asset_tag_sequences"
        SET    "lastSequence" = ${nextSeq},
               "updatedAt"   = NOW()
        WHERE  "assetCategoryId" = ${assetCategoryId}::uuid
          AND  "year" = ${year}::smallint
      `;
    }

    return nextSeq;
  });
}

/**
 * Generate a unique asset tag for the given category and year.
 *
 * Allocates a sequence number, builds the tag, and returns it.
 * The caller is responsible for inserting the asset and retrying
 * on P2002 (asset_tag unique constraint) up to MAX_TAG_RETRIES times.
 */
export async function generateAssetTag(
  assetCategoryId: string,
  tagPrefix: string,
  year: number
): Promise<string> {
  const seq = await allocateNextSequence(assetCategoryId, year);
  return buildAssetTag(tagPrefix, year, seq);
}
