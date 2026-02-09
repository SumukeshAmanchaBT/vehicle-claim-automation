import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Loader2 } from "lucide-react";
import { saveFnol, type FnolPayload } from "@/lib/api";

const defaultFnol: FnolPayload = {
  claim_id: "",
  policy: {
    policy_number: "",
    policy_status: "Active",
    coverage_type: "Comprehensive",
    policy_start_date: "",
    policy_end_date: "",
  },
  vehicle: {
    registration_number: "",
    make: "",
    model: "",
    year: new Date().getFullYear(),
  },
  incident: {
    date_time_of_loss: "",
    location: "Bangalore",
    loss_description: "",
    claim_type: "Own Damage",
    estimated_amount: 0,
  },
  claimant: {
    driver_name: "",
    driving_license_number: "",
    license_valid_till: "",
  },
  documents: {
    rc_copy_uploaded: false,
    dl_copy_uploaded: false,
    photos_uploaded: false,
    fir_uploaded: false,
  },
  history: {
    previous_claims_last_12_months: 0,
  },
};

export default function ClaimIntake() {
  const navigate = useNavigate();
  const [fnol, setFnol] = useState<FnolPayload>(defaultFnol);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = <K extends keyof FnolPayload>(section: K, field: keyof FnolPayload[K], value: unknown) => {
    setFnol((prev) => ({
      ...prev,
      [section]: {
        ...(prev[section] as object),
        [field]: value,
      },
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { id } = await saveFnol(fnol);
      navigate(`/claims/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save claim");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppLayout
      title="New Claim"
      subtitle="Submit First Notice of Loss (FNOL)"
    >
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center gap-4">
          <Button variant="outline" asChild>
            <Link to="/claims">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Claims
            </Link>
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </div>
          )}

          <Card className="card-elevated">
            <CardHeader>
              <CardTitle className="text-base">Claim Identification</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="claim_id">Claim ID</Label>
                <Input
                  id="claim_id"
                  value={fnol.claim_id}
                  onChange={(e) => setFnol((p) => ({ ...p, claim_id: e.target.value }))}
                  placeholder="e.g. CLM-DOCS-001"
                  required
                />
              </div>
            </CardContent>
          </Card>

          <Card className="card-elevated">
            <CardHeader>
              <CardTitle className="text-base">Policy Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="policy_number">Policy Number</Label>
                <Input
                  id="policy_number"
                  value={fnol.policy.policy_number}
                  onChange={(e) => update("policy", "policy_number", e.target.value)}
                  placeholder="e.g. POL500001"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="policy_status">Policy Status</Label>
                <Select
                  value={fnol.policy.policy_status}
                  onValueChange={(v) => update("policy", "policy_status", v)}
                >
                  <SelectTrigger id="policy_status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Active">Active</SelectItem>
                    <SelectItem value="Inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="coverage_type">Coverage Type</Label>
                <Input
                  id="coverage_type"
                  value={fnol.policy.coverage_type}
                  onChange={(e) => update("policy", "coverage_type", e.target.value)}
                  placeholder="e.g. Comprehensive"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="policy_start_date">Policy Start Date</Label>
                <Input
                  id="policy_start_date"
                  type="date"
                  value={fnol.policy.policy_start_date}
                  onChange={(e) => update("policy", "policy_start_date", e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="policy_end_date">Policy End Date</Label>
                <Input
                  id="policy_end_date"
                  type="date"
                  value={fnol.policy.policy_end_date}
                  onChange={(e) => update("policy", "policy_end_date", e.target.value)}
                  required
                />
              </div>
            </CardContent>
          </Card>

          <Card className="card-elevated">
            <CardHeader>
              <CardTitle className="text-base">Vehicle Information</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="registration_number">Registration Number</Label>
                <Input
                  id="registration_number"
                  value={fnol.vehicle.registration_number}
                  onChange={(e) => update("vehicle", "registration_number", e.target.value)}
                  placeholder="e.g. KA05JK5555"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="make">Make</Label>
                <Input
                  id="make"
                  value={fnol.vehicle.make}
                  onChange={(e) => update("vehicle", "make", e.target.value)}
                  placeholder="e.g. Toyota"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="model">Model</Label>
                <Input
                  id="model"
                  value={fnol.vehicle.model}
                  onChange={(e) => update("vehicle", "model", e.target.value)}
                  placeholder="e.g. Innova"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="year">Year</Label>
                <Input
                  id="year"
                  type="number"
                  value={fnol.vehicle.year || ""}
                  onChange={(e) => update("vehicle", "year", parseInt(e.target.value, 10) || 0)}
                  placeholder="e.g. 2021"
                  required
                />
              </div>
            </CardContent>
          </Card>

          <Card className="card-elevated">
            <CardHeader>
              <CardTitle className="text-base">Incident Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="date_time_of_loss">Date & Time of Loss</Label>
                <Input
                  id="date_time_of_loss"
                  type="datetime-local"
                  value={fnol.incident.date_time_of_loss ? fnol.incident.date_time_of_loss.replace("Z", "").slice(0, 16) : ""}
                  onChange={(e) => update("incident", "date_time_of_loss", e.target.value ? `${e.target.value}:00` : "")}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">Location</Label>
                <Input
                  id="location"
                  value={fnol.incident.location}
                  onChange={(e) => update("incident", "location", e.target.value)}
                  placeholder="e.g. Bangalore"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="claim_type">Claim Type</Label>
                <Input
                  id="claim_type"
                  value={fnol.incident.claim_type}
                  onChange={(e) => update("incident", "claim_type", e.target.value)}
                  placeholder="e.g. Own Damage"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="estimated_amount">Estimated Amount (₹)</Label>
                <Input
                  id="estimated_amount"
                  type="number"
                  min={0}
                  value={fnol.incident.estimated_amount || ""}
                  onChange={(e) => update("incident", "estimated_amount", parseInt(e.target.value, 10) || 0)}
                  placeholder="e.g. 30000"
                  required
                />
              </div>
              <div className="sm:col-span-2 space-y-2">
                <Label htmlFor="loss_description">Loss Description</Label>
                <Textarea
                  id="loss_description"
                  value={fnol.incident.loss_description}
                  onChange={(e) => update("incident", "loss_description", e.target.value)}
                  placeholder="e.g. Front bumper and glass damage in slow collision"
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="card-elevated">
            <CardHeader>
              <CardTitle className="text-base">Claimant / Driver Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="driver_name">Driver Name</Label>
                <Input
                  id="driver_name"
                  value={fnol.claimant.driver_name}
                  onChange={(e) => update("claimant", "driver_name", e.target.value)}
                  placeholder="e.g. Mahesh R"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="driving_license_number">Driving License Number</Label>
                <Input
                  id="driving_license_number"
                  value={fnol.claimant.driving_license_number}
                  onChange={(e) => update("claimant", "driving_license_number", e.target.value)}
                  placeholder="e.g. DLKA5555555"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="license_valid_till">License Valid Till</Label>
                <Input
                  id="license_valid_till"
                  type="date"
                  value={fnol.claimant.license_valid_till}
                  onChange={(e) => update("claimant", "license_valid_till", e.target.value)}
                  placeholder="e.g. 2031-09-30"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="card-elevated">
            <CardHeader>
              <CardTitle className="text-base">Documents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="font-medium">RC Copy Uploaded</p>
                  <p className="text-sm text-muted-foreground">Registration certificate</p>
                </div>
                <Switch
                  checked={fnol.documents.rc_copy_uploaded}
                  onCheckedChange={(v) => update("documents", "rc_copy_uploaded", v)}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="font-medium">DL Copy Uploaded</p>
                  <p className="text-sm text-muted-foreground">Driving license</p>
                </div>
                <Switch
                  checked={fnol.documents.dl_copy_uploaded}
                  onCheckedChange={(v) => update("documents", "dl_copy_uploaded", v)}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="font-medium">Photos Uploaded</p>
                  <p className="text-sm text-muted-foreground">Damage photos</p>
                </div>
                <Switch
                  checked={fnol.documents.photos_uploaded}
                  onCheckedChange={(v) => update("documents", "photos_uploaded", v)}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="font-medium">FIR Uploaded</p>
                  <p className="text-sm text-muted-foreground">First Information Report</p>
                </div>
                <Switch
                  checked={fnol.documents.fir_uploaded}
                  onCheckedChange={(v) => update("documents", "fir_uploaded", v)}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="card-elevated">
            <CardHeader>
              <CardTitle className="text-base">Claim History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-w-xs">
                <Label htmlFor="previous_claims">Previous Claims (Last 12 Months)</Label>
                <Input
                  id="previous_claims"
                  type="number"
                  min={0}
                  value={fnol.history.previous_claims_last_12_months}
                  onChange={(e) => update("history", "previous_claims_last_12_months", parseInt(e.target.value, 10) || 0)}
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" asChild>
              <Link to="/claims">Cancel</Link>
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Submit Claim"
              )}
            </Button>
          </div>
        </form>
      </div>
    </AppLayout>
  );
}
