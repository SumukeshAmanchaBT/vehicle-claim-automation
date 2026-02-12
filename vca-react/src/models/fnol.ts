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
  };
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
    photos?: string[];
  };
  history: {
    previous_claims_last_12_months: number;
  };
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
  previous_claims_last_12_months?: number;
  fir_document_copy: string | null;
  insurance_document_copy: string | null;
  damage_photos: string[];
  raw_response: FnolPayload;
  status?: string;
  estimated_amount?: number | null;
  claim_amount?: number | null;
  created_date: string;
  created_by: string | null;
  updated_date: string;
  updated_by: string | null;
}

export interface FraudRuleResult {
  rule_type: string;
  rule_description: string;
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

