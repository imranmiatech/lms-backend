CREATE TABLE "PlatformLegalContent" (
    "id" TEXT NOT NULL,
    "privacyPolicy" TEXT,
    "termsAndConditions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformLegalContent_pkey" PRIMARY KEY ("id")
);
