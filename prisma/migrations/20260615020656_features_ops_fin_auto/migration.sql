-- CreateEnum
CREATE TYPE "MotoboyStatus" AS ENUM ('DISPONIVEL', 'OCUPADO', 'OFFLINE');

-- AlterTable
ALTER TABLE "Admin" ADD COLUMN     "platformFeePercent" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Lancamento" ADD COLUMN     "paid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paidAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "priority" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "status" "MotoboyStatus" NOT NULL DEFAULT 'DISPONIVEL';

-- AlterTable
ALTER TABLE "UserRole" ADD COLUMN     "autoAssign" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Lancamento_motoboyId_paid_idx" ON "Lancamento"("motoboyId", "paid");
