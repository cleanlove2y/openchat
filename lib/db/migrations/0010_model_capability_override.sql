CREATE TABLE IF NOT EXISTS "ModelCapabilityOverride" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "sourceType" varchar DEFAULT 'system' NOT NULL,
  "connectionId" uuid,
  "providerKey" varchar(64) NOT NULL,
  "modelId" text NOT NULL,
  "capabilitiesJson" json NOT NULL,
  "lastDetectedAt" timestamp DEFAULT now() NOT NULL,
  "lastErrorSignature" text,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  ALTER TABLE "ModelCapabilityOverride"
    ADD CONSTRAINT "ModelCapabilityOverride_connectionId_UserLlmConnections_id_fk"
    FOREIGN KEY ("connectionId") REFERENCES "public"."UserLlmConnections"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DROP INDEX IF EXISTS "ModelCapabilityOverride_target_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ModelCapabilityOverride_system_target_unique"
  ON "ModelCapabilityOverride" ("sourceType", "modelId")
  WHERE "sourceType" = 'system';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ModelCapabilityOverride_user_connection_target_unique"
  ON "ModelCapabilityOverride" ("sourceType", "connectionId", "modelId")
  WHERE "sourceType" = 'user_connection' AND "connectionId" IS NOT NULL;
