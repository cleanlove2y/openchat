CREATE TABLE IF NOT EXISTS "UserLlmConnections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"userId" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"provider" varchar(64) NOT NULL,
	"baseUrl" text NOT NULL,
	"apiKeyEncrypted" text,
	"defaultModel" text,
	"defaultTemperature" varchar(16),
	"enabled" boolean DEFAULT true NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"lastValidatedAt" timestamp,
	"lastValidationError" text,
	"lastUsedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "UserLlmModelCache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connectionId" uuid NOT NULL,
	"modelsJson" json NOT NULL,
	"fetchedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "connectionId" uuid;--> statement-breakpoint
ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "modelId" varchar;--> statement-breakpoint
ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "activeResumeId" uuid;--> statement-breakpoint
ALTER TABLE "Chat" ADD COLUMN IF NOT EXISTS "awaitingResumeSelection" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "UserLlmConnections" ADD CONSTRAINT "UserLlmConnections_userId_User_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "UserLlmModelCache" ADD CONSTRAINT "UserLlmModelCache_connectionId_UserLlmConnections_id_fk" FOREIGN KEY ("connectionId") REFERENCES "public"."UserLlmConnections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
