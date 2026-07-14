CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "FetchStatus" AS ENUM ('OK', 'EMPTY', 'ERROR');

-- CreateTable
CREATE TABLE "RateType" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateType_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "CurvePoint" (
    "rateCode" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "days" INTEGER NOT NULL,
    "rate252" DECIMAL(12,6),
    "rate360" DECIMAL(12,6),

    CONSTRAINT "CurvePoint_pkey" PRIMARY KEY ("rateCode","date","days")
);

-- CreateTable
CREATE TABLE "FetchLog" (
    "rateCode" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "FetchStatus" NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FetchLog_pkey" PRIMARY KEY ("rateCode","date")
);

-- CreateIndex
CREATE INDEX "CurvePoint_rateCode_days_date_idx" ON "CurvePoint"("rateCode", "days", "date");

-- CreateIndex
CREATE INDEX "FetchLog_status_date_idx" ON "FetchLog"("status", "date");

-- AddForeignKey
ALTER TABLE "CurvePoint" ADD CONSTRAINT "CurvePoint_rateCode_fkey" FOREIGN KEY ("rateCode") REFERENCES "RateType"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FetchLog" ADD CONSTRAINT "FetchLog_rateCode_fkey" FOREIGN KEY ("rateCode") REFERENCES "RateType"("code") ON DELETE CASCADE ON UPDATE CASCADE;

