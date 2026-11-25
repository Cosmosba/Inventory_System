-- Add missing CHECK constraints for purchase quantity fields documented in schema.prisma.
-- These were omitted from the original Stage 5.4 migration (20261125125405_add_purchasing_receiving).

-- PurchaseItem: quantityReceived must be >= 0
ALTER TABLE "purchase_items"
  ADD CONSTRAINT "purchase_items_quantity_received_non_negative"
  CHECK ("quantityReceived" >= 0);

-- PurchaseItem: quantityReceived must not exceed ordered quantity
ALTER TABLE "purchase_items"
  ADD CONSTRAINT "purchase_items_quantity_received_lte_quantity"
  CHECK ("quantityReceived" <= quantity);

-- PurchaseReceiptItem: quantityReceived must be strictly positive
ALTER TABLE "purchase_receipt_items"
  ADD CONSTRAINT "purchase_receipt_items_quantity_received_positive"
  CHECK ("quantityReceived" > 0);
