ALTER TABLE "PlatformLegalContent"
ADD COLUMN IF NOT EXISTS "privacyPolicySections" JSONB,
ADD COLUMN IF NOT EXISTS "termsAndConditionsSections" JSONB;
