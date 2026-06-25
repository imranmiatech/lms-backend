CREATE INDEX IF NOT EXISTS "User_role_createdAt_idx" ON "User"("role", "createdAt");

CREATE INDEX IF NOT EXISTS "Payment_userId_status_idx" ON "Payment"("userId", "status");
CREATE INDEX IF NOT EXISTS "Payment_userId_type_status_idx" ON "Payment"("userId", "type", "status");
CREATE INDEX IF NOT EXISTS "Payment_tutorId_status_idx" ON "Payment"("tutorId", "status");
CREATE INDEX IF NOT EXISTS "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Payment_status_payoutStatus_idx" ON "Payment"("status", "payoutStatus");
