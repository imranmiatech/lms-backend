CREATE TABLE "PlatformSetting" (
    "id" TEXT NOT NULL,
    "platformName" TEXT,
    "contactEmail" TEXT,
    "location" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("id")
);
