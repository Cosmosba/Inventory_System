-- AlterTable
ALTER TABLE "asset_assignments" ADD COLUMN     "expectedReturnDate" DATE,
ADD COLUMN     "returnCondition" "AssetCondition",
ADD COLUMN     "returnNotes" TEXT;
