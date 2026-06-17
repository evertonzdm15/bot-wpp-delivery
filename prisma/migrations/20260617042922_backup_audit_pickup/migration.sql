-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "auditGroupJid" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "pickupAddress" TEXT;

-- CreateTable
CREATE TABLE "WaGroup" (
    "id" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WaGroup_jid_key" ON "WaGroup"("jid");
