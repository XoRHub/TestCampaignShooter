-- Automatic scheduled campaign launches (cron)
ALTER TABLE "Campaign" ADD COLUMN "scheduleCron" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false;
