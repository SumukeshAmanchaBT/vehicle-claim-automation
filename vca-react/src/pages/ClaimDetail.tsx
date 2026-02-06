import { useParams, Link } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Car,
  User,
  Calendar,
  MapPin,
  FileImage,
  Shield,
  CheckCircle2,
  AlertTriangle,
  Clock,
  DollarSign,
  Brain,
  Eye,
} from "lucide-react";
import { mockClaims, type Claim } from "@/lib/mock-data";

const getStatusVariant = (
  status: Claim["status"]
): "approved" | "pending" | "rejected" | "processing" => {
  const map = {
    approved: "approved" as const,
    pending: "pending" as const,
    rejected: "rejected" as const,
    processing: "processing" as const,
    flagged: "rejected" as const,
  };
  return map[status];
};

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  }).format(amount);
};

export default function ClaimDetail() {
  const { id } = useParams();
  const claim = mockClaims.find((c) => c.id === id);

  if (!claim) {
    return (
      <AppLayout title="Claim Not Found">
        <div className="flex flex-col items-center justify-center py-12">
          <p className="text-lg text-muted-foreground">
            The claim you're looking for doesn't exist.
          </p>
          <Button asChild className="mt-4">
            <Link to="/claims">Back to Claims</Link>
          </Button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout
      title={claim.claimNumber}
      subtitle={`${claim.claimType} claim - ${claim.customerName}`}
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
          <div className="flex items-center gap-2">
            <StatusBadge
              status={getStatusVariant(claim.status)}
              pulse={claim.status === "processing"}
              className="text-sm px-3 py-1"
            >
              {claim.status.charAt(0).toUpperCase() + claim.status.slice(1)}
            </StatusBadge>
            <Button variant="outline">Request Documents</Button>
            <Button variant="destructive">Reject</Button>
            <Button>Approve Claim</Button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Overview Cards */}
            <div className="grid gap-4 sm:grid-cols-3">
              <Card className="card-elevated">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <DollarSign className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Estimated
                      </p>
                      <p className="text-xl font-bold">
                        {formatCurrency(claim.estimatedAmount)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="card-elevated">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-success/10">
                      <Brain className="h-5 w-5 text-success" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        AI Confidence
                      </p>
                      <p className="text-xl font-bold">{claim.aiConfidence}%</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card className="card-elevated">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                        claim.fraudScore >= 50
                          ? "bg-destructive/10"
                          : claim.fraudScore >= 30
                          ? "bg-warning/10"
                          : "bg-success/10"
                      }`}
                    >
                      <Shield
                        className={`h-5 w-5 ${
                          claim.fraudScore >= 50
                            ? "text-destructive"
                            : claim.fraudScore >= 30
                            ? "text-warning"
                            : "text-success"
                        }`}
                      />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Fraud Risk
                      </p>
                      <p className="text-xl font-bold">{claim.fraudScore}%</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="details" className="space-y-4">
              <TabsList>
                <TabsTrigger value="details">Claim Details</TabsTrigger>
                <TabsTrigger value="assessment">AI Assessment</TabsTrigger>
                <TabsTrigger value="documents">Documents</TabsTrigger>
                <TabsTrigger value="timeline">Timeline</TabsTrigger>
              </TabsList>

              <TabsContent value="details">
                <Card className="card-elevated">
                  <CardHeader>
                    <CardTitle className="text-base">
                      Incident Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid gap-6 sm:grid-cols-2">
                      <div className="space-y-4">
                        <div className="flex items-start gap-3">
                          <Calendar className="h-4 w-4 mt-1 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">Incident Date</p>
                            <p className="text-sm text-muted-foreground">
                              {new Date(
                                claim.incidentDate
                              ).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <MapPin className="h-4 w-4 mt-1 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">Location</p>
                            <p className="text-sm text-muted-foreground">
                              123 Main Street, Los Angeles, CA
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div className="flex items-start gap-3">
                          <Clock className="h-4 w-4 mt-1 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">Submitted</p>
                            <p className="text-sm text-muted-foreground">
                              {new Date(
                                claim.submittedDate
                              ).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <User className="h-4 w-4 mt-1 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">Assigned To</p>
                            <p className="text-sm text-muted-foreground">
                              {claim.assignedTo || "Unassigned"}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <Separator />

                    <div>
                      <h4 className="text-sm font-medium mb-3">Damage Types</h4>
                      <div className="flex flex-wrap gap-2">
                        {claim.damageType.map((type) => (
                          <span
                            key={type}
                            className="rounded-full bg-secondary px-3 py-1 text-xs font-medium"
                          >
                            {type}
                          </span>
                        ))}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="assessment">
                <Card className="card-elevated">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Brain className="h-4 w-4" />
                      AI Damage Assessment
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm">Overall Confidence</span>
                        <span className="text-sm font-medium">
                          {claim.aiConfidence}%
                        </span>
                      </div>
                      <Progress
                        value={claim.aiConfidence}
                        className="h-2"
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="rounded-lg border p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <CheckCircle2 className="h-4 w-4 text-success" />
                          <span className="text-sm font-medium">
                            Validations Passed
                          </span>
                        </div>
                        <ul className="space-y-1 text-sm text-muted-foreground">
                          <li>• Policy active & premium paid</li>
                          <li>• Vehicle-policy match confirmed</li>
                          <li>• Coverage eligibility verified</li>
                          <li>• Number plate match verified</li>
                        </ul>
                      </div>
                      <div className="rounded-lg border p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Eye className="h-4 w-4 text-primary" />
                          <span className="text-sm font-medium">
                            Damage Detection
                          </span>
                        </div>
                        <ul className="space-y-1 text-sm text-muted-foreground">
                          {claim.damageType.map((type) => (
                            <li key={type}>• {type} detected</li>
                          ))}
                          <li>• No pre-existing damage found</li>
                        </ul>
                      </div>
                    </div>

                    {claim.aiConfidence >= 85 && claim.fraudScore < 30 && (
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

                    {claim.fraudScore >= 50 && (
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

              <TabsContent value="documents">
                <Card className="card-elevated">
                  <CardHeader>
                    <CardTitle className="text-base">
                      Uploaded Documents
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 sm:grid-cols-4">
                      {[1, 2, 3, 4].map((i) => (
                        <div
                          key={i}
                          className="aspect-square rounded-lg border bg-muted flex items-center justify-center group cursor-pointer hover:border-primary transition-colors"
                        >
                          <div className="text-center">
                            <FileImage className="h-8 w-8 mx-auto text-muted-foreground group-hover:text-primary transition-colors" />
                            <p className="text-xs text-muted-foreground mt-2">
                              damage_{i}.jpg
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="timeline">
                <Card className="card-elevated">
                  <CardHeader>
                    <CardTitle className="text-base">Claim Timeline</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {[
                        {
                          date: claim.submittedDate,
                          title: "Claim Submitted",
                          description: "FNOL received from Guidewire",
                        },
                        {
                          date: claim.submittedDate,
                          title: "AI Assessment Started",
                          description:
                            "Automated damage detection initiated",
                        },
                        {
                          date: claim.submittedDate,
                          title: "Validation Complete",
                          description: "Policy and coverage validated",
                        },
                        {
                          date: claim.submittedDate,
                          title: "Fraud Check Complete",
                          description: `Risk score: ${claim.fraudScore}%`,
                        },
                      ].map((event, i) => (
                        <div key={i} className="flex gap-4">
                          <div className="flex flex-col items-center">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                              <div className="h-2 w-2 rounded-full bg-primary" />
                            </div>
                            {i < 3 && (
                              <div className="w-px flex-1 bg-border" />
                            )}
                          </div>
                          <div className="pb-4">
                            <p className="text-sm font-medium">{event.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {event.description}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {new Date(event.date).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Customer Info */}
            <Card className="card-elevated">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Customer Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm font-medium">{claim.customerName}</p>
                  <p className="text-xs text-muted-foreground">
                    Policy: {claim.policyNumber}
                  </p>
                </div>
                <Separator />
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Email</span>
                    <span>customer@email.com</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Phone</span>
                    <span>+1 (555) 123-4567</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Vehicle Info */}
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
                  <span>{claim.vehicleInfo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">VIN</span>
                  <span className="font-mono">1HGBH41JXMN109186</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Plate</span>
                  <span>ABC-1234</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Coverage</span>
                  <span>Comprehensive</span>
                </div>
              </CardContent>
            </Card>

            {/* Settlement Info */}
            <Card className="card-elevated">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Settlement Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">
                    Estimated Damage
                  </span>
                  <span className="font-medium">
                    {formatCurrency(claim.estimatedAmount)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Deductible</span>
                  <span>{formatCurrency(500)}</span>
                </div>
                <Separator />
                <div className="flex justify-between font-medium">
                  <span>Payout Amount</span>
                  <span className="text-primary">
                    {formatCurrency(claim.estimatedAmount - 500)}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}