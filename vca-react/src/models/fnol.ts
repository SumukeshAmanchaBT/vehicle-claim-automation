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
    location: string;
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
  };
  history: {
    previous_claims_last_12_months: number;
  };
}

export interface FnolResponse {
  id: number;
  raw_response: FnolPayload;
  created_date: string;
  created_by: string;
  updated_date: string;
  updated_by: string;
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
}

