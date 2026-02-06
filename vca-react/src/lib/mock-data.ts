// Mock data for the insurance claims platform

export interface Claim {
  id: string;
  claimNumber: string;
  policyNumber: string;
  customerName: string;
  vehicleInfo: string;
  incidentDate: string;
  submittedDate: string;
  status: "pending" | "approved" | "rejected" | "processing" | "flagged";
  claimType: string;
  estimatedAmount: number;
  approvedAmount?: number;
  aiConfidence: number;
  fraudScore: number;
  damageType: string[];
  assignedTo?: string;
  priority: "low" | "medium" | "high";
}

export const mockClaims: Claim[] = [
  {
    id: "1",
    claimNumber: "CLM-2024-0892",
    policyNumber: "POL-VH-2024-0156",
    customerName: "Sarah Mitchell",
    vehicleInfo: "2022 Toyota Camry",
    incidentDate: "2024-02-01",
    submittedDate: "2024-02-02",
    status: "pending",
    claimType: "Collision",
    estimatedAmount: 4500,
    aiConfidence: 92,
    fraudScore: 12,
    damageType: ["Front Bumper", "Hood", "Headlight"],
    assignedTo: "John Doe",
    priority: "medium",
  },
  {
    id: "2",
    claimNumber: "CLM-2024-0891",
    policyNumber: "POL-VH-2024-0298",
    customerName: "Michael Chen",
    vehicleInfo: "2021 Honda Accord",
    incidentDate: "2024-02-01",
    submittedDate: "2024-02-01",
    status: "flagged",
    claimType: "Theft",
    estimatedAmount: 28000,
    aiConfidence: 67,
    fraudScore: 78,
    damageType: ["Total Loss"],
    assignedTo: "Jane Smith",
    priority: "high",
  },
  {
    id: "3",
    claimNumber: "CLM-2024-0890",
    policyNumber: "POL-VH-2024-0445",
    customerName: "Emily Rodriguez",
    vehicleInfo: "2023 BMW X5",
    incidentDate: "2024-01-30",
    submittedDate: "2024-01-31",
    status: "approved",
    claimType: "Glass",
    estimatedAmount: 850,
    approvedAmount: 850,
    aiConfidence: 98,
    fraudScore: 5,
    damageType: ["Windshield"],
    priority: "low",
  },
  {
    id: "4",
    claimNumber: "CLM-2024-0889",
    policyNumber: "POL-VH-2024-0312",
    customerName: "David Thompson",
    vehicleInfo: "2020 Ford F-150",
    incidentDate: "2024-01-29",
    submittedDate: "2024-01-30",
    status: "processing",
    claimType: "Collision",
    estimatedAmount: 7200,
    aiConfidence: 88,
    fraudScore: 22,
    damageType: ["Rear Bumper", "Tailgate", "Tail Light"],
    assignedTo: "John Doe",
    priority: "medium",
  },
  {
    id: "5",
    claimNumber: "CLM-2024-0888",
    policyNumber: "POL-VH-2024-0178",
    customerName: "Jessica Williams",
    vehicleInfo: "2022 Audi A4",
    incidentDate: "2024-01-28",
    submittedDate: "2024-01-28",
    status: "rejected",
    claimType: "Vandalism",
    estimatedAmount: 3200,
    aiConfidence: 45,
    fraudScore: 65,
    damageType: ["Door Panel", "Window"],
    priority: "high",
  },
  {
    id: "6",
    claimNumber: "CLM-2024-0887",
    policyNumber: "POL-VH-2024-0521",
    customerName: "Robert Martinez",
    vehicleInfo: "2021 Chevrolet Malibu",
    incidentDate: "2024-01-27",
    submittedDate: "2024-01-27",
    status: "approved",
    claimType: "Collision",
    estimatedAmount: 2100,
    approvedAmount: 1950,
    aiConfidence: 95,
    fraudScore: 8,
    damageType: ["Side Mirror", "Door"],
    priority: "low",
  },
];

export interface DashboardStats {
  totalClaims: number;
  pendingReview: number;
  approvedToday: number;
  automationRate: number;
  avgProcessingTime: string;
  totalSettlementValue: number;
  fraudFlagged: number;
  stpRate: number;
}

export const mockDashboardStats: DashboardStats = {
  totalClaims: 1247,
  pendingReview: 38,
  approvedToday: 24,
  automationRate: 72,
  avgProcessingTime: "4.2 hrs",
  totalSettlementValue: 892450,
  fraudFlagged: 12,
  stpRate: 68,
};

export const mockClaimsTrend = [
  { date: "Jan 1", claims: 42, approved: 35, rejected: 4 },
  { date: "Jan 8", claims: 58, approved: 48, rejected: 6 },
  { date: "Jan 15", claims: 45, approved: 38, rejected: 3 },
  { date: "Jan 22", claims: 67, approved: 55, rejected: 8 },
  { date: "Jan 29", claims: 52, approved: 44, rejected: 5 },
  { date: "Feb 5", claims: 61, approved: 52, rejected: 6 },
];

export const mockClaimsByType = [
  { type: "Collision", count: 45, percentage: 45 },
  { type: "Theft", count: 15, percentage: 15 },
  { type: "Glass", count: 20, percentage: 20 },
  { type: "Vandalism", count: 12, percentage: 12 },
  { type: "Weather", count: 8, percentage: 8 },
];

export const mockFraudAlerts = [
  {
    id: "1",
    claimNumber: "CLM-2024-0891",
    riskScore: 78,
    reason: "Early claim filing (<30 days from policy start)",
    detectedAt: "2024-02-01T14:30:00",
  },
  {
    id: "2",
    claimNumber: "CLM-2024-0888",
    riskScore: 65,
    reason: "Location mismatch detected",
    detectedAt: "2024-01-28T09:15:00",
  },
  {
    id: "3",
    claimNumber: "CLM-2024-0875",
    riskScore: 58,
    reason: "Repeat repair shop usage pattern",
    detectedAt: "2024-01-25T11:45:00",
  },
];