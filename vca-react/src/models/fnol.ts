export interface FnolPayload {
  claim_id: string;
  policy: {
    policy_number: string;
    policy_status: string;
    coverage_type: string;
    policy_start_date: string;
    policy_end_date: string;
  };
  vehicle: {
    registration_number: string;
    make: string;
    model: string;
    year: number;
  };
  incident: {
    date_time_of_loss: string;
    loss_description: string;
    claim_type: string;
    estimated_amount: number;
    excess_amount?: number;
    accident_location?: string;
    liability_admission?: boolean;
    dashcam_cctv_evidence?: boolean;
    injury_indicator?: boolean;
    commercial_vehicle?: boolean;
    flood_coverage?: boolean;
  };
  accident_location?: string;
  liability_admission?: boolean;
  dashcam_cctv_evidence?: boolean;
  injury_indicator?: boolean;
  commercial_vehicle?: boolean;
  flood_coverage?: boolean;
  claimant: {
    driver_name: string;
    driving_license_number: string;
    license_valid_till: string;
  };
  documents: {
    rc_copy_uploaded: boolean;
    dl_copy_uploaded: boolean;
    photos_uploaded: boolean;
    fir_uploaded: boolean;
    photos?: (string | { image?: { url?: string } })[];
    videos_uploaded?: boolean;
    videos?: Array<
      | string
      | {
          source_path?: string;
          original_filename?: string;
          source_type?: string;
        }
    >;
    video_assets?: Array<{
      id?: number;
      source_path?: string;
      original_filename?: string;
      source_type?: string;
    }>;
  };
  history: {
    previous_claims_last_12_months: number;
  };
}

export interface ClaimWorkflowStepState {
  completed: boolean;
  visible: boolean;
  run_allowed?: boolean;
  passed?: boolean | null;
  available?: boolean;
  valuation_ready?: boolean;
  part_count?: number;
  financials_ready?: boolean;
}

export interface ClaimWorkflowSnapshot {
  workflow_state: string;
  /** From API `workflow_snapshot` — single source for list/detail badge copy (backend-driven). */
  workflow_display_label?: string;
  /** StatusBadge variant key; must match `StatusBadge` `status` prop union. */
  workflow_badge_tone?: string;
  /** Monotonic sort rank for claim stage column (backend-driven). */
  workflow_sort_order?: number;
  business_rule_validation: ClaimWorkflowStepState;
  damage_assessment: ClaimWorkflowStepState;
  claim_evaluation: ClaimWorkflowStepState;
}

export interface ClaimVideoAssetSummary {
  id: number;
  source_path: string;
  original_filename: string;
  source_type: string;
  duration_ms?: number | null;
  frame_count?: number | null;
  width?: number | null;
  height?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  file_url?: string;
}

export interface ClaimVideoDamageAssessmentPart {
  id?: number;
  part_name: string;
  damage_type: string;
  severity_percent: number;
  repair_action: string;
  estimated_amount_min: number;
  estimated_amount_max: number;
  currency_code?: string;
  observed_frame_count?: number;
  observed_timestamps_ms?: number[];
  video_asset_id?: number | null;
  source_type?: string;
  source_path?: string;
  original_filename?: string;
}

export interface ClaimVideoDamageAssessmentSummary {
  complaint_id: string;
  analysis_status: string;
  job_status?: string | null;
  analysis_result_id?: number | null;
  job_id?: number | null;
  summary_text: string;
  total_parts: number;
  total_estimated_cost_min: number;
  total_estimated_cost_max: number;
  currency_code: string;
  market_context?: {
    country?: string;
    city?: string;
    currency_code?: string;
    locale?: string;
    market_label?: string;
    accident_location?: string;
  };
  recommended_action?: string;
  timeline_event_count?: number;
  representative_frame_count?: number;
  part_breakdown: ClaimVideoDamageAssessmentPart[];
  pipeline_metadata?: Record<string, unknown>;
  processing_started_at?: string | null;
  processing_completed_at?: string | null;
}

export interface ClaimMediaProfile {
  media_type: "none" | "image_only" | "video_only" | "mixed";
  primary_media_type: "none" | "image" | "video";
  damage_assessment_mode: "none" | "image" | "video";
  damage_assessment_reason: string;
  has_images: boolean;
  has_videos: boolean;
  photo_count: number;
  video_count: number;
  playable_video_count: number;
}

export interface ClaimEvidenceItem {
  evidence_type: "image" | "video";
  source_table: "fnol_damage_photos" | "claim_video_assets";
  source_id?: number | null;
  complaint_id: string;
  label: string;
  stored_path: string;
  url?: string;
  display_available: boolean;
  render_status: "ready" | "linked_unavailable";
  damage_assessment_role: "primary" | "supporting";
  source_type?: string;
  duration_ms?: number | null;
  frame_count?: number | null;
  width?: number | null;
  height?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/** FNOL claim from fnol_claims + fnol_damage_photos */
export interface FnolResponse {
  id: string;
  complaint_id: string;
  coverage_type: string | null;
  policy_number: string | null;
  policy_status: string | null;
  policy_start_date: string | null;
  policy_end_date: string | null;
  policy_holder_name: string | null;
  vehicle_make: string | null;
  vehicle_year: number | null;
  vehicle_model: string | null;
  vehicle_registration_number: string | null;
  incident_type: string | null;
  incident_description: string | null;
  incident_date_time: string | null;
  accident_location: string | null;
  liability_admission: boolean | null;
  dashcam_cctv_evidence: boolean | null;
  injury_indicator: boolean | null;
  commercial_vehicle: boolean | null;
  flood_coverage: boolean | null;
  previous_claims_last_12_months?: number;
  fir_document_copy: string | null;
  insurance_document_copy: string | null;
  damage_photos: string[];
  raw_response: FnolPayload;
  status?: string;
  estimated_amount?: number | null;
  claim_amount?: number | null;
  excess_amount?: number | null;
  created_date: string;
  created_by: string | null;
  updated_date: string;
  updated_by: string | null;
  /** 1 = re-opened claim (show Re-validation of Business Rules on claim detail) */
  re_open?: number;
  /** Backend-derived lifecycle; same values as `ClaimWorkflowState` in api.ts. */
  workflow_state?: string;
  workflow_snapshot?: ClaimWorkflowSnapshot;
  media_profile?: ClaimMediaProfile;
  claim_evidence?: ClaimEvidenceItem[];
  video_asset_count?: number;
  video_assets?: ClaimVideoAssetSummary[];
  video_damage_assessment?: ClaimVideoDamageAssessmentSummary | null;
  latest_video_analysis_status?: string | null;
}

export interface FraudRuleResult {
  rule_type: string;
  rule_description: string;
  rule_group?: string;
  passed: boolean;
}

export interface ProcessClaimResponse {
  claim_id?: string;
  damage_confidence?: number;
  fraud_score?: string;
  evaluation_score?: number;
  threshold?: number;
  claim_type?: string;
  decision?: string;
  claim_status?: string;
  reason?: string;
  estimated_amount?: number;
  claim_amount?: number;
  fraud_rule_results?: FraudRuleResult[];
}
