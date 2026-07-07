-- CreateTable
CREATE TABLE "StudentFavoriteTutor" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "tutorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentFavoriteTutor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudentFavoriteTutor_studentId_idx" ON "StudentFavoriteTutor"("studentId");

-- CreateIndex
CREATE INDEX "StudentFavoriteTutor_tutorId_idx" ON "StudentFavoriteTutor"("tutorId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentFavoriteTutor_studentId_tutorId_key" ON "StudentFavoriteTutor"("studentId", "tutorId");

-- AddForeignKey
ALTER TABLE "StudentFavoriteTutor" ADD CONSTRAINT "StudentFavoriteTutor_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentFavoriteTutor" ADD CONSTRAINT "StudentFavoriteTutor_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
