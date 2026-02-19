import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Car,
  User,
  Calendar,
  MapPin,
  Shield,
  CheckCircle2,
  AlertTriangle,
  DollarSign,
  Brain,
  Eye,
  Loader2,
  FileText,
  Clock,
} from "lucide-react";
import {
  getFnolById,
  getClaimEvaluation,
  processClaim,
  runFraudDetection,
  runDamageAssessment,
  type FnolPayload,
  type FnolResponse,
  type ProcessClaimResponse,
  type ClaimEvaluationResponse,
} from "@/lib/api";
import { API_BASE_URL, API_MEDIA_URL } from "@/lib/httpClient";

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 0,
  }).format(amount);
};

function fraudBandToNumeric(band: string): number {
  switch (band) {
    case "Low":
      return 10;
    case "Medium":
      return 50;
    case "High":
      return 90;
    default:
      return 0;
  }
}

export default function ClaimDetail() {
  const { id } = useParams<{ id: string }>();
  const [fnol, setFnol] = useState<FnolResponse | null>(null);
  const [assessment, setAssessment] = useState<ProcessClaimResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fraudDetectionLoading, setFraudDetectionLoading] = useState(false);
  const [damageDetectionLoading, setDamageDetectionLoading] = useState(false);
  const [fraudSuccessModalOpen, setFraudSuccessModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("details");
  const [fraudResult, setFraudResult] = useState<ProcessClaimResponse | null>(null);
  const [damageDetectionRun, setDamageDetectionRun] = useState(false);
  const [claimEvaluation, setClaimEvaluation] = useState<ClaimEvaluationResponse | null>(null);
  const [claimEvaluationLoading, setClaimEvaluationLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFraudResult(null);
    getFnolById(id)
      .then((data) => {
        if (cancelled) return;
        setFnol(data);
        const isClosed =
          (data.status || "").toLowerCase() === "closed damage detection" ||
          (data.status || "").toLowerCase() === "recommendation shared";
        if (isClosed) {
          setDamageDetectionRun(true);
        } else {
          setDamageDetectionRun(false);
        }
        return processClaim(data.raw_response);
      })
      .then((result) => {
        console.log("Process claim result:", result);
        if (!cancelled && result) setAssessment(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load claim");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  // When claim is Open, switch away from Fraud Evaluation tab (must be before early returns - hooks rule)
  useEffect(() => {
    if (!fnol) return;
    const isOpen =
      !fnol.status ||
      (fnol.status || "").toLowerCase() === "fnol" ||
      (fnol.status || "").toLowerCase() === "open" ||
      (fnol.status || "").toLowerCase() === "open to fnol" ||
      (fnol.status || "").toLowerCase() === "pending";
    if (isOpen && activeTab === "fraud-evaluation") {
      setActiveTab("details");
    }
  }, [fnol, activeTab]);

  // Fetch claim evaluation when status is Closed: Auto review or Closed: Manual review
  const statusLower = (fnol?.status || "").toLowerCase();

  useEffect(() => {
    if (!id || !damageDetectionRun) return;
    let cancelled = false;
    setClaimEvaluationLoading(true);
    setClaimEvaluation(null);
    getClaimEvaluation(id)
      .then((data) => {
        if (!cancelled) setClaimEvaluation(data);
      })
      .catch(() => {
        if (!cancelled) setClaimEvaluation(null);
      })
      .finally(() => {
        if (!cancelled) setClaimEvaluationLoading(false);
      });
    return () => { cancelled = true; };
  }, [id, damageDetectionRun]);

  const handleFraudDetection = async () => {
    if (!id) return;
    setFraudDetectionLoading(true);
    setError(null);
    try {
      const result = await runFraudDetection(id);
      setFraudResult(result);
      setAssessment(result);
      const updatedFnol = await getFnolById(id);
      setFnol(updatedFnol);
      setActiveTab("fraud-evaluation");
      setFraudSuccessModalOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fraud detection failed");
    } finally {
      setFraudDetectionLoading(false);
    }
  };

  const handleDamageDetection = async () => {
    if (!id || !fnol) return;
    const rawPhotos =
      fnol.raw_response?.documents?.photos ?? fnol.damage_photos ?? [];
    const imageUrls = rawPhotos
      .map((obj: string | { image?: { url?: string } }) => {
        const url =
          typeof obj === "string"
            ? obj
            : (obj as { image?: { url?: string } })?.image?.url;
        if (!url) return null;
        if (url.startsWith("http")) return url;
        const origin = API_BASE_URL ? new URL(API_BASE_URL).origin : "";
        return `${API_MEDIA_URL}${url}`;
      })
      .filter(Boolean) as string[];

    if (imageUrls.length === 0) {
      setError("No images attached to process damage detection.");
      return;
    }

    setDamageDetectionLoading(true);
    setError(null);
    try {
      await runDamageAssessment(id, imageUrls);
      setDamageDetectionRun(true);
      setActiveTab("assessment");
      // Refetch claim so status updates to "Recommendation shared" in the UI
      const updatedFnol = await getFnolById(id!);
      setFnol(updatedFnol);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Damage detection failed");
    } finally {
      setDamageDetectionLoading(false);
    }
  };

  if (loading) {
    return (
      <AppLayout title="Claim Details">
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="mt-4 text-sm text-muted-foreground">Loading claim...</p>
        </div>
      </AppLayout>
    );
  }

  if (error || !fnol) {
    return (
      <AppLayout title="Claim Not Found">
        <div className="flex flex-col items-center justify-center py-12">
          <p className="text-lg text-muted-foreground">
            {error || "The claim you're looking for doesn't exist."}
          </p>
          <Button asChild className="mt-4">
            <Link to="/claims">Back to Claims</Link>
          </Button>
        </div>
      </AppLayout>
    );
  }

  const r: Partial<FnolPayload> = fnol.raw_response || {};
  const incident = (r.incident || {}) as FnolPayload["incident"];
  const policy = (r.policy || {}) as FnolPayload["policy"];
  const vehicle = (r.vehicle || {}) as FnolPayload["vehicle"];
  const claimant = (r.claimant || {}) as FnolPayload["claimant"];
  const documents = (r.documents || {}) as FnolPayload["documents"];

  // Prefer top-level API fields (complaint_id, incident_date_time, incident_location, etc.), fall back to raw_response
  const incidentDate = fnol.incident_date_time || incident.date_time_of_loss;
  const incidentLocation = (incident as any)?.location ?? null;
  const incidentType =
    fnol.incident_type ??
    (r as { Incident_type?: string }).Incident_type ??
    incident.claim_type;
  const incidentDescription = fnol.incident_description ?? incident.loss_description;
  // Submitted = claim creation date from API; fallback to incident date if not returned yet
  const submittedDate = fnol.created_date || incidentDate;

  const photos = documents.photos ?? fnol.damage_photos ?? [];
  const aiConfidence = assessment?.damage_confidence ?? 0;
  const fraudBand = assessment?.fraud_score ?? "—";
  const fraudScore = fraudBandToNumeric(fraudBand);
  const decision = assessment?.decision ?? "Pending";
  const claimStatus = assessment?.claim_status ?? "FNOL";
  const damageTypes = incidentDescription
    ? incidentDescription.split(/[,&]|\band\b/i).map((s: string) => s.trim()).filter(Boolean)
    : [];

  const getStatusVariant = (
    s: string
  ): "approved" | "pending" | "rejected" | "processing" => {
    if (s === "Auto Approve" || s === "Closed") return "approved";
    if (s === "Reject") return "rejected";
    return "pending";
  };

  // Only use persisted fnol.status (from fnol_claims.claim_status), not live assessment.decision
  const isAutoApproved =
    (fnol.status || "").toLowerCase() === "closed damage detection" ||
    (fnol.status || "").toLowerCase() === "recommendation shared";



  console.log("Claim status for damage detection check:", fnol.status);
  const statusForCheck = (fnol.status || claimStatus || "").toLowerCase();

  const isPendingDamageDetection =
    statusForCheck === "business rule validation-pass" ||
    statusForCheck === "pending damage detection" ||
    statusForCheck === "pending_damage_detection";



  const isFraudDetection =
    statusForCheck === "business rule validation-fail" ||
    statusForCheck === "fraudulent";
  console.log("Fraud detection done:", isFraudDetection);

  console.log("Is pending damage detection:", isPendingDamageDetection);
  // Open claim: show Claim Details + Documents only; hide AI Assessment, Fraud Evaluation tab, overview cards
  const isOpenClaim =
    !fnol.status ||
    (fnol.status || "").toLowerCase() === "fnol" ||
    (fnol.status || "").toLowerCase() === "open" ||
    (fnol.status || "").toLowerCase() === "open to fnol" ||
    (fnol.status || "").toLowerCase() === "pending";

  return (
    <AppLayout
      title={fnol.complaint_id || r.claim_id || `FNOL-${fnol.id}`}
      subtitle={`${incidentType || "Claim"} - ${fnol.policy_holder_name || claimant.driver_name || "—"}`}
    >
      <div className="space-y-6 animate-fade-in">
        {/* Header Actions */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="outline" asChild>
            <Link to="/claims">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Claims
            </Link>
          </Button>
          <div className="flex flex-end items-center gap-2">
            {/* <StatusBadge
              status={getStatusVariant(decision)}
              pulse={claimStatus === "Open"}
              className="text-sm px-3 py-1"
            >
              {decision}
            </StatusBadge> */}
            {/* <Button variant="outline">Request Documents</Button> */}
            {!isPendingDamageDetection ? (
              (!isFraudDetection && !damageDetectionRun) && (
                <Button
                  onClick={handleFraudDetection}
                  disabled={fraudDetectionLoading || !fnol}
                >
                  {fraudDetectionLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Validating...
                    </>
                  ) : (
                    "Fraud Detection"
                  )}
                </Button>
              )
            ) : (
              <Button
                variant="destructive"
                disabled={!isPendingDamageDetection || damageDetectionLoading}
                onClick={handleDamageDetection}
              >
                {damageDetectionLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Assessing...
                  </>
                ) : (
                  "Damage Detection"
                )}
              </Button>
            )
            }
          </div>
        </div>

        <Dialog open={fraudSuccessModalOpen} onOpenChange={setFraudSuccessModalOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Fraud Detection Evaluated Successfully</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Fraud detection has been completed for this claim. You can review the results in the Fraud Evaluation tab.
            </p>
            <DialogFooter>
              <Button onClick={() => setFraudSuccessModalOpen(false)}>OK</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Two-column overview cards: Fraud Evaluation (red if fraud, green otherwise) + AI Assessment */}
            {(fraudResult || (!isOpenClaim && assessment) || damageDetectionRun) && (
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Column 1: Fraud Evaluation – red when fraud detected, green otherwise */}

                <Card
                  className={`card-elevated border-2 ${fraudScore >= 50
                    ? "border-destructive bg-destructive/5"
                    : "border-success bg-success/5"
                    }`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${fraudScore >= 50 ? "bg-destructive/20" : "bg-success/20"
                          }`}
                      >
                        <Shield
                          className={`h-5 w-5 ${fraudScore >= 50 ? "text-destructive" : "text-success"
                            }`}
                        />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">
                          {fraudScore >= 50 ? "Fraud Risk Detected" : "No Fraud Detected"}
                        </p>
                        <p
                          className={`text-xl font-bold ${fraudScore >= 50 ? "text-destructive" : "text-success"
                            }`}
                        >
                          {/* {fraudBand} ({fraudScore}%) */}
                          {fraudScore >= 50 ? "High Risk" : "Low Risk"}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                {/* Column 2: AI Assessment – visible only after Damage Detection is run */}
                {damageDetectionRun && (
                  <Card className="card-elevated">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <Brain className="h-5 w-5 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-muted-foreground">Damage Assessment</p>
                          <p className="text-xl font-bold">{aiConfidence}%</p>
                          {/* <p className="text-xs text-muted-foreground mt-0.5">
                            Est. {formatCurrency(incident.estimated_amount ?? 0)}
                          </p> */}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
                {/* Claim Type – visible when claim evaluation is available */}
                {claimEvaluation && (
                  <Card className="card-elevated">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary/50">
                          <FileText className="h-5 w-5 text-muted-foreground" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-muted-foreground">Claim Type</p>
                          <p className="text-xl font-bold">{claimEvaluation.claim_type ?? "—"}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
                {/* Claim Amount – visible when claim evaluation is available */}
                {claimEvaluation && (
                  <Card className="card-elevated">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                          <DollarSign className="h-5 w-5 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-muted-foreground">Claim Amount</p>
                          <p className="text-xl font-bold">{formatCurrency(claimEvaluation.claim_amount ?? 0)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4 p-4 w-full">
              <TabsList>
                <TabsTrigger value="details">Claim Details</TabsTrigger>
                <TabsTrigger value="documents">Vehicle Images</TabsTrigger>
                {/* After Fraud Evaluation (or when Damage run): Fraud Evaluation before Claim Details */}
                {!isOpenClaim && (
                  <TabsTrigger value="fraud-evaluation">Fraud Evaluation</TabsTrigger>
                )}
                {/* After Damage Detection: AI Assessment first, then Fraud Evaluation, then Claim Details, Documents */}
                {damageDetectionRun && (
                  <>
                    <TabsTrigger value="assessment">Damage Assessment</TabsTrigger>
                    <TabsTrigger value="claim-evaluation">Claim Evaluation</TabsTrigger>
                  </>
                )}
                
               
              </TabsList>

              <TabsContent value="details">
                <Card className="card-elevated">
                  <CardHeader>
                    <CardTitle className="text-base">Incident Information</CardTitle>
                  </CardHeader>
                  <CardContent className="pl-4 space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">

                      {/* LEFT COLUMN */}
                      <div className="space-y-4">
                        <div className="flex items-start gap-3">
                          <Calendar className="h-4 w-4 mt-1 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">Incident Date</p>
                            <p className="text-sm text-muted-foreground">
                              {incidentDate
                                ? new Date(incidentDate).toLocaleDateString()
                                : "—"}
                            </p>
                          </div>
                        </div>

                        {/* <div className="flex items-start gap-3">
                          <Clock className="h-4 w-4 mt-1 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">Submitted</p>
                            <p className="text-sm text-muted-foreground">
                              {submittedDate
                                ? new Date(submittedDate).toLocaleString(undefined, {
                                    dateStyle: "short",
                                    timeStyle: "short",
                                  })
                                : "—"}
                            </p>
                          </div>
                        </div> */}

                        <div className="flex items-start gap-3">
                          <User className="h-4 w-4 mt-1 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">Incident Type</p>
                            <p className="text-sm text-muted-foreground">
                              {incidentType || "—"}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* RIGHT COLUMN */}
                      <div className="space-y-4">

                        <div className="flex items-start gap-3">
                          <Clock className="h-4 w-4 mt-1 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">Claim Request Date</p>
                            <p className="text-sm text-muted-foreground">
                              {submittedDate
                                ? new Date(submittedDate).toLocaleString(undefined, {
                                  dateStyle: "short",
                                  timeStyle: "short",
                                })
                                : "—"}
                            </p>
                          </div>
                        </div>

                      </div>

                    </div> <br></br>

                    <Separator />

                    <div className="">
                      <h4 className="text-sm font-medium mb-3">Incident Description</h4>
                      <p className="text-sm text-muted-foreground mb-3">
                        {incidentDescription || "—"}
                      </p>
                    </div>
                  </CardContent>

                </Card>
              </TabsContent>

              {damageDetectionRun && (
                <TabsContent value="assessment">
                  <Card className="card-elevated">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Brain className="h-4 w-4" />
                        Damage Assessment
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm">Damage Evaluation %</span>
                          <span className="text-sm font-medium">{aiConfidence}%</span>
                        </div>
                        <Progress value={aiConfidence} className="h-2" />
                      </div>

                      {assessment && (
                        <div className="grid gap-4">
                          {/* <div className="rounded-lg border p-4">
                          <div className="flex items-center gap-2 mb-2">
                            <CheckCircle2 className="h-4 w-4 text-success" />
                            <span className="text-sm font-medium">Assessment Result</span>
                          </div>
                          <ul className="space-y-1 text-sm text-muted-foreground">
                            <li>• Claim Type: {assessment.claim_type ?? "—"}</li>
                            <li>• Decision: {assessment.decision ?? "—"}</li>
                            <li>• Status: {assessment.claim_status ?? "—"}</li>
                            <li>• Evaluation Score: {assessment.evaluation_score ?? "—"}</li>
                            {assessment.reason && <li>• Reason: {assessment.reason}</li>}
                          </ul>
                        </div> */}
                          <div className="rounded-lg border p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <Eye className="h-4 w-4 text-primary" />
                              <span className="text-sm font-medium">Damage Detection</span>
                            </div>
                            <ul className="space-y-1 text-sm text-muted-foreground">
                              {damageTypes.map((type) => (
                                <li key={type}>• {type} detected</li>
                              ))}
                              <li>• Policy: {policy.policy_status ?? "—"}</li>
                              <li>• Coverage: {policy.coverage_type ?? "—"}</li>
                            </ul>
                          </div>
                        </div>
                      )}

                      {decision === "Auto Approve" && fraudScore < 30 && (
                        <div className="flex items-center gap-2 rounded-lg bg-success/10 p-4">
                          <CheckCircle2 className="h-5 w-5 text-success" />
                          <div>
                            <p className="text-sm font-medium text-success">
                              Eligible for Straight-Through Processing
                            </p>
                            <p className="text-xs text-muted-foreground">
                              This claim meets all criteria for automated approval
                            </p>
                          </div>
                        </div>
                      )}

                      {fraudScore >= 50 && (
                        <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-4">
                          <AlertTriangle className="h-5 w-5 text-destructive" />
                          <div>
                            <p className="text-sm font-medium text-destructive">
                              High Fraud Risk Detected
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Manual review required before processing
                            </p>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              )}

              <TabsContent value="documents">
                <Card className="card-elevated">
                  <CardHeader>
                    <CardTitle className="text-base">Vehicle Images</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 sm:grid-cols-1">
                      {/* <div className="flex items-center justify-between rounded-lg border p-4">
                        <span className="text-sm font-medium">RC Copy</span>
                        <StatusBadge status={documents.rc_copy_uploaded ? "approved" : "pending"}>
                          {documents.rc_copy_uploaded ? "Uploaded" : "Missing"}
                        </StatusBadge>
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-4">
                        <span className="text-sm font-medium">DL Copy</span>
                        <StatusBadge status={documents.dl_copy_uploaded ? "approved" : "pending"}>
                          {documents.dl_copy_uploaded ? "Uploaded" : "Missing"}
                        </StatusBadge>
                      </div> */}
                      {/* <div className="flex items-center justify-between rounded-lg border p-4">
                        <span className="text-sm font-medium">Photos</span>
                        <StatusBadge status={documents.photos_uploaded ? "approved" : "pending"}>
                          {documents.photos_uploaded ? "Uploaded" : "Missing"}
                        </StatusBadge>
                      </div> */}
                      {/* <div className="flex items-center justify-between rounded-lg border p-4">
                        <span className="text-sm font-medium">FIR</span>
                        <StatusBadge status={documents.fir_uploaded ? "approved" : "pending"}>
                          {documents.fir_uploaded ? "Uploaded" : "Missing"}
                        </StatusBadge>
                      </div> */}


                      <div className="rounded-lg border p-4 space-y-3">
                        {/* Header */}
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Photos</span>

                          {/* <StatusBadge status={photos.length >= 1 ? "approved" : "pending"}>
                            {photos.length >= 1 ? "Available" : "Not Available"}
                          </StatusBadge> */}
                        </div>

                        {/* 4 Image Grid */}
                        <div className="grid grid-cols-2 gap-3">
                          {[0, 1, 2, 3].map((index) => {
                            const obj = photos[index];
                            const imageUrlObject =
                              typeof obj === "string"
                                ? obj
                                : (obj as { image?: { url?: string } })?.image?.url;
                            // const imageUrl = "http://localhost:8000/media/vehicle_damage/CLM_D001_1.JPEG";
                            const imageUrl = API_MEDIA_URL + imageUrlObject;
                            const imageExists = Boolean(imageUrl);
                            console.log("Photo object:", imageUrl);
                            return imageExists ? (
                              <img
                                key={index}
                                src={imageUrl}
                                alt={`Photo ${index + 1}`}
                                className="h-28 w-full rounded-md border object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <div
                                key={index}
                                className="h-28 w-full rounded-md border bg-gray-100 flex items-center justify-center text-xs text-gray-500"
                              >
                                No Image
                              </div>
                            );
                          })}
                        </div>
                      </div>


                    </div>




                  </CardContent>
                </Card>
              </TabsContent>

              {damageDetectionRun && (
                <TabsContent value="claim-evaluation">
                  <Card className="card-elevated">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        Claim Evaluation Response
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {claimEvaluationLoading ? (
                        <div className="flex items-center justify-center py-12">
                          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                      ) : claimEvaluation ? (
                        <div className="space-y-6">
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div className="rounded-lg border p-4">
                              <p className="text-xs text-muted-foreground">Complaint ID</p>
                              <p className="text-sm font-medium mt-1">{claimEvaluation.complaint_id}</p>
                            </div>
                            <div className="rounded-lg border p-4">
                              <p className="text-xs text-muted-foreground">Damage Confidence</p>
                              <p className="text-sm font-medium mt-1">{claimEvaluation.damage_confidence}%</p>
                            </div>
                            <div className="rounded-lg border p-4">
                              <p className="text-xs text-muted-foreground">Claim Amount</p>
                              <p className="text-sm font-medium mt-1">{formatCurrency(claimEvaluation.claim_amount)}</p>
                            </div>
                            <div className="rounded-lg border p-4">
                              <p className="text-xs text-muted-foreground">Excess Amount</p>
                              <p className="text-sm font-medium mt-1">{formatCurrency(claimEvaluation.excess_amount ?? 0)}</p>
                            </div>
                            <div className="rounded-lg border p-4">
                              <p className="text-xs text-muted-foreground">Estimated Repair</p>
                              <p className="text-sm font-medium mt-1">
                                {formatCurrency(claimEvaluation.estimated_repair ?? Math.max(0, (claimEvaluation.claim_amount ?? 0) - (claimEvaluation.excess_amount ?? 0)))}
                              </p>
                            </div>
                            <div className="rounded-lg border p-4">
                              <p className="text-xs text-muted-foreground">Threshold Value</p>
                              <p className="text-sm font-medium mt-1">{claimEvaluation.threshold_value ?? "—"}</p>
                            </div>
                            <div className="rounded-lg border p-4">
                              <p className="text-xs text-muted-foreground">Claim Type</p>
                              <p className="text-sm font-medium mt-1">{claimEvaluation.claim_type ?? "—"}</p>
                            </div>
                            {claimEvaluation.llm_severity && (
                              <div className="rounded-lg border p-4">
                                <p className="text-xs text-muted-foreground">LLM Severity</p>
                                <p className="text-sm font-medium mt-1">{claimEvaluation.llm_severity}</p>
                              </div>
                            )}
                            {claimEvaluation.reason && (
                              <div className="rounded-lg border p-4 sm:col-span-2">
                                <p className="text-xs text-muted-foreground">Reason</p>
                                <p className="text-sm font-medium mt-1">{claimEvaluation.reason}</p>
                              </div>
                            )}
                            {claimEvaluation.llm_damages && claimEvaluation.llm_damages.length > 0 && (
                              <div className="rounded-lg border p-4 sm:col-span-2">
                                <p className="text-xs text-muted-foreground">LLM Damages</p>
                                <div className="flex flex-wrap gap-2 mt-2">
                                  {claimEvaluation.llm_damages.map((d) => (
                                    <span
                                      key={d}
                                      className="rounded-full bg-secondary px-3 py-1 text-xs font-medium"
                                    >
                                      {d}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground py-8 text-center">
                          No evaluation data found for this claim.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              )}

              {!isOpenClaim && (
                <TabsContent value="fraud-evaluation">
                  <Card className="card-elevated">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Shield className="h-4 w-4" />
                        Fraud Evaluation
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-sm text-muted-foreground">
                        Evaluation based on Master Data fraud rules. Green indicates the rule passed; red indicates it failed.
                      </p>
                      {(() => {
                        const rules = fraudResult?.fraud_rule_results ?? assessment?.fraud_rule_results ?? [];
                        console.log("Parsed fraud rules to display:", rules);
                        if (rules.length === 0) {
                          return (
                            <p className="text-sm text-muted-foreground py-8 text-center">
                              Click &quot;Fraud Detection&quot; to run validation and see results.
                            </p>
                          );
                        }
                        return (
                          <div className="space-y-3">
                            {rules.map((r, i) => (
                              <div
                                key={i}
                                className={`flex items-center justify-between rounded-lg border p-4 ${r.passed ? "bg-success/5 border-success/20" : "bg-destructive/5 border-destructive/20"
                                  }`}
                              >
                                <div>
                                  <p className="text-sm font-medium">{r.rule_type}</p>
                                  <p className="text-xs text-muted-foreground">{r.rule_description}</p>
                                </div>
                                <span
                                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${r.passed ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                                    }`}
                                >
                                  {r.passed ? (
                                    <>
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                      Pass
                                    </>
                                  ) : (
                                    <>
                                      <AlertTriangle className="h-3.5 w-3.5" />
                                      Fail
                                    </>
                                  )}
                                </span>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </CardContent>
                  </Card>
                </TabsContent>
              )}

              {/* <TabsContent value="timeline">
                <Card className="card-elevated">
                  <CardHeader>
                    <CardTitle className="text-base">Claim Timeline</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {[
                        {
                          date: fnol.created_date,
                          title: "Claim Submitted",
                          description: "FNOL received",
                        },
                        {
                          date: fnol.created_date,
                          title: "Damage Assessment",
                          description: `Damage confidence: ${aiConfidence}%, Fraud: ${fraudBand}`,
                        },
                        {
                          date: fnol.created_date,
                          title: "Decision",
                          description: decision,
                        },
                      ].map((event, i) => (
                        <div key={i} className="flex gap-4">
                          <div className="flex flex-col items-center">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                              <div className="h-2 w-2 rounded-full bg-primary" />
                            </div>
                            {i < 2 && <div className="w-px flex-1 bg-border" />}
                          </div>
                          <div className="pb-4">
                            <p className="text-sm font-medium">{event.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {event.description}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {event.date ? new Date(event.date).toLocaleString() : "—"}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent> */}
            </Tabs>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <Card className="card-elevated">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Customer Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* <div>
                  <p className="text-sm">
                    Name: {fnol.policy_holder_name || claimant.driver_name || "—"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Policy: {fnol.policy_number || policy.policy_number || "—"}
                  </p>
                </div> 
                <Separator /> */}
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Name</span>
                    <span className="text-muted-foreground font-medium ">
                       {fnol.policy_holder_name || claimant.driver_name || "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Policy</span>
                    <span className="font-medium">{fnol.policy_number || policy.policy_number || "—"}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="card-elevated">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Policy Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Coverage Type</span>
                  <span className="font-medium">
                    {fnol.coverage_type || policy.coverage_type || "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Policy Status</span>
                  <span className="font-medium">
                    {fnol.policy_status || policy.policy_status || "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Flood Coverage Endorsement</span>
                  <span className="font-medium">
                    {fnol.flood_coverage === true || fnol.flood_coverage === 1 ? "Yes" : "No"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Policy Start</span>
                  <span>
                    {fnol.policy_start_date
                      ? new Date(fnol.policy_start_date).toLocaleDateString()
                      : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Policy End</span>
                  <span>
                    {fnol.policy_end_date
                      ? new Date(fnol.policy_end_date).toLocaleDateString()
                      : "—"}
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="card-elevated">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Car className="h-4 w-4" />
                  Vehicle Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Vehicle</span>
                  <span>
                    {[fnol.vehicle_year, fnol.vehicle_make, fnol.vehicle_model]
                      .filter(Boolean)
                      .join(" ") ||
                      `${vehicle.year ?? ""} ${vehicle.make ?? ""} ${vehicle.model ?? ""}`.trim() ||
                      "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Registration</span>
                  <span className="font-mono">
                    {fnol.vehicle_registration_number || vehicle.registration_number || "—"}
                  </span>
                </div>
                {/* <div className="flex justify-between">
                  <span className="text-muted-foreground">Coverage</span>
                  <span>{fnol.coverage_type || policy.coverage_type || "—"}</span>
                </div> */}
              </CardContent>
            </Card>


          </div>
        </div>
      </div>
    </AppLayout>
  );
}
