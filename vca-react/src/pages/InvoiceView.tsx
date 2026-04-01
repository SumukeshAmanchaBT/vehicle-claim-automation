import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getInvoiceHistoryDetail, type InvoiceHistoryItem } from "@/lib/api";
import { useToast } from "@/components/ui/use-toast";
import type { AxiosError } from "axios";

type PartRow = {
  id: number;
  description: string | null;
  quantity: number | null;
  unit_price: string | null;
  amount: string | null;
};

export default function InvoiceView() {
  const navigate = useNavigate();
  const params = useParams();
  const claimNumber = String(params.claimNumber || "").trim();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [core, setCore] = useState<InvoiceHistoryItem | null>(null);
  const [parts, setParts] = useState<PartRow[]>([]);

  useEffect(() => {
    if (!claimNumber) return;
    setLoading(true);
    setError(null);
    getInvoiceHistoryDetail(claimNumber)
      .then((res) => {
        setCore(res.core);
        setParts(res.parts || []);
      })
      .catch((e) => {
        const err = e as AxiosError<any>;
        const msg = err?.response?.data?.error || "Failed to load invoice.";
        setError(msg);
        toast({ title: "Error", description: msg, variant: "destructive" });
      })
      .finally(() => setLoading(false));
  }, [claimNumber]);

  return (
    <AppLayout title="Invoice Details" subtitle={claimNumber ? `Claim ${claimNumber}` : ""}>
      <div className="space-y-4 animate-fade-in">
        {error && (
          <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={() => navigate(-1)} disabled={loading}>
            Back
          </Button>
          <Button
            onClick={() =>
              claimNumber && navigate(`/Claim-Digitization?editClaim=${encodeURIComponent(claimNumber)}`)
            }
            disabled={!claimNumber || loading}
          >
            Edit
          </Button>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Eye className="h-4 w-4 text-muted-foreground" />
            View
          </div>

          <div className="overflow-hidden rounded-md border bg-background">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead>Claim Number</TableHead>
                  <TableHead>Vehicle Number</TableHead>
                  <TableHead>Engine</TableHead>
                  <TableHead>Chassis</TableHead>
                  <TableHead>Make</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>{core?.claim_number ?? claimNumber ?? "—"}</TableCell>
                  <TableCell>{core?.vehicle_number ?? "—"}</TableCell>
                  <TableCell>{core?.engine_number ?? "—"}</TableCell>
                  <TableCell>{core?.chassis_number ?? "—"}</TableCell>
                  <TableCell>{core?.make ?? "—"}</TableCell>
                  <TableCell>{core?.model_number ?? "—"}</TableCell>
                  <TableCell>{core?.amount ?? "—"}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="mb-2 text-sm font-semibold">Parts Details</div>
          <div className="max-h-[520px] overflow-auto rounded-md border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-24">Qty</TableHead>
                  <TableHead className="w-32">Unit Price</TableHead>
                  <TableHead className="w-32">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-sm text-muted-foreground">
                      {loading ? "Loading..." : "No parts found."}
                    </TableCell>
                  </TableRow>
                ) : (
                  parts.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.description ?? "—"}</TableCell>
                      <TableCell>{p.quantity ?? "—"}</TableCell>
                      <TableCell>{p.unit_price ?? "—"}</TableCell>
                      <TableCell>{p.amount ?? "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

