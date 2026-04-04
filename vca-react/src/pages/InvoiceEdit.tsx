import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getInvoiceHistoryDetail, saveInvoiceDetails } from "@/lib/api";
import type { AxiosError } from "axios";

type CoreDetails = {
  claimNumber: string;
  vehicleNumber: string;
  engineNumber: string;
  chassisNumber: string;
  make: string;
  modelNumber: string;
  total: string;
};

type PartItem = {
  id: string;
  dbId?: number;
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
};

export default function InvoiceEdit() {
  const navigate = useNavigate();
  const params = useParams();
  const claimNumberParam = String(params.claimNumber || "").trim();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [core, setCore] = useState<CoreDetails>({
    claimNumber: claimNumberParam,
    vehicleNumber: "",
    engineNumber: "",
    chassisNumber: "",
    make: "",
    modelNumber: "",
    total: "",
  });
  const [parts, setParts] = useState<PartItem[]>([]);
  const [removedPartIds, setRemovedPartIds] = useState<number[]>([]);

  const canSave = useMemo(() => core.claimNumber.trim().length > 0, [core.claimNumber]);

  useEffect(() => {
    if (!claimNumberParam) {
      setError("Claim Number is missing in URL.");
      return;
    }
    setLoading(true);
    setError(null);
    getInvoiceHistoryDetail(claimNumberParam)
      .then((res) => {
        setCore({
          claimNumber: res.core.claim_number,
          vehicleNumber: res.core.vehicle_number ?? "",
          engineNumber: res.core.engine_number ?? "",
          chassisNumber: res.core.chassis_number ?? "",
          make: res.core.make ?? "",
          modelNumber: res.core.model_number ?? "",
          total: res.core.amount ?? "",
        });
        setParts(
          (res.parts || []).map((p, idx) => ({
            id: `part-${Date.now()}-${idx}`,
            dbId: p.id,
            description: p.description ?? "",
            quantity: p.quantity === null || p.quantity === undefined ? "" : String(p.quantity),
            unitPrice: p.unit_price ?? "",
            amount: p.amount ?? "",
          }))
        );
      })
      .catch((e) => {
        const err = e as AxiosError<any>;
        setError(err?.response?.data?.error || "Failed to load invoice.");
      })
      .finally(() => setLoading(false));
  }, [claimNumberParam]);

  const onSave = async () => {
    if (!canSave) return;
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await saveInvoiceDetails({
        claimNumber: core.claimNumber.trim(),
        coreDetails: core,
        partsDetails: parts.map((p) => ({
          id: p.dbId,
          description: p.description,
          quantity: p.quantity,
          unitPrice: p.unitPrice,
          amount: p.amount,
        })),
        removePartIds: removedPartIds,
      });
      setMessage(`Saved (parts: ${res.parts_saved}). Redirecting...`);
      navigate("/invoice-history");
    } catch (e) {
      const err = e as AxiosError<any>;
      setError(err?.response?.data?.error || "Failed to save invoice.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppLayout title="Invoice Update" subtitle={claimNumberParam ? `Claim ${claimNumberParam}` : "Edit"}>
      <div className="space-y-4 animate-fade-in">
        {error && <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>}
        {message && <div className="rounded-md bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700">{message}</div>}

        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={() => navigate(-1)} disabled={loading}>
            Back
          </Button>
          <Button onClick={onSave} disabled={loading || !canSave}>
            {loading ? "Saving..." : "Update"}
          </Button>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>Claim Number</Label>
              <Input value={core.claimNumber} disabled />
            </div>
            <div>
              <Label>Vehicle Number</Label>
              <Input value={core.vehicleNumber} onChange={(e) => setCore((p) => ({ ...p, vehicleNumber: e.target.value }))} />
            </div>
            <div>
              <Label>Engine Number</Label>
              <Input value={core.engineNumber} onChange={(e) => setCore((p) => ({ ...p, engineNumber: e.target.value }))} />
            </div>
            <div>
              <Label>Chassis Number</Label>
              <Input value={core.chassisNumber} onChange={(e) => setCore((p) => ({ ...p, chassisNumber: e.target.value }))} />
            </div>
            <div>
              <Label>Make</Label>
              <Input value={core.make} onChange={(e) => setCore((p) => ({ ...p, make: e.target.value }))} />
            </div>
            <div>
              <Label>Model Number</Label>
              <Input value={core.modelNumber} onChange={(e) => setCore((p) => ({ ...p, modelNumber: e.target.value }))} />
            </div>
            <div>
              <Label>Total</Label>
              <Input value={core.total} onChange={(e) => setCore((p) => ({ ...p, total: e.target.value }))} />
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="mb-2 text-sm font-semibold">Parts Details</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="w-24">Qty</TableHead>
                <TableHead className="w-32">Unit Price</TableHead>
                <TableHead className="w-32">Amount</TableHead>
                <TableHead className="w-20"> </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {parts.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Input value={row.description} onChange={(e) => setParts((prev) => prev.map((p) => (p.id === row.id ? { ...p, description: e.target.value } : p)))} />
                  </TableCell>
                  <TableCell>
                    <Input value={row.quantity} onChange={(e) => setParts((prev) => prev.map((p) => (p.id === row.id ? { ...p, quantity: e.target.value } : p)))} />
                  </TableCell>
                  <TableCell>
                    <Input value={row.unitPrice} onChange={(e) => setParts((prev) => prev.map((p) => (p.id === row.id ? { ...p, unitPrice: e.target.value } : p)))} />
                  </TableCell>
                  <TableCell>
                    <Input value={row.amount} onChange={(e) => setParts((prev) => prev.map((p) => (p.id === row.id ? { ...p, amount: e.target.value } : p)))} />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (row.dbId) setRemovedPartIds((prev) => [...prev, row.dbId!]);
                        setParts((prev) => prev.filter((p) => p.id !== row.id));
                      }}
                      disabled={loading}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {parts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-sm text-muted-foreground">
                    No parts found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          <div className="mt-3 flex justify-end">
            <Button
              variant="outline"
              onClick={() =>
                setParts((prev) => [
                  ...prev,
                  { id: `part-${Date.now()}`, description: "", quantity: "", unitPrice: "", amount: "" },
                ])
              }
              disabled={loading}
            >
              Add Part
            </Button>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

