CREATE TABLE "lukas_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lukas_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"steps" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lukas_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"message_id" integer,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lukas_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer,
	"tool" text NOT NULL,
	"risk_tier" text NOT NULL,
	"arguments_hash" text NOT NULL,
	"arguments_preview" text NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lukas_code_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer,
	"repo" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"reasoning" text DEFAULT '' NOT NULL,
	"files" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"comment" text,
	"applied_result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lukas_mcp_servers" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"last_error" text,
	"client_info" jsonb,
	"tokens" jsonb,
	"code_verifier" text,
	"oauth_state" text,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tools_updated_at" timestamp with time zone,
	"selected_tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risk_tier" text DEFAULT 'R2' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lukas_character" (
	"id" serial PRIMARY KEY NOT NULL,
	"traits" jsonb NOT NULL,
	"self_image" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lukas_debug_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lukas_diary" (
	"id" serial PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"mood" text DEFAULT 'neutral' NOT NULL,
	"energy" text DEFAULT 'normal' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lukas_emotions" (
	"id" serial PRIMARY KEY NOT NULL,
	"emotion" text NOT NULL,
	"valence" real NOT NULL,
	"intensity" real NOT NULL,
	"cause" text NOT NULL,
	"source" text DEFAULT 'chat' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lukas_goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"progress" text DEFAULT 'just started' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lukas_status" (
	"id" serial PRIMARY KEY NOT NULL,
	"mood" text DEFAULT 'neutral' NOT NULL,
	"energy" text DEFAULT 'normal' NOT NULL,
	"obsession" text DEFAULT 'nothing specific' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lukas_media_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_id" text,
	"model" text NOT NULL,
	"prompt" text NOT NULL,
	"vision" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"result_url" text,
	"media_type" text DEFAULT 'image' NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lukas_memories" (
	"id" serial PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"category" text DEFAULT 'personal' NOT NULL,
	"importance" integer DEFAULT 5 NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"embedding" jsonb DEFAULT 'null'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lukas_tageskosten" (
	"id" serial PRIMARY KEY NOT NULL,
	"tag" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"aufrufe" integer DEFAULT 0 NOT NULL,
	"rein" integer DEFAULT 0 NOT NULL,
	"raus" integer DEFAULT 0 NOT NULL,
	"aus_cache" integer DEFAULT 0 NOT NULL,
	"in_cache" integer DEFAULT 0 NOT NULL,
	"aktualisiert" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"bot" text NOT NULL,
	"market_slug" text,
	"market_question" text,
	"side" text,
	"shares" numeric,
	"entry_price" numeric,
	"stake" numeric,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now(),
	"exit_price" numeric,
	"payout" numeric,
	"pnl" numeric,
	"closed_at" timestamp with time zone,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "bankroll_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"bot" text NOT NULL,
	"balance" numeric NOT NULL,
	"base" numeric,
	"pnl" numeric,
	"open_pos" numeric,
	"note" text,
	"recorded_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lukas_claims" (
	"id" serial PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"predicate" text NOT NULL,
	"value" text NOT NULL,
	"confidence" real DEFAULT 0.35 NOT NULL,
	"evidence_level" integer DEFAULT 2 NOT NULL,
	"source_type" text DEFAULT 'unknown' NOT NULL,
	"source_id" text,
	"observed_at" timestamp DEFAULT now() NOT NULL,
	"last_verified_at" timestamp,
	"status" text DEFAULT 'unverified' NOT NULL,
	"episode_id" integer,
	"corroborations" integer DEFAULT 1 NOT NULL,
	"embedding" jsonb DEFAULT 'null'::jsonb
);
--> statement-breakpoint
CREATE TABLE "lukas_episodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "lukas_erfahrungen" (
	"id" serial PRIMARY KEY NOT NULL,
	"werkzeug" text NOT NULL,
	"kontext" text DEFAULT '' NOT NULL,
	"gelungen" boolean NOT NULL,
	"grund" text DEFAULT '' NOT NULL,
	"conversation_id" integer,
	"episode_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lukas_known_agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"platform" text DEFAULT 'moltbook' NOT NULL,
	"first_seen" timestamp DEFAULT now() NOT NULL,
	"last_seen" timestamp DEFAULT now() NOT NULL,
	"trust_score" real DEFAULT 0.5 NOT NULL,
	"relationship_strength" real DEFAULT 0.1 NOT NULL,
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lukas_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"episode_id" integer,
	"type" text NOT NULL,
	"strategy" text,
	"target" text,
	"content_excerpt" text DEFAULT '' NOT NULL,
	"outcome" jsonb DEFAULT 'null'::jsonb,
	"outcome_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lukas_strategies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"rule" text DEFAULT '' NOT NULL,
	"success_score" real DEFAULT 0.5 NOT NULL,
	"sample_size" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lukas_subagents" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"prompt" text NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"zweck" text,
	"einsaetze" integer DEFAULT 0 NOT NULL,
	"zuletzt_genutzt" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lukas_subagents_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "lukas_meldungen" (
	"id" serial PRIMARY KEY NOT NULL,
	"betreff" text NOT NULL,
	"text" text NOT NULL,
	"dringend" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'offen' NOT NULL,
	"antwort" text,
	"gelesen" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"erledigt_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lukas_sms" (
	"id" serial PRIMARY KEY NOT NULL,
	"richtung" text DEFAULT 'raus' NOT NULL,
	"nummer" text NOT NULL,
	"text" text NOT NULL,
	"quelle" text DEFAULT 'dashboard' NOT NULL,
	"status" text DEFAULT 'offen' NOT NULL,
	"anbieter_id" text,
	"preis" text,
	"fingerabdruck" text,
	"fehler" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lukas_telefon_anrufe" (
	"id" serial PRIMARY KEY NOT NULL,
	"richtung" text NOT NULL,
	"nummer" text NOT NULL,
	"ergebnis" text NOT NULL,
	"stufe" text DEFAULT 'oeffentlich' NOT NULL,
	"anlass" text DEFAULT '' NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lukas_telefon_nummern" (
	"id" serial PRIMARY KEY NOT NULL,
	"nummer" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"stufe" text DEFAULT 'oeffentlich' NOT NULL,
	"darf_angerufen_werden" boolean DEFAULT false NOT NULL,
	"notiz" text DEFAULT '' NOT NULL,
	"zuletzt_gesehen" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lukas_messages" ADD CONSTRAINT "lukas_messages_conversation_id_lukas_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."lukas_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lukas_attachments" ADD CONSTRAINT "lukas_attachments_conversation_id_lukas_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."lukas_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lukas_memories_tags_idx" ON "lukas_memories" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "lukas_memories_kategorie_idx" ON "lukas_memories" USING btree ("category");--> statement-breakpoint
CREATE UNIQUE INDEX "lukas_tageskosten_tag_modell_idx" ON "lukas_tageskosten" USING btree ("tag","provider","model");--> statement-breakpoint
CREATE INDEX "lukas_claims_subject_idx" ON "lukas_claims" USING btree ("subject");--> statement-breakpoint
CREATE INDEX "lukas_claims_wert_idx" ON "lukas_claims" USING btree (lower(regexp_replace(btrim("value"), '\s+', '_', 'g')));--> statement-breakpoint
CREATE INDEX "lukas_claims_episode_idx" ON "lukas_claims" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "erfahrungen_schluessel_idx" ON "lukas_erfahrungen" USING btree ("werkzeug","kontext","created_at");--> statement-breakpoint
CREATE INDEX "lukas_sms_nummer_idx" ON "lukas_sms" USING btree ("nummer");--> statement-breakpoint
CREATE INDEX "lukas_sms_fingerabdruck_idx" ON "lukas_sms" USING btree ("fingerabdruck","created_at");--> statement-breakpoint
CREATE INDEX "lukas_telefon_nummer_idx" ON "lukas_telefon_nummern" USING btree ("nummer");