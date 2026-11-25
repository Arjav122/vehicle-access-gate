-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'guard', 'resident');

-- CreateEnum
CREATE TYPE "ResidentType" AS ENUM ('owner', 'tenant', 'family');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('car', 'two_wheeler');

-- CreateEnum
CREATE TYPE "LaneDirection" AS ENUM ('entry', 'exit');

-- CreateEnum
CREATE TYPE "MatchResult" AS ENUM ('resident', 'visitor', 'guest_pass', 'watchlist', 'low_confidence', 'ambiguous', 'unknown');

-- CreateEnum
CREATE TYPE "AlertKind" AS ENUM ('watchlist');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "VisitCategory" AS ENUM ('guest', 'delivery', 'cab', 'service');

-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('pending_approval', 'approved', 'denied', 'expired', 'inside', 'overstayed', 'escalated', 'exited');

-- CreateEnum
CREATE TYPE "VisitTrigger" AS ENUM ('create', 'approve', 'deny', 'expire', 'enter', 'overstay', 'escalate', 'exit');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('pending', 'approved', 'denied', 'timed_out');

-- CreateEnum
CREATE TYPE "ApprovalChannel" AS ENUM ('web', 'telegram', 'guard');

-- CreateEnum
CREATE TYPE "EscalationStatus" AS ENUM ('open', 'resolved');

-- CreateEnum
CREATE TYPE "EscalationOutcome" AS ENUM ('reached', 'not_reached', 'vehicle_left');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('email', 'telegram');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('pending', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "ReconciliationKind" AS ENUM ('exit_without_entry', 'entry_never_closed', 'stale_visit');

-- CreateTable
CREATE TABLE "society_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "guest_minutes" INTEGER NOT NULL,
    "delivery_minutes" INTEGER NOT NULL,
    "cab_minutes" INTEGER NOT NULL,
    "service_minutes" INTEGER NOT NULL,
    "approval_timeout_seconds" INTEGER NOT NULL,
    "confidence_threshold" DOUBLE PRECISION NOT NULL,
    "visitor_retention_days" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "society_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flats" (
    "id" UUID NOT NULL,
    "block" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "floor" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "flats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "role" "Role" NOT NULL,
    "password_hash" TEXT NOT NULL,
    "telegram_chat_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "residents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "flat_id" UUID NOT NULL,
    "resident_type" "ResidentType" NOT NULL,
    "is_primary_contact" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "residents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "jti" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "flat_id" UUID NOT NULL,
    "plate_raw" TEXT NOT NULL,
    "plate_normalized" TEXT NOT NULL,
    "vehicle_type" "VehicleType" NOT NULL,
    "make_model" TEXT,
    "colour" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlist" (
    "id" UUID NOT NULL,
    "plate_raw" TEXT NOT NULL,
    "plate_normalized" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "watchlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "gates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "gate_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "direction" "LaneDirection" NOT NULL,
    "api_key_hash" TEXT NOT NULL,
    "api_key_prefix" TEXT NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gate_events" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "gate_id" UUID NOT NULL,
    "direction" "LaneDirection" NOT NULL,
    "plate_raw" TEXT NOT NULL,
    "plate_normalized" TEXT NOT NULL,
    "ocr_fixes" INTEGER NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL,
    "snapshot_key" TEXT,
    "captured_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "event_hash" TEXT NOT NULL,
    "match_result" "MatchResult" NOT NULL,
    "match_distance" INTEGER,
    "vehicle_id" UUID,
    "visit_id" UUID,
    "paired_event_id" UUID,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "review_reason" TEXT,
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gate_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plate_corrections" (
    "id" UUID NOT NULL,
    "gate_event_id" UUID NOT NULL,
    "original_plate" TEXT NOT NULL,
    "corrected_plate" TEXT NOT NULL,
    "guard_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plate_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" UUID NOT NULL,
    "gate_event_id" UUID NOT NULL,
    "kind" "AlertKind" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "message" TEXT NOT NULL,
    "acknowledged_at" TIMESTAMPTZ(3),
    "acknowledged_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visitors" (
    "id" UUID NOT NULL,
    "full_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "purged_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visits" (
    "id" UUID NOT NULL,
    "flat_id" UUID NOT NULL,
    "visitor_id" UUID,
    "guest_pass_id" UUID,
    "plate_normalized" TEXT,
    "category" "VisitCategory" NOT NULL,
    "purpose" TEXT,
    "status" "VisitStatus" NOT NULL,
    "entry_event_id" UUID,
    "exit_event_id" UUID,
    "entered_at" TIMESTAMPTZ(3),
    "expected_exit_at" TIMESTAMPTZ(3),
    "exited_at" TIMESTAMPTZ(3),
    "duration_minutes" INTEGER,
    "agreed_duration_minutes" INTEGER,
    "approved_by_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_status_changes" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "from_status" "VisitStatus",
    "to_status" "VisitStatus" NOT NULL,
    "trigger" "VisitTrigger" NOT NULL,
    "actor_user_id" UUID,
    "gate_event_id" UUID,
    "changed_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "visit_status_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "channel" "ApprovalChannel",
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_passes" (
    "id" UUID NOT NULL,
    "flat_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "guest_name" TEXT,
    "plate_normalized" TEXT,
    "code_hash" TEXT,
    "valid_from" TIMESTAMPTZ(3) NOT NULL,
    "valid_until" TIMESTAMPTZ(3) NOT NULL,
    "max_uses" INTEGER NOT NULL,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_passes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation_tasks" (
    "id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "status" "EscalationStatus" NOT NULL DEFAULT 'open',
    "outcome" "EscalationOutcome",
    "notes" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escalation_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "kind" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "body_text" TEXT NOT NULL,
    "body_html" TEXT,
    "status" "NotificationStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_flags" (
    "id" UUID NOT NULL,
    "kind" "ReconciliationKind" NOT NULL,
    "subject_id" UUID NOT NULL,
    "gate_event_id" UUID,
    "visit_id" UUID,
    "details" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "changes" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "flats_block_number_key" ON "flats"("block", "number");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_telegram_chat_id_key" ON "users"("telegram_chat_id");

-- CreateIndex
CREATE INDEX "residents_flat_id_idx" ON "residents"("flat_id");

-- CreateIndex
CREATE UNIQUE INDEX "residents_user_flat_key" ON "residents"("user_id", "flat_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_jti_key" ON "refresh_tokens"("jti");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_plate_normalized_key" ON "vehicles"("plate_normalized");

-- CreateIndex
CREATE INDEX "vehicles_flat_id_idx" ON "vehicles"("flat_id");

-- CreateIndex
CREATE UNIQUE INDEX "watchlist_plate_normalized_key" ON "watchlist"("plate_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "gates_name_key" ON "gates"("name");

-- CreateIndex
CREATE UNIQUE INDEX "devices_api_key_hash_key" ON "devices"("api_key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "devices_gate_name_key" ON "devices"("gate_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "gate_events_event_hash_key" ON "gate_events"("event_hash");

-- CreateIndex
CREATE UNIQUE INDEX "gate_events_paired_event_id_key" ON "gate_events"("paired_event_id");

-- CreateIndex
CREATE INDEX "gate_events_debounce_idx" ON "gate_events"("device_id", "plate_normalized", "last_seen_at");

-- CreateIndex
CREATE INDEX "gate_events_captured_at_idx" ON "gate_events"("captured_at");

-- CreateIndex
CREATE INDEX "gate_events_plate_normalized_idx" ON "gate_events"("plate_normalized");

-- CreateIndex
CREATE INDEX "alerts_created_at_idx" ON "alerts"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "visits_entry_event_id_key" ON "visits"("entry_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "visits_exit_event_id_key" ON "visits"("exit_event_id");

-- CreateIndex
CREATE INDEX "visits_status_idx" ON "visits"("status");

-- CreateIndex
CREATE INDEX "visits_flat_created_idx" ON "visits"("flat_id", "created_at");

-- CreateIndex
CREATE INDEX "visits_plate_normalized_idx" ON "visits"("plate_normalized");

-- CreateIndex
CREATE INDEX "visit_status_changes_visit_idx" ON "visit_status_changes"("visit_id", "changed_at");

-- CreateIndex
CREATE UNIQUE INDEX "approvals_visit_id_key" ON "approvals"("visit_id");

-- CreateIndex
CREATE UNIQUE INDEX "guest_passes_code_hash_key" ON "guest_passes"("code_hash");

-- CreateIndex
CREATE INDEX "guest_passes_plate_normalized_idx" ON "guest_passes"("plate_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "escalation_tasks_visit_id_key" ON "escalation_tasks"("visit_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_idempotency_key_key" ON "notifications"("idempotency_key");

-- CreateIndex
CREATE INDEX "notifications_due_idx" ON "notifications"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_flags_kind_subject_key" ON "reconciliation_flags"("kind", "subject_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- AddForeignKey
ALTER TABLE "residents" ADD CONSTRAINT "residents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "residents" ADD CONSTRAINT "residents_flat_id_fkey" FOREIGN KEY ("flat_id") REFERENCES "flats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_flat_id_fkey" FOREIGN KEY ("flat_id") REFERENCES "flats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_gate_id_fkey" FOREIGN KEY ("gate_id") REFERENCES "gates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_gate_id_fkey" FOREIGN KEY ("gate_id") REFERENCES "gates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_paired_event_id_fkey" FOREIGN KEY ("paired_event_id") REFERENCES "gate_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plate_corrections" ADD CONSTRAINT "plate_corrections_gate_event_id_fkey" FOREIGN KEY ("gate_event_id") REFERENCES "gate_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plate_corrections" ADD CONSTRAINT "plate_corrections_guard_id_fkey" FOREIGN KEY ("guard_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_gate_event_id_fkey" FOREIGN KEY ("gate_event_id") REFERENCES "gate_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_acknowledged_by_id_fkey" FOREIGN KEY ("acknowledged_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_flat_id_fkey" FOREIGN KEY ("flat_id") REFERENCES "flats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_visitor_id_fkey" FOREIGN KEY ("visitor_id") REFERENCES "visitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_guest_pass_id_fkey" FOREIGN KEY ("guest_pass_id") REFERENCES "guest_passes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_entry_event_id_fkey" FOREIGN KEY ("entry_event_id") REFERENCES "gate_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_exit_event_id_fkey" FOREIGN KEY ("exit_event_id") REFERENCES "gate_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_status_changes" ADD CONSTRAINT "visit_status_changes_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_status_changes" ADD CONSTRAINT "visit_status_changes_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_status_changes" ADD CONSTRAINT "visit_status_changes_gate_event_id_fkey" FOREIGN KEY ("gate_event_id") REFERENCES "gate_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_passes" ADD CONSTRAINT "guest_passes_flat_id_fkey" FOREIGN KEY ("flat_id") REFERENCES "flats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_passes" ADD CONSTRAINT "guest_passes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_tasks" ADD CONSTRAINT "escalation_tasks_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_tasks" ADD CONSTRAINT "escalation_tasks_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_flags" ADD CONSTRAINT "reconciliation_flags_gate_event_id_fkey" FOREIGN KEY ("gate_event_id") REFERENCES "gate_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_flags" ADD CONSTRAINT "reconciliation_flags_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_flags" ADD CONSTRAINT "reconciliation_flags_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Hand-written rules Prisma's schema language cannot express (brief §8)
-- =====================================================================

-- society_settings is a single row.
ALTER TABLE "society_settings" ADD CONSTRAINT "society_settings_single_row_check" CHECK ("id" = 1);
ALTER TABLE "society_settings" ADD CONSTRAINT "society_settings_positive_check" CHECK (
  "guest_minutes" > 0 AND "delivery_minutes" > 0 AND "cab_minutes" > 0 AND "service_minutes" > 0
  AND "approval_timeout_seconds" > 0 AND "visitor_retention_days" > 0
);
ALTER TABLE "society_settings" ADD CONSTRAINT "society_settings_confidence_check" CHECK ("confidence_threshold" BETWEEN 0 AND 1);

-- Emails are stored lower-case, so the unique index is case-insensitive in practice.
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase_check" CHECK ("email" = lower("email"));

-- At most one primary contact per flat.
CREATE UNIQUE INDEX "residents_one_primary_per_flat_key" ON "residents"("flat_id") WHERE "is_primary_contact";

-- Plates: cleaned form is upper-case letters and digits only.
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_plate_normalized_check" CHECK ("plate_normalized" ~ '^[A-Z0-9]{4,12}$');
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_plate_normalized_check" CHECK ("plate_normalized" ~ '^[A-Z0-9]{4,12}$');

-- Gate events.
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_confidence_check" CHECK ("confidence" BETWEEN 0 AND 1);
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_match_distance_check" CHECK ("match_distance" IS NULL OR "match_distance" IN (0, 1));
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_ocr_fixes_check" CHECK ("ocr_fixes" >= 0);
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_last_seen_check" CHECK ("last_seen_at" >= "captured_at");
ALTER TABLE "gate_events" ADD CONSTRAINT "gate_events_not_self_paired_check" CHECK ("paired_event_id" IS NULL OR "paired_event_id" <> "id");
-- The open review queue: reads that still need a guard, oldest first.
CREATE INDEX "gate_events_open_review_idx" ON "gate_events"("created_at") WHERE "needs_review" AND "reviewed_at" IS NULL;

-- Visits.
ALTER TABLE "visits" ADD CONSTRAINT "visits_duration_check" CHECK ("duration_minutes" IS NULL OR "duration_minutes" >= 0);
ALTER TABLE "visits" ADD CONSTRAINT "visits_agreed_duration_check" CHECK ("agreed_duration_minutes" IS NULL OR "agreed_duration_minutes" > 0);
ALTER TABLE "visits" ADD CONSTRAINT "visits_exit_after_entry_check" CHECK ("exited_at" IS NULL OR "entered_at" IS NULL OR "exited_at" >= "entered_at");

-- Guest passes: a plate or a code (or both), a sane window, and never more uses than allowed.
ALTER TABLE "guest_passes" ADD CONSTRAINT "guest_passes_plate_or_code_check" CHECK ("plate_normalized" IS NOT NULL OR "code_hash" IS NOT NULL);
ALTER TABLE "guest_passes" ADD CONSTRAINT "guest_passes_window_check" CHECK ("valid_until" > "valid_from");
ALTER TABLE "guest_passes" ADD CONSTRAINT "guest_passes_max_uses_check" CHECK ("max_uses" >= 1);
ALTER TABLE "guest_passes" ADD CONSTRAINT "guest_passes_use_count_check" CHECK ("use_count" >= 0 AND "use_count" <= "max_uses");

-- Escalation tasks: an outcome exactly when resolved.
ALTER TABLE "escalation_tasks" ADD CONSTRAINT "escalation_tasks_outcome_check" CHECK (("status" = 'resolved') = ("outcome" IS NOT NULL));

-- Notifications.
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_attempts_check" CHECK ("attempts" >= 0);
