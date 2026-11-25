-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "receiptItemId" UUID;

-- AlterTable
ALTER TABLE "purchase_items" ADD COLUMN     "quantityReceived" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "receiptItemId" UUID;

-- CreateTable
CREATE TABLE "purchase_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "purchaseId" UUID NOT NULL,
    "receivedByUserId" UUID,
    "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "documentReference" VARCHAR(255),
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_receipt_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "receiptId" UUID NOT NULL,
    "purchaseItemId" UUID NOT NULL,
    "quantityReceived" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_receipts_purchaseId_idx" ON "purchase_receipts"("purchaseId");

-- CreateIndex
CREATE INDEX "purchase_receipt_items_receiptId_idx" ON "purchase_receipt_items"("receiptId");

-- CreateIndex
CREATE INDEX "purchase_receipt_items_purchaseItemId_idx" ON "purchase_receipt_items"("purchaseItemId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_receipt_items_receiptId_purchaseItemId_key" ON "purchase_receipt_items"("receiptId", "purchaseItemId");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_receiptItemId_fkey" FOREIGN KEY ("receiptItemId") REFERENCES "purchase_receipt_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_receiptItemId_fkey" FOREIGN KEY ("receiptItemId") REFERENCES "purchase_receipt_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_receivedByUserId_fkey" FOREIGN KEY ("receivedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "purchase_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_items" ADD CONSTRAINT "purchase_receipt_items_purchaseItemId_fkey" FOREIGN KEY ("purchaseItemId") REFERENCES "purchase_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
