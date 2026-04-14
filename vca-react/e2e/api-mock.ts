/**
 * Cross-origin API mocks for Playwright (Vite on :5173, API base :8000).
 * Fixtures follow vca-python/claims/DAMAGE_ASSESSMENT_CARD_CONTRACT.md — no extra fields.
 */
import type { Page } from "@playwright/test";

export const E2E_CLAIM_ID = "CLM-E2E-1";

const CORS_JSON: Record<string, string> = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function emptyDetail(
  complaintId: string,
  cardKey: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    complaint_id: complaintId,
    card_key: cardKey,
    title: `${cardKey.replace(/_/g, " ")}`,
    headline: "E2E grounded headline.",
    status: "info",
    confidence: { label: "Medium", score: 70 },
    claim_context: {
      registration: "E2E-REG",
      vin: null,
      make_model_year: "2022 E2E Sedan",
      policy_number: "POL-E2E",
      claim_reported_context: null,
      overlap_summary: null,
    },
    metrics: [{ label: "Sample metric", value: 1 }],
    evidence: [] as { type?: string; label?: string; detail?: string }[],
    caveats: [] as string[],
    unsupported_fields: [] as string[],
    raw_evidence_bundle: { kind: "e2e", facts_schema_version: 1, data: {} },
    narrative: {
      summary: "E2E narrative summary from backend.",
      why_it_matters: ["Grounded reason one."],
      key_takeaways: ["Grounded takeaway."],
      recommended_attention: "Review in E2E.",
    },
    source_snapshot_hash: "e2e_snapshot_hash_value",
    insight: { generated_at: "2026-01-15T12:00:00Z" },
    ...overrides,
  };
}

const CARD_SUMMARIES = [
  {
    card_key: "image_authenticity",
    title: "Image Authenticity",
    headline: "Photos analyzed for authenticity signals.",
    status: "info",
    primary_metric: { label: "Photos screened", value: 2 },
    secondary_metrics: [{ label: "High-risk", value: 0 }],
    view_details_enabled: true,
    last_generated_at: null,
    caveats: [],
  },
  {
    card_key: "duplicate_screening",
    title: "Duplicate Screening",
    headline: "Cross-claim similarity check complete.",
    status: "clear",
    primary_metric: { label: "Matches", value: 0 },
    secondary_metrics: [],
    view_details_enabled: true,
    last_generated_at: null,
    caveats: [],
  },
  {
    card_key: "estimated_value",
    title: "Estimated Value",
    headline: "Repair estimate from grounded pricing.",
    status: "clear",
    primary_metric: { label: "Gross estimate", value: 1500 },
    secondary_metrics: [{ label: "Parts", value: 2 }],
    view_details_enabled: true,
    last_generated_at: null,
    caveats: [],
  },
  {
    card_key: "damage_detection",
    title: "Damage Detection",
    headline: "Part-level damage recorded.",
    status: "partial",
    primary_metric: { label: "Parts", value: 2 },
    secondary_metrics: [],
    view_details_enabled: true,
    last_generated_at: null,
    caveats: ["One photo had low confidence."],
  },
];

function fnolDetail() {
  return {
    id: E2E_CLAIM_ID,
    complaint_id: E2E_CLAIM_ID,
    workflow_state: "DAMAGE_ASSESSMENT_COMPLETED",
    coverage_type: "Comprehensive",
    policy_number: "POL-E2E",
    policy_status: "Active",
    policy_start_date: "2026-01-01",
    policy_end_date: "2026-12-31",
    policy_holder_name: "E2E Customer",
    vehicle_make: "E2E",
    vehicle_year: 2022,
    vehicle_model: "Sedan",
    vehicle_registration_number: "E2E-REG",
    incident_type: "Collision",
    incident_description: "E2E bumper damage",
    incident_date_time: "2026-01-10T10:00:00Z",
    accident_location: "Test City",
    liability_admission: false,
    dashcam_cctv_evidence: false,
    injury_indicator: false,
    commercial_vehicle: false,
    flood_coverage: false,
    fir_document_copy: null,
    insurance_document_copy: null,
    damage_photos: ["e2e-front.jpg", "e2e-rear.jpg"],
    raw_response: {
      claim_id: E2E_CLAIM_ID,
      policy: {
        policy_number: "POL-E2E",
        policy_status: "Active",
        coverage_type: "Comprehensive",
        policy_start_date: "2026-01-01",
        policy_end_date: "2026-12-31",
      },
      vehicle: {
        registration_number: "E2E-REG",
        make: "E2E",
        model: "Sedan",
        year: 2022,
      },
      incident: {
        date_time_of_loss: "2026-01-10T10:00:00Z",
        loss_description: "E2E bumper damage",
        claim_type: "Collision",
        estimated_amount: 1500,
        excess_amount: 100,
      },
      claimant: {
        driver_name: "E2E Customer",
        driving_license_number: "DL-E2E",
        license_valid_till: "2030-12-31",
      },
      documents: {
        rc_copy_uploaded: true,
        dl_copy_uploaded: true,
        photos_uploaded: true,
        fir_uploaded: false,
        photos: ["e2e-front.jpg", "e2e-rear.jpg"],
      },
      history: { previous_claims_last_12_months: 0 },
    },
    status: "Recommendation shared",
    estimated_amount: 1500,
    claim_amount: 1400,
    excess_amount: 100,
    created_date: "2026-01-10T09:00:00Z",
    created_by: "e2e",
    updated_date: "2026-01-10T09:05:00Z",
    updated_by: "e2e",
    re_open: 0,
  };
}

export async function attachDamageAssessmentE2eMocks(page: Page) {
  let refreshSeq = 0;

  await page.route("**/*", async (route) => {
    const req = route.request();
    const url = req.url();
    let pathname = "";
    try {
      pathname = new URL(url).pathname;
    } catch {
      return route.continue();
    }

    if (!pathname.includes("/api/")) {
      return route.continue();
    }

    if (req.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: CORS_JSON });
    }

    const json = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        headers: CORS_JSON,
        body: JSON.stringify(data),
      });

    if (pathname.endsWith("/login") || pathname.endsWith("/login/")) {
      if (req.method() === "POST") {
        return json({
          token: "e2e-test-token",
          user: {
            id: 1,
            username: "e2e",
            email: "e2e@test.local",
            first_name: "E2E",
            last_name: "User",
          },
          message: "ok",
        });
      }
    }

    if (pathname.includes("/core/me")) {
      return json({
        id: 1,
        username: "e2e",
        email: "e2e@test.local",
        first_name: "E2E",
        last_name: "User",
        is_active: true,
        is_staff: true,
        is_superuser: true,
        role: {
          id: 1,
          name: "Admin",
          description: "",
          is_active: true,
          permission_count: 0,
          created_date: "2026-01-01",
          created_by: null,
          updated_date: "2026-01-01",
          updated_by: null,
        },
        permissions: [],
      });
    }

    if (
      (pathname === "/api/fnol" || pathname === "/api/fnol/") &&
      req.method() === "GET"
    ) {
      return json([fnolDetail()]);
    }

    if (pathname.includes("process-claim") && req.method() === "POST") {
      return json({
        claim_id: E2E_CLAIM_ID,
        damage_confidence: 80,
        fraud_score: "20",
        threshold: 0.55,
        claim_type: "SIMPLE",
        decision: "Auto",
        claim_status: "Recommendation shared",
        reason: "E2E process claim",
        estimated_amount: 1500,
        claim_amount: 1400,
        fraud_rule_results: [],
      });
    }

    const claimPath = `/api/fnol/${E2E_CLAIM_ID}`;
    if (!pathname.startsWith(claimPath)) {
      return route.continue();
    }

    if (pathname.includes("recommendation-report")) {
      return route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Access-Control-Allow-Origin": "*",
        },
        body: Buffer.from("%PDF-1.4 e2e minimal"),
      });
    }

    if (pathname.includes("/evaluation") && req.method() === "GET") {
      return json({
        complaint_id: E2E_CLAIM_ID,
        not_started: false,
        workflow_state: "DAMAGE_ASSESSMENT_COMPLETED",
        damage_confidence: 80,
        estimated_amount: 1500,
        claim_amount: 1400,
        excess_amount: 100,
        estimated_repair: 1400,
        threshold_value: 55,
        claim_type: "SIMPLE",
        claim_complexity: "Simple Claim",
        claim_complexity_threshold: 25000,
        claim_complexity_amount: 1500,
        severity: "minor",
        decision: "Auto",
        claim_status: "Recommendation shared",
        reason: "E2E",
        llm_damages: ["dent"],
        llm_severity: "minor",
        fraud_rule_results: [],
        fraud_score: "Low",
        created_date: "2026-01-10T10:00:00Z",
        updated_date: "2026-01-10T10:00:00Z",
      });
    }

    if (pathname.includes("image-fraud-results")) {
      return json({
        complaint_id: E2E_CLAIM_ID,
        results_count: 2,
        results: [
          {
            photo_path: "e2e-front.jpg",
            fraud_score: 12,
            ela_score: 1,
            exif_json: { warnings: [], exif_present: true },
          },
        ],
      });
    }

    if (pathname.includes("duplicate-candidates")) {
      return json({
        complaint_id: E2E_CLAIM_ID,
        candidate_count: 0,
        candidates: [],
      });
    }

    if (pathname.includes("damage-assessment-detailed") && req.method() === "GET") {
      return json({
        complaint_id: E2E_CLAIM_ID,
        total_parts: 2,
        total_estimated_cost: 1500,
        currency_code: "THB",
        part_breakdown: [
          {
            part_name: "Bumper",
            damage_type: "scratch",
            severity_percent: 20,
            repair_action: "REPAIR",
            estimated_amount: 800,
          },
          {
            part_name: "Headlamp",
            damage_type: "crack",
            severity_percent: 40,
            repair_action: "REPLACE",
            estimated_amount: 700,
          },
        ],
      });
    }

    if (pathname.includes("total-value")) {
      return json({
        complaint_id: E2E_CLAIM_ID,
        gross_estimate: 1500,
        excess_amount: 100,
        excess_from_fnol: 100,
        net_payable: 1400,
        currency_code: "THB",
        part_count: 2,
        parts_total_cross_check: 1500,
      });
    }

    if (pathname.includes("/damage-assessment/cards")) {
      if (pathname.endsWith("/cards") || pathname.endsWith("/cards/")) {
        return json({
          complaint_id: E2E_CLAIM_ID,
          cards: CARD_SUMMARIES,
        });
      }
      const m = pathname.match(
        /\/damage-assessment\/cards\/([^/]+)\/(details|refresh)/
      );
      if (m) {
        const cardKey = decodeURIComponent(m[1]);
        const action = m[2];
        if (action === "refresh") {
          refreshSeq += 1;
        }
        if (cardKey === "duplicate_screening") {
          return json(
            emptyDetail(E2E_CLAIM_ID, cardKey, {
              headline:
                "E2E duplicate headline specific to this claim (no generic prose).",
              narrative: {
                summary: "Duplicate narrative from backend only.",
                why_it_matters: [],
                key_takeaways: [],
                recommended_attention: "Compare claim files.",
              },
              evidence: [
                {
                  type: "settings",
                  label: "Screening mode",
                  detail: "Strict dual-hash mode active.",
                },
              ],
            })
          );
        }
        if (cardKey === "estimated_value") {
          return json(
            emptyDetail(E2E_CLAIM_ID, cardKey, {
              metrics: [
                { label: "Gross estimate", value: 1500 },
                { label: "Net payable", value: 1400 },
              ],
              narrative: {
                summary: "Valuation narrative from backend.",
                why_it_matters: ["Affects reserve."],
                key_takeaways: ["Two parts priced."],
                recommended_attention: "Confirm excess.",
              },
            })
          );
        }
        if (cardKey === "damage_detection") {
          return json(
            emptyDetail(E2E_CLAIM_ID, cardKey, {
              status: "partial",
              evidence: [
                {
                  type: "part",
                  label: "Front bumper",
                  detail: "Scratch and dent noted in E2E.",
                },
              ],
            })
          );
        }
        if (cardKey === "image_authenticity") {
          return json(
            emptyDetail(E2E_CLAIM_ID, cardKey, {
              insight: {
                generated_at: `2026-01-15T12:00:00Z#${refreshSeq}`,
              },
            })
          );
        }
        return json(emptyDetail(E2E_CLAIM_ID, cardKey));
      }
    }

    if (
      req.method() === "GET" &&
      new RegExp(`^/api/fnol/${E2E_CLAIM_ID}/?$`).test(pathname)
    ) {
      return json(fnolDetail());
    }

    return route.continue();
  });
}
