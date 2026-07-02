-- DropIndex
DROP INDEX "Payment_holdUntil_idx";

-- DropIndex
DROP INDEX "Payment_paidAt_idx";

-- DropIndex
DROP INDEX "PaymentInformation_stripeAccountId_idx";

-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "currency" SET DEFAULT 'eur',
ALTER COLUMN "type" DROP DEFAULT;

-- RenameIndex
ALTER INDEX "LiveClassMessage_roomType_courseId_curriculumIndex_createdAt_id" RENAME TO "LiveClassMessage_roomType_courseId_curriculumIndex_createdA_idx";
