-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('b2c', 'b2b', 'warranty', 'from_defect', 'inspection');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('new', 'estimated', 'pending_approval', 'approved', 'assigned', 'master_departed', 'in_progress', 'addwork_approval', 'completed', 'verified', 'awaiting_payment', 'closed', 'rated', 'cancelled', 'dispute');

-- CreateEnum
CREATE TYPE "OrderPause" AS ENUM ('awaiting_materials', 'tech_break', 'blocked_third_party');

-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('normal', 'urgent', 'emergency');

-- CreateEnum
CREATE TYPE "PaymentChannel" AS ENUM ('subscription', 'invoice', 'online', 'cash');

-- CreateEnum
CREATE TYPE "PhotoStage" AS ENUM ('before', 'during', 'after', 'receipt', 'defect');

-- CreateEnum
CREATE TYPE "QuoteKind" AS ENUM ('initial', 'approved', 'additional', 'conservation');

-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('draft', 'scheduled', 'active', 'archived');

-- CreateEnum
CREATE TYPE "DefectStatus" AS ENUM ('new', 'pending_approval', 'approved', 'postponed', 'rejected', 'resolved');

-- CreateEnum
CREATE TYPE "RoleKind" AS ENUM ('b2c_client', 'location_employee', 'location_manager', 'org_manager', 'org_owner', 'master', 'dispatcher', 'accountant', 'admin');

-- CreateEnum
CREATE TYPE "BuildingConnectionStatus" AS ENUM ('unmanaged', 'claimed', 'verified', 'active', 'degraded');

-- CreateEnum
CREATE TYPE "BuildingType" AS ENUM ('residential', 'business_center', 'mixed');

-- CreateEnum
CREATE TYPE "OrderScope" AS ENUM ('private', 'common_area');

-- CreateEnum
CREATE TYPE "LaborSettlement" AS ENUM ('salary', 'share');

-- CreateEnum
CREATE TYPE "PermitStatus" AS ENUM ('draft', 'requested', 'approved', 'rescheduled', 'rejected', 'scheduled', 'opened', 'closed', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "PermitApprovalKind" AS ENUM ('manual', 'auto_silence', 'emergency_override');

-- CreateEnum
CREATE TYPE "ShutdownStatus" AS ENUM ('draft', 'scheduled', 'active', 'restored', 'cancelled');

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('cold_water', 'hot_water', 'heating', 'electricity', 'gas', 'sewage', 'lift', 'ventilation');

-- CreateEnum
CREATE TYPE "PassType" AS ENUM ('master', 'helper', 'guest', 'resident_contractor', 'operator_contractor');

-- CreateEnum
CREATE TYPE "ResidentRole" AS ENUM ('owner', 'tenant', 'family');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('master', 'approver', 'dispatcher', 'engineer', 'head', 'admin');

-- CreateEnum
CREATE TYPE "ObservationSeverity" AS ENUM ('emergency', 'work_required', 'housekeeping', 'info');

-- CreateEnum
CREATE TYPE "ObservationSource" AS ENUM ('walkthrough', 'resident', 'master', 'complaint');

-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('free', 'pro', 'enterprise');

-- CreateEnum
CREATE TYPE "BillingUnit" AS ENUM ('per_object', 'per_unit');

-- CreateEnum
CREATE TYPE "TenantKind" AS ENUM ('hoa', 'bc', 'inhouse', 'fm');

-- CreateTable
CREATE TABLE "organization" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "inn" TEXT NOT NULL,
    "vat_payer" BOOLEAN NOT NULL DEFAULT false,
    "vat_rate" INTEGER,
    "contract_type" TEXT NOT NULL,
    "org_roles" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "settings_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "city_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "geo_lat" DECIMAL(9,6),
    "geo_lng" DECIMAL(9,6),
    "photo_forbidden" BOOLEAN NOT NULL DEFAULT false,
    "order_limit_tiyin" BIGINT,
    "monthly_limit_tiyin" BIGINT,
    "passport_json" JSONB NOT NULL DEFAULT '{}',
    "access_json" JSONB NOT NULL DEFAULT '{}',
    "building_id" UUID,
    "preferred_master_id" UUID,
    "blacklist_masters" UUID[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "price_list_release_id" UUID NOT NULL,
    "subscription_tiyin" BIGINT,
    "terms_json" JSONB NOT NULL DEFAULT '{}',
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "full_name" TEXT,
    "language" TEXT NOT NULL DEFAULT 'ru',
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "marketing_ok" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_role" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "RoleKind" NOT NULL,
    "organization_id" UUID,
    "location_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_profile" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'candidate',
    "skill_tags" TEXT[],
    "zone_ids" UUID[],
    "rating" INTEGER NOT NULL DEFAULT 60,
    "grade" TEXT NOT NULL DEFAULT 'bronze',
    "tax_mode" TEXT NOT NULL,
    "contract_until" DATE,
    "has_vehicle" BOOLEAN NOT NULL DEFAULT false,
    "cash_debt_tiyin" BIGINT NOT NULL DEFAULT 0,
    "on_probation" BOOLEAN NOT NULL DEFAULT true,
    "probation_count" INTEGER NOT NULL DEFAULT 0,
    "qr_badge_code" TEXT,
    "referrer_id" UUID,
    "platform_status" BOOLEAN NOT NULL DEFAULT true,
    "qualifications" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "master_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_list_release" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "ReleaseStatus" NOT NULL DEFAULT 'draft',
    "activates_at" TIMESTAMPTZ,
    "coeffs_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "price_list_release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_item" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "release_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "price_from_tiyin" BIGINT NOT NULL,
    "price_to_tiyin" BIGINT NOT NULL,
    "norm_hours" DECIMAL(5,2) NOT NULL,
    "required_skills" TEXT[],
    "requires_equipment" BOOLEAN NOT NULL DEFAULT false,
    "is_paired" BOOLEAN NOT NULL DEFAULT false,
    "stage_plan_json" JSONB,
    "is_licensed_closed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "type" "OrderType" NOT NULL,
    "urgency" "Urgency" NOT NULL DEFAULT 'normal',
    "status" "OrderStatus" NOT NULL DEFAULT 'new',
    "pause" "OrderPause",
    "version" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT,
    "client_id" UUID,
    "location_id" UUID,
    "applicant_user_id" UUID,
    "master_id" UUID,
    "helper_id" UUID,
    "price_list_release_id" UUID NOT NULL,
    "parent_order_id" UUID,
    "defect_id" UUID,
    "address_json" JSONB NOT NULL DEFAULT '{}',
    "coefficients_copy" JSONB NOT NULL DEFAULT '{}',
    "total_work_tiyin" BIGINT NOT NULL DEFAULT 0,
    "total_material_tiyin" BIGINT NOT NULL DEFAULT 0,
    "payment_channel" "PaymentChannel" NOT NULL,
    "warranty_days_copy" INTEGER NOT NULL DEFAULT 30,
    "promo_code" TEXT,
    "rating" INTEGER,
    "partially_done" BOOLEAN NOT NULL DEFAULT false,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "client_uuid" UUID,
    "building_id" UUID,
    "unit_id" UUID,
    "order_scope" "OrderScope" NOT NULL DEFAULT 'private',
    "labor_settlement" "LaborSettlement" NOT NULL DEFAULT 'share',
    "service_fee_tiyin" BIGINT NOT NULL DEFAULT 0,
    "first_refusal_until" TIMESTAMPTZ,
    "sla_policy_id" UUID,
    "sla_response_due" TIMESTAMPTZ,
    "sla_arrival_due" TIMESTAMPTZ,
    "sla_resolution_due" TIMESTAMPTZ,
    "sla_breach_flags" TEXT[],
    "sla_paused_ms" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_line" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "price_item_id" UUID,
    "name_copy" TEXT NOT NULL,
    "unit_copy" TEXT NOT NULL,
    "price_tiyin_copy" BIGINT NOT NULL,
    "norm_hours_copy" DECIMAL(5,2) NOT NULL,
    "qty" DECIMAL(8,2) NOT NULL DEFAULT 1,
    "stage_plan_copy" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "kind" "QuoteKind" NOT NULL,
    "amount_tiyin" BIGINT NOT NULL,
    "positions_json" JSONB NOT NULL,
    "evidence_json" JSONB,
    "approved_by" UUID,
    "approved_via" TEXT,
    "offline_flag" BOOLEAN NOT NULL DEFAULT false,
    "client_uuid" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "from_status" "OrderStatus",
    "to_status" "OrderStatus" NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" UUID,
    "actor_role" TEXT,
    "reason" TEXT,
    "client_uuid" UUID,
    "device_time" TIMESTAMPTZ,
    "offline_fixed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_photo" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "stage" "PhotoStage" NOT NULL,
    "s3_key" TEXT NOT NULL,
    "server_ts" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "device_ts" TIMESTAMPTZ,
    "geo_lat" DECIMAL(9,6),
    "geo_lng" DECIMAL(9,6),
    "geo_missing" BOOLEAN NOT NULL DEFAULT false,
    "hash" TEXT,
    "client_uuid" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_material" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount_tiyin" BIGINT NOT NULL,
    "source_channel" TEXT NOT NULL,
    "receipt_photo_id" UUID,
    "price_tier" TEXT,
    "client_uuid" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "defect" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "found_in_order_id" UUID,
    "status" "DefectStatus" NOT NULL DEFAULT 'new',
    "priority" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "estimate_json" JSONB,
    "estimate_tiyin" BIGINT,
    "estimate_release_id" UUID,
    "estimate_valid_till" DATE,
    "postponed_until" DATE,
    "resolved_by_order_id" UUID,
    "rejected_note_date" DATE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "defect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "operation_id" UUID NOT NULL,
    "debit_account_id" UUID NOT NULL,
    "credit_account_id" UUID NOT NULL,
    "amount_tiyin" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "order_id" UUID,
    "invoice_id" UUID,
    "is_storno" BOOLEAN NOT NULL DEFAULT false,
    "reversed_tx_id" UUID,
    "idem_key" TEXT,
    "period_locked" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_account" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "balance_tiyin" BIGINT NOT NULL DEFAULT 0,
    "reserved_tiyin" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "subscription_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "organization_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "amount_tiyin" BIGINT NOT NULL,
    "vat_tiyin" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'issued',
    "due_on" DATE,
    "pdf_s3_key" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivable" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "debtor_type" TEXT NOT NULL,
    "debtor_id" UUID NOT NULL,
    "invoice_id" UUID,
    "order_id" UUID,
    "amount_tiyin" BIGINT NOT NULL,
    "repaid_tiyin" BIGINT NOT NULL DEFAULT 0,
    "dunning_stage" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "receivable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_role" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "device" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMPTZ,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_parameter" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "level" TEXT NOT NULL,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "system_parameter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "building" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "operator_org_id" UUID,
    "city_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "geo_polygon" JSONB NOT NULL DEFAULT '{}',
    "building_type" "BuildingType" NOT NULL DEFAULT 'residential',
    "connection_status" "BuildingConnectionStatus" NOT NULL DEFAULT 'unmanaged',
    "work_hours_json" JSONB NOT NULL DEFAULT '{}',
    "noise_hours_json" JSONB NOT NULL DEFAULT '{}',
    "has_service_lift" BOOLEAN NOT NULL DEFAULT false,
    "parking_rules" TEXT,
    "waste_rules" TEXT,
    "internal_buffer_min" INTEGER NOT NULL DEFAULT 0,
    "emergency_phone" TEXT,
    "dispatch_phone" TEXT,
    "service_fee_bps" INTEGER NOT NULL DEFAULT 500,
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ,
    "connected_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "building_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "building_id" UUID NOT NULL,
    "entrance" TEXT,
    "floor" INTEGER,
    "number" TEXT NOT NULL,
    "unit_type" TEXT NOT NULL DEFAULT 'apartment',
    "area_m2" DECIMAL(10,2),
    "riser_ids" TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_resident" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "resident_role" "ResidentRole" NOT NULL DEFAULT 'owner',
    "verified_by" TEXT NOT NULL DEFAULT 'self',
    "valid_until" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_resident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "common_zone" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "building_id" UUID NOT NULL,
    "zone_type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "riser_id" TEXT,
    "is_critical" BOOLEAN NOT NULL DEFAULT false,
    "is_licensed" BOOLEAN NOT NULL DEFAULT false,
    "access_note" TEXT,
    "key_holder" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "common_zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_permit" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "building_id" UUID NOT NULL,
    "requested_by" UUID NOT NULL,
    "status" "PermitStatus" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 0,
    "zone_types" TEXT[],
    "common_zone_ids" UUID[],
    "requires_shutdown" BOOLEAN NOT NULL DEFAULT false,
    "shutdown_id" UUID,
    "affected_unit_ids" UUID[],
    "window_from" TIMESTAMPTZ,
    "window_to" TIMESTAMPTZ,
    "approver_user_id" UUID,
    "approved_at" TIMESTAMPTZ,
    "approval_kind" "PermitApprovalKind",
    "reject_reason" TEXT,
    "escort_required" BOOLEAN NOT NULL DEFAULT false,
    "escort_user_id" UUID,
    "opened_at" TIMESTAMPTZ,
    "closed_at" TIMESTAMPTZ,
    "photo_before_id" UUID,
    "photo_after_id" UUID,
    "sla_deadline" TIMESTAMPTZ,
    "is_emergency" BOOLEAN NOT NULL DEFAULT false,
    "client_op_uuid" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "access_permit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resource_shutdown" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "building_id" UUID NOT NULL,
    "resource_type" "ResourceType" NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'riser',
    "riser_id" TEXT,
    "affected_unit_ids" UUID[],
    "planned_from" TIMESTAMPTZ NOT NULL,
    "planned_to" TIMESTAMPTZ NOT NULL,
    "actual_from" TIMESTAMPTZ,
    "actual_to" TIMESTAMPTZ,
    "reason" TEXT NOT NULL,
    "initiator" TEXT NOT NULL DEFAULT 'operator',
    "order_id" UUID,
    "status" "ShutdownStatus" NOT NULL DEFAULT 'draft',
    "notified_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "resource_shutdown_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_pass" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "building_id" UUID NOT NULL,
    "order_id" UUID,
    "master_id" UUID,
    "guest_name" TEXT,
    "pass_type" "PassType" NOT NULL DEFAULT 'master',
    "issued_by" TEXT NOT NULL DEFAULT 'system',
    "qr_token" TEXT NOT NULL,
    "fallback_code" TEXT NOT NULL,
    "vehicle_plate" TEXT,
    "valid_from" TIMESTAMPTZ NOT NULL,
    "valid_to" TIMESTAMPTZ NOT NULL,
    "entered_at" TIMESTAMPTZ,
    "exited_at" TIMESTAMPTZ,
    "checked_by" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_pass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "master_affiliation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "master_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "since" DATE NOT NULL,
    "until" DATE,
    "skill_tags" TEXT[],
    "hourly_cost_tiyin" BIGINT NOT NULL DEFAULT 0,
    "object_ids" UUID[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "master_affiliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "building_staff" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "building_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "staff_role" "StaffRole" NOT NULL,
    "is_duty" BOOLEAN NOT NULL DEFAULT false,
    "is_backup" BOOLEAN NOT NULL DEFAULT false,
    "skill_tags" TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "building_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "building_equipment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "building_id" UUID NOT NULL,
    "common_zone_id" UUID,
    "equipment_type" TEXT NOT NULL,
    "model" TEXT,
    "serial" TEXT,
    "commissioned_at" DATE,
    "interval_days" INTEGER,
    "last_service_at" DATE,
    "is_licensed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "building_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "building_observation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "building_id" UUID NOT NULL,
    "common_zone_id" UUID,
    "unit_id" UUID,
    "author_user_id" UUID NOT NULL,
    "source" "ObservationSource" NOT NULL DEFAULT 'walkthrough',
    "category_id" TEXT NOT NULL,
    "severity" "ObservationSeverity" NOT NULL DEFAULT 'housekeeping',
    "photo_ids" UUID[],
    "geo_lat" DECIMAL(9,6),
    "geo_lng" DECIMAL(9,6),
    "comment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "routed_to" TEXT,
    "routed_entity_id" UUID,
    "resolved_at" TIMESTAMPTZ,
    "resolved_photo_id" UUID,
    "client_op_uuid" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "building_observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "building_announcement" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "building_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'notice',
    "audience" TEXT NOT NULL DEFAULT 'building',
    "unit_ids" UUID[],
    "publish_at" TIMESTAMPTZ NOT NULL,
    "body" TEXT NOT NULL,
    "author_user_id" UUID NOT NULL,
    "sent_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "building_announcement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_policy" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "operator_org_id" UUID NOT NULL,
    "building_id" UUID,
    "category_id" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "response_min" INTEGER NOT NULL,
    "arrival_min" INTEGER NOT NULL,
    "resolution_min" INTEGER NOT NULL,
    "working_hours_only" BOOLEAN NOT NULL DEFAULT true,
    "escalation_chain" JSONB NOT NULL DEFAULT '[]',
    "penalty_tiyin" BIGINT,
    "applies_to_scope" TEXT NOT NULL DEFAULT 'both',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sla_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operator_subscription" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "operator_org_id" UUID NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL DEFAULT 'free',
    "tenant_kind" "TenantKind" NOT NULL,
    "billing_unit" "BillingUnit" NOT NULL DEFAULT 'per_object',
    "units_billed" INTEGER NOT NULL DEFAULT 1,
    "price_tiyin" BIGINT NOT NULL DEFAULT 300000000,
    "period_from" TIMESTAMPTZ NOT NULL,
    "period_to" TIMESTAMPTZ NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "operator_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "organization_tenant_id_status_idx" ON "organization"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "organization_tenant_id_inn_key" ON "organization"("tenant_id", "inn");

-- CreateIndex
CREATE INDEX "location_tenant_id_organization_id_idx" ON "location"("tenant_id", "organization_id");

-- CreateIndex
CREATE INDEX "location_tenant_id_city_id_idx" ON "location"("tenant_id", "city_id");

-- CreateIndex
CREATE INDEX "contract_tenant_id_organization_id_idx" ON "contract"("tenant_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_tenant_id_phone_key" ON "user"("tenant_id", "phone");

-- CreateIndex
CREATE INDEX "user_role_tenant_id_user_id_idx" ON "user_role"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_role_tenant_id_user_id_role_organization_id_location_i_key" ON "user_role"("tenant_id", "user_id", "role", "organization_id", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "master_profile_user_id_key" ON "master_profile"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "master_profile_qr_badge_code_key" ON "master_profile"("qr_badge_code");

-- CreateIndex
CREATE INDEX "master_profile_tenant_id_status_idx" ON "master_profile"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "price_list_release_tenant_id_status_idx" ON "price_list_release"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "price_list_release_tenant_id_number_key" ON "price_list_release"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "price_item_tenant_id_release_id_category_idx" ON "price_item"("tenant_id", "release_id", "category");

-- CreateIndex
CREATE INDEX "order_tenant_id_status_idx" ON "order"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "order_tenant_id_location_id_created_at_idx" ON "order"("tenant_id", "location_id", "created_at");

-- CreateIndex
CREATE INDEX "order_tenant_id_master_id_status_idx" ON "order"("tenant_id", "master_id", "status");

-- CreateIndex
CREATE INDEX "order_tenant_id_building_id_status_idx" ON "order"("tenant_id", "building_id", "status");

-- CreateIndex
CREATE INDEX "order_tenant_id_first_refusal_until_idx" ON "order"("tenant_id", "first_refusal_until");

-- CreateIndex
CREATE UNIQUE INDEX "order_tenant_id_number_key" ON "order"("tenant_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "order_tenant_id_client_uuid_key" ON "order"("tenant_id", "client_uuid");

-- CreateIndex
CREATE INDEX "order_line_tenant_id_order_id_idx" ON "order_line"("tenant_id", "order_id");

-- CreateIndex
CREATE INDEX "quote_tenant_id_order_id_idx" ON "quote"("tenant_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "quote_tenant_id_client_uuid_key" ON "quote"("tenant_id", "client_uuid");

-- CreateIndex
CREATE INDEX "order_status_log_tenant_id_order_id_created_at_idx" ON "order_status_log"("tenant_id", "order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_status_log_tenant_id_order_id_from_status_to_status_c_key" ON "order_status_log"("tenant_id", "order_id", "from_status", "to_status", "client_uuid");

-- CreateIndex
CREATE INDEX "order_photo_tenant_id_order_id_stage_idx" ON "order_photo"("tenant_id", "order_id", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "order_photo_tenant_id_client_uuid_key" ON "order_photo"("tenant_id", "client_uuid");

-- CreateIndex
CREATE INDEX "order_material_tenant_id_order_id_idx" ON "order_material"("tenant_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_material_tenant_id_client_uuid_key" ON "order_material"("tenant_id", "client_uuid");

-- CreateIndex
CREATE INDEX "defect_tenant_id_location_id_status_idx" ON "defect"("tenant_id", "location_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "account_tenant_id_code_key" ON "account"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "transaction_tenant_id_operation_id_idx" ON "transaction"("tenant_id", "operation_id");

-- CreateIndex
CREATE INDEX "transaction_tenant_id_order_id_idx" ON "transaction"("tenant_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_tenant_id_idem_key_key" ON "transaction"("tenant_id", "idem_key");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_account_organization_id_key" ON "subscription_account"("organization_id");

-- CreateIndex
CREATE INDEX "invoice_tenant_id_organization_id_status_idx" ON "invoice"("tenant_id", "organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_tenant_id_number_key" ON "invoice"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "receivable_tenant_id_debtor_type_debtor_id_idx" ON "receivable"("tenant_id", "debtor_type", "debtor_id");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_entity_entity_id_idx" ON "audit_log"("tenant_id", "entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_tenant_id_created_at_idx" ON "audit_log"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "outbox_event_tenant_id_processed_at_created_at_idx" ON "outbox_event"("tenant_id", "processed_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "system_parameter_tenant_id_code_key" ON "system_parameter"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "building_tenant_id_operator_org_id_idx" ON "building"("tenant_id", "operator_org_id");

-- CreateIndex
CREATE INDEX "building_tenant_id_connection_status_idx" ON "building"("tenant_id", "connection_status");

-- CreateIndex
CREATE INDEX "building_tenant_id_city_id_idx" ON "building"("tenant_id", "city_id");

-- CreateIndex
CREATE INDEX "unit_tenant_id_building_id_idx" ON "unit"("tenant_id", "building_id");

-- CreateIndex
CREATE UNIQUE INDEX "unit_tenant_id_building_id_entrance_number_key" ON "unit"("tenant_id", "building_id", "entrance", "number");

-- CreateIndex
CREATE INDEX "unit_resident_tenant_id_user_id_idx" ON "unit_resident"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "unit_resident_tenant_id_unit_id_user_id_key" ON "unit_resident"("tenant_id", "unit_id", "user_id");

-- CreateIndex
CREATE INDEX "common_zone_tenant_id_building_id_idx" ON "common_zone"("tenant_id", "building_id");

-- CreateIndex
CREATE INDEX "access_permit_tenant_id_building_id_status_idx" ON "access_permit"("tenant_id", "building_id", "status");

-- CreateIndex
CREATE INDEX "access_permit_tenant_id_status_sla_deadline_idx" ON "access_permit"("tenant_id", "status", "sla_deadline");

-- CreateIndex
CREATE UNIQUE INDEX "access_permit_tenant_id_client_op_uuid_key" ON "access_permit"("tenant_id", "client_op_uuid");

-- CreateIndex
CREATE INDEX "resource_shutdown_tenant_id_building_id_planned_from_idx" ON "resource_shutdown"("tenant_id", "building_id", "planned_from");

-- CreateIndex
CREATE INDEX "resource_shutdown_tenant_id_riser_id_status_idx" ON "resource_shutdown"("tenant_id", "riser_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "visit_pass_qr_token_key" ON "visit_pass"("qr_token");

-- CreateIndex
CREATE INDEX "visit_pass_tenant_id_building_id_valid_from_idx" ON "visit_pass"("tenant_id", "building_id", "valid_from");

-- CreateIndex
CREATE INDEX "visit_pass_tenant_id_master_id_status_idx" ON "visit_pass"("tenant_id", "master_id", "status");

-- CreateIndex
CREATE INDEX "master_affiliation_tenant_id_org_id_status_idx" ON "master_affiliation"("tenant_id", "org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "master_affiliation_tenant_id_master_id_org_id_key" ON "master_affiliation"("tenant_id", "master_id", "org_id");

-- CreateIndex
CREATE INDEX "building_staff_tenant_id_building_id_staff_role_idx" ON "building_staff"("tenant_id", "building_id", "staff_role");

-- CreateIndex
CREATE UNIQUE INDEX "building_staff_tenant_id_building_id_user_id_staff_role_key" ON "building_staff"("tenant_id", "building_id", "user_id", "staff_role");

-- CreateIndex
CREATE INDEX "building_equipment_tenant_id_building_id_idx" ON "building_equipment"("tenant_id", "building_id");

-- CreateIndex
CREATE INDEX "building_observation_tenant_id_building_id_status_idx" ON "building_observation"("tenant_id", "building_id", "status");

-- CreateIndex
CREATE INDEX "building_observation_tenant_id_common_zone_id_created_at_idx" ON "building_observation"("tenant_id", "common_zone_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "building_observation_tenant_id_client_op_uuid_key" ON "building_observation"("tenant_id", "client_op_uuid");

-- CreateIndex
CREATE INDEX "building_announcement_tenant_id_building_id_publish_at_idx" ON "building_announcement"("tenant_id", "building_id", "publish_at");

-- CreateIndex
CREATE INDEX "sla_policy_tenant_id_operator_org_id_building_id_idx" ON "sla_policy"("tenant_id", "operator_org_id", "building_id");

-- CreateIndex
CREATE INDEX "operator_subscription_tenant_id_operator_org_id_period_from_idx" ON "operator_subscription"("tenant_id", "operator_org_id", "period_from");

-- AddForeignKey
ALTER TABLE "location" ADD CONSTRAINT "location_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location" ADD CONSTRAINT "location_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "building"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract" ADD CONSTRAINT "contract_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract" ADD CONSTRAINT "contract_price_list_release_id_fkey" FOREIGN KEY ("price_list_release_id") REFERENCES "price_list_release"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_profile" ADD CONSTRAINT "master_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_item" ADD CONSTRAINT "price_item_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "price_list_release"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_master_id_fkey" FOREIGN KEY ("master_id") REFERENCES "master_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "building"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_sla_policy_id_fkey" FOREIGN KEY ("sla_policy_id") REFERENCES "sla_policy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_price_list_release_id_fkey" FOREIGN KEY ("price_list_release_id") REFERENCES "price_list_release"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote" ADD CONSTRAINT "quote_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_log" ADD CONSTRAINT "order_status_log_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_photo" ADD CONSTRAINT "order_photo_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_material" ADD CONSTRAINT "order_material_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_debit_account_id_fkey" FOREIGN KEY ("debit_account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_credit_account_id_fkey" FOREIGN KEY ("credit_account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building" ADD CONSTRAINT "building_operator_org_id_fkey" FOREIGN KEY ("operator_org_id") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit" ADD CONSTRAINT "unit_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_resident" ADD CONSTRAINT "unit_resident_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_resident" ADD CONSTRAINT "unit_resident_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "common_zone" ADD CONSTRAINT "common_zone_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_permit" ADD CONSTRAINT "access_permit_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_permit" ADD CONSTRAINT "access_permit_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_permit" ADD CONSTRAINT "access_permit_shutdown_id_fkey" FOREIGN KEY ("shutdown_id") REFERENCES "resource_shutdown"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resource_shutdown" ADD CONSTRAINT "resource_shutdown_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_pass" ADD CONSTRAINT "visit_pass_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_pass" ADD CONSTRAINT "visit_pass_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_pass" ADD CONSTRAINT "visit_pass_master_id_fkey" FOREIGN KEY ("master_id") REFERENCES "master_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_affiliation" ADD CONSTRAINT "master_affiliation_master_id_fkey" FOREIGN KEY ("master_id") REFERENCES "master_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "master_affiliation" ADD CONSTRAINT "master_affiliation_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_staff" ADD CONSTRAINT "building_staff_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_staff" ADD CONSTRAINT "building_staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_equipment" ADD CONSTRAINT "building_equipment_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_observation" ADD CONSTRAINT "building_observation_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_observation" ADD CONSTRAINT "building_observation_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "building_announcement" ADD CONSTRAINT "building_announcement_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_policy" ADD CONSTRAINT "sla_policy_operator_org_id_fkey" FOREIGN KEY ("operator_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_policy" ADD CONSTRAINT "sla_policy_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "building"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operator_subscription" ADD CONSTRAINT "operator_subscription_operator_org_id_fkey" FOREIGN KEY ("operator_org_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

