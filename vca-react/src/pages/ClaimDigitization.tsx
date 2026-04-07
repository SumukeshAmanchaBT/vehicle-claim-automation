import { useEffect, useMemo, useState } from "react";
import { Check, CircleCheck, Menu, Pencil, Plus, PlusCircle, RotateCcw, Trash2, Upload, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  extractDigitizationKv,
  getInvoiceHistoryDetail,
  verifyInvoiceParts,
  addPartToMaster,
  saveInvoiceDetails,
  saveClassifiedDocumentLocal,
  uploadDigitizationDocuments,
  type DigitizationDocument,
  type DigitizationDocumentCategory,
} from "@/lib/api";
import { useToast } from "@/components/ui/use-toast";
import type { AxiosError } from "axios";

const isImageFile = (filename: string) => /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.test(filename || "");
const isPdfFile = (filename: string) => /\.pdf$/i.test(filename || "");

type ValidationTab = "raw" | "core" | "parts";

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

type ValidationData = {
  rawData: Record<string, unknown>;
  coreDetails: CoreDetails;
  partsDetails: PartItem[];
};

export default function ClaimDigitization() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [complaintId] = useState(() => `DIGI-${Date.now()}`);
  const [files, setFiles] = useState<File[]>([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [showSelectedFilesUi, setShowSelectedFilesUi] = useState(false);
  const [documents, setDocuments] = useState<DigitizationDocument[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);
  const [docCategory, setDocCategory] = useState<DigitizationDocumentCategory>("repair");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [localFileByDocId, setLocalFileByDocId] = useState<Record<number, File>>({});
  const [showValidation, setShowValidation] = useState(false);
  const [validationTab, setValidationTab] = useState<ValidationTab>("raw");
  const [rawData, setRawData] = useState<Record<string, unknown>>({});
  const [coreDetails, setCoreDetails] = useState<CoreDetails>({
    claimNumber: "",
    vehicleNumber: "",
    engineNumber: "",
    chassisNumber: "",
    make: "",
    modelNumber: "",
    total: "",
  });
  const [partsDetails, setPartsDetails] = useState<PartItem[]>([]);
  const [removedPartDbIds, setRemovedPartDbIds] = useState<number[]>([]);
  const [coreEditMode, setCoreEditMode] = useState(false);
  const [rowEditByLocalId, setRowEditByLocalId] = useState<Record<string, boolean>>({});
  const [coreSnapshot, setCoreSnapshot] = useState<CoreDetails | null>(null);
  const [rowSnapshotByLocalId, setRowSnapshotByLocalId] = useState<Record<string, PartItem>>({});
  const [partVerifyByDbId, setPartVerifyByDbId] = useState<
    Record<number, { verified: boolean; masterId: number | null; loading?: boolean }>
  >({});
  const [serverDocIdByLocalId, setServerDocIdByLocalId] = useState<Record<number, number>>({});
  const [validationDataByLocalId, setValidationDataByLocalId] = useState<Record<number, ValidationData>>({});
  const [viewerZoom, setViewerZoom] = useState(1);

  const notifySuccess = (description: string) => {
    setMessage(description);
    toast({ title: "Success", description, variant: "success" });
  };
  const notifyError = (description: string) => {
    setError(description);
    toast({ title: "Error", description, variant: "destructive" });
  };

  const zoomIn = () => setViewerZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100));
  const zoomOut = () => setViewerZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100));
  const zoomReset = () => setViewerZoom(1);

  const formatMb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)}MB`;

  const removeDocumentById = (docId: number) => {
    setDocuments((prevDocs) => {
      const nextDocs = prevDocs.filter((d) => d.id !== docId);

      // Update selection
      setSelectedDocId((prevSelected) => {
        if (prevSelected !== docId) return prevSelected;
        return nextDocs[0]?.id ?? null;
      });

      // Remove related caches/maps
      setLocalFileByDocId((prev) => {
        const copy = { ...prev };
        delete copy[docId];
        return copy;
      });
      setServerDocIdByLocalId((prev) => {
        const copy = { ...prev };
        delete copy[docId];
        return copy;
      });
      setValidationDataByLocalId((prev) => {
        const copy = { ...prev };
        delete copy[docId];
        return copy;
      });

      // Rebuild upload files list to match remaining docs order.
      setFiles((prevFiles) => {
        const remainingFileSet = new Set<File>();
        prevDocs
          .filter((d) => d.id !== docId)
          .forEach((d) => {
            const f = localFileByDocId[d.id];
            if (f) remainingFileSet.add(f);
          });
        // Keep original order from prevFiles where possible
        return prevFiles.filter((f) => remainingFileSet.has(f));
      });

      if (nextDocs.length === 0) {
        setShowValidation(false);
        setRawData({});
        setPartsDetails([]);
        setRemovedPartDbIds([]);
        setPartVerifyByDbId({});
        setViewerZoom(1);
      }
      return nextDocs;
    });
  };

  // Edit-from-history mode: open validation directly for a claim_number.
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const editClaim = (sp.get("editClaim") || "").trim();
    if (!editClaim) return;

    setLoading(true);
    setError(null);
    setMessage(null);
    getInvoiceHistoryDetail(editClaim)
      .then(async (res) => {
        let docFileUrl = res.document?.file_url || "";
        const apiBase = String(import.meta.env.VITE_API_BASE_URL || "").replace(/\/api\/?$/i, "");
        const isHttp = /^https?:\/\//i.test(docFileUrl);
        const isBlob = docFileUrl.startsWith("blob:");
        // Normalize relative media URLs so the browser loads from Django (8000), not React (8080).
        // Examples we may receive: "media/...", "/media/..."
        if (docFileUrl && !isHttp && !isBlob) {
          if (!docFileUrl.startsWith("/")) docFileUrl = `/${docFileUrl}`;
          if (apiBase) docFileUrl = `${apiBase}${docFileUrl}`;
        }
        const docOriginalFilename = res.document?.original_filename || "";
        // If backend doesn't return a filename, infer it from the URL key (works for S3 presigned URLs).
        const inferredFilenameFromUrl =
          docFileUrl
            ? decodeURIComponent(
                docFileUrl.split("?")[0].split("/").filter(Boolean).pop() || ""
              )
            : "";
        const historyFilename = docOriginalFilename || inferredFilenameFromUrl || `Invoice - ${editClaim}`;
        const historyDoc: DigitizationDocument = {
          id: Date.now(),
          complaint_id: complaintId,
          original_filename: historyFilename,
          file_url: docFileUrl,
          document_category: "repair",
          document_type: "History",
          created_date: new Date().toISOString(),
        };
        if (!historyDoc.file_url) {
          notifyError(
            `Document file_url not returned from backend for claim ${editClaim}. Please re-Submit/Classify this invoice (to persist extraction link).`
          );
        }
        setDocuments([historyDoc]);
        setSelectedDocId(historyDoc.id);

        const core: CoreDetails = {
          claimNumber: res.core.claim_number,
          vehicleNumber: res.core.vehicle_number ?? "",
          engineNumber: res.core.engine_number ?? "",
          chassisNumber: res.core.chassis_number ?? "",
          make: res.core.make ?? "",
          modelNumber: res.core.model_number ?? "",
          total: res.core.amount ?? "",
        };
        const parts: PartItem[] = (res.parts || []).map((p, idx) => ({
          id: `part-${Date.now()}-${idx}`,
          dbId: p.id,
          description: p.description ?? "",
          quantity: p.quantity === null || p.quantity === undefined ? "" : String(p.quantity),
          unitPrice: p.unit_price ?? "",
          amount: p.amount ?? "",
        }));

        setRawData({});
        setCoreDetails(core);
        setPartsDetails(parts);
        setRemovedPartDbIds([]);
        setShowValidation(true);
        setValidationTab("core");

        try {
          const verified = await verifyInvoiceParts(core.claimNumber);
          const map: Record<number, { verified: boolean; masterId: number | null }> = {};
          (verified.parts || []).forEach((x) => {
            map[x.part_detail_id] = { verified: x.verified, masterId: x.master_id };
          });
          setPartVerifyByDbId(map);
        } catch {
          // ignore verify failures
        }

        notifySuccess(`Loaded ${core.claimNumber} for update.`);
      })
      .catch((e) => {
        const err = e as AxiosError<any>;
        const apiMsg = err?.response?.data?.error;
        notifyError(typeof apiMsg === "string" ? apiMsg : "Failed to load invoice for update.");
      })
      .finally(() => setLoading(false));
  }, [location.search]);

  const selectedDoc = useMemo(
    () => documents.find((d) => d.id === selectedDocId) ?? null,
    [documents, selectedDocId]
  );

  const documentsForList = useMemo(
    () => (showValidation ? documents.filter((d) => d.document_category === "repair") : documents),
    [documents, showValidation]
  );
  const canCustomZoom = useMemo(
    () => !!selectedDoc && isImageFile(selectedDoc.original_filename),
    [selectedDoc]
  );
  const allFilesClassified = useMemo(
    () => documents.length > 0 && documents.every((d) => (d.document_type || "").trim().length > 0),
    [documents]
  );
  const unclassifiedCount = useMemo(
    () => documents.filter((d) => !(d.document_type || "").trim()).length,
    [documents]
  );

  const buildValidationFromKv = (kv: Record<string, unknown>): ValidationData => {
    const vehicleName = String(kv.vehicle_name ?? "");
    const makeModel = String(kv.make_model ?? "");
    const makeCandidate = makeModel || vehicleName;
    const split = makeCandidate.split(" ");

    const rawParts = (kv as any).parts as unknown;
    const partsFromKv = Array.isArray(rawParts)
      ? rawParts
      : rawParts && typeof rawParts === "object"
        ? [rawParts]
        : null;

    const toLooseKey = (k: string) => String(k || "").trim().toLowerCase().replace(/\s+/g, "_").replace(/[^\w]/g, "");

    const pickFirst = (row: Record<string, unknown>, keys: string[]) => {
      for (const k of keys) {
        const v = row[k as keyof typeof row];
        if (v !== null && v !== undefined && String(v).trim() !== "") return v;
      }
      return null;
    };

    const mappedParts: PartItem[] =
      partsFromKv && partsFromKv.length > 0
        ? partsFromKv
            .filter((p) => p && typeof p === "object")
            .map((p, idx) => {
              const row = p as Record<string, unknown>;
              // Normalize keys so we can accept outputs like "Description", "U/Price", "Qty", "Cost", etc.
              const looseRow: Record<string, unknown> = {};
              Object.entries(row).forEach(([k, v]) => {
                looseRow[toLooseKey(k)] = v;
              });

              const desc = pickFirst(looseRow, [
                "description",
                "desc",
                "part_description",
                "part",
                "item",
                "name",
                "part_name",
              ]);
              const qty = pickFirst(looseRow, ["quantity", "qty", "qnty", "no", "count"]);
              const unit = pickFirst(looseRow, ["unit_price", "unitprice", "uprice", "rate", "price", "uprice_ss"]);
              const amt = pickFirst(looseRow, ["amount", "amt", "cost", "total", "line_total", "linetotal"]);
              return {
                id: `part-${Date.now()}-${idx}`,
                dbId: typeof row.id === "number" ? row.id : undefined,
                description: String(desc ?? "").trim(),
                quantity:
                  qty === null || qty === undefined
                    ? ""
                    : String(qty),
                unitPrice:
                  unit === null || unit === undefined
                    ? ""
                    : String(unit),
                amount:
                  amt === null || amt === undefined
                    ? ""
                    : String(amt),
              };
            })
            .filter((r) => (r.description || "").trim().length > 0)
        : [];

    return {
      rawData: kv,
      coreDetails: {
        claimNumber: String(kv.claim_number ?? ""),
        vehicleNumber: String(kv.vehicle_number ?? ""),
        engineNumber: String(kv.engine_number ?? ""),
        chassisNumber: String(kv.chassis_number ?? ""),
        make: split[0] ?? "",
        modelNumber: split.slice(1).join(" "),
        total: String((kv.claimed_amount ?? kv.total_amount) ?? ""),
      },
      partsDetails: mappedParts,
    };
  };

  const applyValidationData = (data: ValidationData) => {
    setRawData(data.rawData);
    setCoreDetails(data.coreDetails);
    setPartsDetails(data.partsDetails);
    setCoreEditMode(false);
    setCoreSnapshot(null);
    setRowEditByLocalId({});
    setRowSnapshotByLocalId({});
  };

  const loadValidationForLocalDoc = async (localDocId: number) => {
    const cached = validationDataByLocalId[localDocId];
    if (cached) {
      applyValidationData(cached);
      const claimNumber = (cached.coreDetails.claimNumber || "").trim();
      if (claimNumber) {
        try {
          const verified = await verifyInvoiceParts(claimNumber);
          const map: Record<number, { verified: boolean; masterId: number | null }> = {};
          (verified.parts || []).forEach((x) => {
            map[x.part_detail_id] = { verified: x.verified, masterId: x.master_id };
          });
          setPartVerifyByDbId(map);
        } catch {
          // ignore verify failures for now (UI still usable)
        }
      }
      return;
    }
    const serverDocId = serverDocIdByLocalId[localDocId];
    if (!serverDocId) return;
    setLoading(true);
    try {
      const res = await extractDigitizationKv(serverDocId);
      const kv = (res.key_value_json ?? {}) as Record<string, unknown>;
      const built = buildValidationFromKv(kv);
      setValidationDataByLocalId((prev) => ({ ...prev, [localDocId]: built }));
      applyValidationData(built);
      const claimNumber = (built.coreDetails.claimNumber || "").trim();
      if (claimNumber) {
        try {
          const verified = await verifyInvoiceParts(claimNumber);
          const map: Record<number, { verified: boolean; masterId: number | null }> = {};
          (verified.parts || []).forEach((x) => {
            map[x.part_detail_id] = { verified: x.verified, masterId: x.master_id };
          });
          setPartVerifyByDbId(map);
        } catch {
          // ignore verify failures for now (UI still usable)
        }
      }
      console.log("AI Key-Value JSON:", kv);
    } catch (e) {
      const err = e as AxiosError<any>;
      const apiMsg = err?.response?.data?.error;
      notifyError(typeof apiMsg === "string" ? apiMsg : "Failed to load validation data.");
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async () => {
    setError(null);
    setMessage(null);
    if (!files.length) {
      notifyError("Please select files");
      return;
    }
    // UI-only mode: map selected files directly into local file list without API calls.
    const localDocs: DigitizationDocument[] = files.map((file, index) => ({
      id: Date.now() + index,
      complaint_id: complaintId,
      original_filename: file.name,
      file_url: URL.createObjectURL(file),
      document_category: "repair",
      document_type: "",
      created_date: new Date().toISOString(),
    }));
    setDocuments(localDocs);
    setSelectedDocId(localDocs[0]?.id ?? null);
    setDocCategory("repair");
    const fileMap: Record<number, File> = {};
    localDocs.forEach((d, i) => {
      fileMap[d.id] = files[i];
    });
    setLocalFileByDocId(fileMap);
    notifySuccess(`${localDocs.length} file(s) loaded in Invoice List.`);
    // Hide the file progress bars after Upload click (keep files for Submit)
    setShowSelectedFilesUi(false);
  };

  const handleClassify = async () => {
    if (!selectedDoc) return;
    const localFile = localFileByDocId[selectedDoc.id];
    if (!localFile) {
      notifyError("Selected file is not available in local session. Please upload again.");
      return;
    }
    const currentSelectedId = selectedDoc.id;
    const currentIndex = documents.findIndex((d) => d.id === currentSelectedId);
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      const categoryForSave = docCategory === "other" ? "other" : "repair";
      const res = await saveClassifiedDocumentLocal({
        file: localFile,
        documentCategory: categoryForSave,
        originalFilename: selectedDoc.original_filename || localFile.name,
        complaintId,
      });

      const updated: DigitizationDocument = {
        ...selectedDoc,
        original_filename: res.renamed_filename,
        document_category: docCategory,
        document_type: docCategory === "repair" ? "Repairer Documents" : "Non-Repairer Documents",
      };
      setDocuments((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      notifySuccess(`Saved: ${res.saved_path}`);

      // Auto-advance selection to the next file for faster classification
      const nextDoc = currentIndex >= 0 ? documents[currentIndex + 1] : null;
      if (nextDoc) {
        setSelectedDocId(nextDoc.id);
        setDocCategory(nextDoc.document_category || "repair");
      }
    } catch (e) {
      const err = e as AxiosError<any>;
      const apiMsg = err?.response?.data?.error;
      notifyError(typeof apiMsg === "string" ? apiMsg : "Failed to save classified document.");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!documents.length || !selectedDoc) return;
    setError(null);
    setMessage(null);
    setLoading(true);
    try {
      // 1) persist currently loaded local files to backend
      const formDataDocs = documents.filter((d) => d.file_url.startsWith("blob:"));
      if (formDataDocs.length === 0) {
        notifyError("No local documents available to submit.");
        return;
      }

      // Recreate upload payload from input files for current session
      // Build upload files from current documents order so file-wise Clear works correctly.
      const filesForUpload = documents
        .map((d) => localFileByDocId[d.id])
        .filter((f): f is File => !!f);
      if (!filesForUpload.length) {
        notifyError("Please re-select files and click Upload before Submit.");
        return;
      }

      const uploaded = await uploadDigitizationDocuments({
        complaintId,
        files: filesForUpload,
      });

      const mapIds: Record<number, number> = {};
      documents.forEach((doc, idx) => {
        const serverDoc = uploaded.documents[idx];
        if (serverDoc) {
          mapIds[doc.id] = serverDoc.id;
        }
      });
      setServerDocIdByLocalId(mapIds);

      // Extract + save ALL classified documents (not just the selected one)
      let savedCount = 0;
      let skippedCount = 0;
      let otherSkippedCount = 0;
      const nextValidationByLocalId: Record<number, ValidationData> = { ...validationDataByLocalId };

      for (const doc of documents) {
        // Only extract/save for Repairer Documents
        if (doc.document_category !== "repair") {
          otherSkippedCount += 1;
          continue;
        }
        const serverId = mapIds[doc.id];
        if (!serverId) continue;

        const res = await extractDigitizationKv(serverId);
        const kv = (res.key_value_json ?? {}) as Record<string, unknown>;
        const built = buildValidationFromKv(kv);
        nextValidationByLocalId[doc.id] = built;

        const claimNumber = (built.coreDetails.claimNumber || "").trim();
        if (!claimNumber) {
          skippedCount += 1;
          continue;
        }

        const saved = await saveInvoiceDetails({
          claimNumber,
          sourceDocumentId: serverId,
          coreDetails: built.coreDetails,
          partsDetails: built.partsDetails.map((p) => ({
            id: p.dbId,
            description: p.description,
            quantity: p.quantity,
            unitPrice: p.unitPrice,
            amount: p.amount,
          })),
          removePartIds: [],
        });
        // Store DB ids back into cached validation so master-verify icons can render.
        nextValidationByLocalId[doc.id] = {
          ...built,
          partsDetails: (saved.parts || []).map((p, idx) => ({
            id: built.partsDetails[idx]?.id ?? `part-${Date.now()}-${idx}`,
            dbId: p.id,
            description: p.description ?? "",
            quantity: p.quantity === null || p.quantity === undefined ? "" : String(p.quantity),
            unitPrice: p.unitPrice ?? "",
            amount: p.amount ?? "",
          })),
        };
        savedCount += 1;
      }

      setValidationDataByLocalId(nextValidationByLocalId);

      // If we didn't save any Repairer docs, don't enter validation mode.
      if (savedCount === 0) {
        setShowValidation(false);
        notifySuccess(
          `Submit completed. Saved ${otherSkippedCount} Non-Repairer Document file(s) to S3. No extraction was performed.`
        );
        return;
      }

      // Show validation for a Repairer document:
      // - prefer currently selected doc if it has validation data
      // - otherwise fall back to first Repairer doc
      let builtSelected = nextValidationByLocalId[selectedDoc.id];
      if (!builtSelected) {
        const firstRepair = documents.find((d) => d.document_category === "repair");
        if (firstRepair) builtSelected = nextValidationByLocalId[firstRepair.id];
      }
      if (builtSelected) {
        applyValidationData(builtSelected);
        const claimNumber = (builtSelected.coreDetails.claimNumber || "").trim();
        if (claimNumber) {
          const verified = await verifyInvoiceParts(claimNumber);
          const map: Record<number, { verified: boolean; masterId: number | null }> = {};
          (verified.parts || []).forEach((x) => {
            map[x.part_detail_id] = { verified: x.verified, masterId: x.master_id };
          });
          setPartVerifyByDbId(map);
        }
      }
      setRemovedPartDbIds([]);
      setShowValidation(true);
      setValidationTab("core");
      notifySuccess(
        `Submit completed. Saved ${savedCount} Repairer Document record(s) to database.${otherSkippedCount ? ` Skipped ${otherSkippedCount} Non-Repairer Document(s).` : ""}${skippedCount ? ` Skipped ${skippedCount} (missing Claim Number).` : ""}`
      );
    } catch (e) {
      const err = e as AxiosError<any>;
      const apiMsg = err?.response?.data?.error;
      notifyError(
        typeof apiMsg === "string"
          ? apiMsg
          : err?.message
            ? err.message
            : "Submit failed"
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppLayout title="Claim Process" subtitle="">
      <div className="space-y-4 animate-fade-in">
        <div className="rounded-xl border p-4">
          <div className="grid gap-4 lg:grid-cols-12 lg:items-stretch">
            {/* Upload panel (≈40%) */}
            <div className="lg:col-span-5">
              <div className="rounded-md border bg-background p-3">
                <div className="text-center text-[18px] font-semibold">Upload Claim Invoices</div>

                <div
                  className={`mt-3 rounded-md border border-dashed p-6 text-center transition ${
                    isDraggingFiles ? "border-primary bg-primary/5" : "border-muted-foreground/30 bg-muted/10"
                  } cursor-pointer`}
                  role="button"
                  tabIndex={0}
                  onClick={() => document.getElementById("files")?.click()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      document.getElementById("files")?.click();
                    }
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDraggingFiles(true);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDraggingFiles(true);
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDraggingFiles(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDraggingFiles(false);
                    const dropped = Array.from(e.dataTransfer.files || []);
                    if (dropped.length) {
                      setFiles(dropped);
                      setShowSelectedFilesUi(true);
                    }
                  }}
                >
                  <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-cyan-200 bg-cyan-50">
                    <Upload className="h-5 w-5 text-cyan-600" />
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Drag files here or{" "}
                    <button
                      type="button"
                      className="font-semibold text-primary underline-offset-2 hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        document.getElementById("files")?.click();
                      }}
                    >
                      Browse
                    </button>
                  </div>

                  <Input
                    id="files"
                    type="file"
                    multiple
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const picked = Array.from(e.target.files ?? []);
                      setFiles(picked);
                      setShowSelectedFilesUi(picked.length > 0);
                    }}
                  />
                </div>

                <div className="mt-3 space-y-2">
                  {!showSelectedFilesUi || files.length === 0 ? null : (
                    files.map((f) => (
                      <div key={`${f.name}-${f.size}-${f.lastModified}`} className="rounded-md border bg-card px-3 py-2">
                        <div className="flex items-center justify-between gap-2 text-xs font-semibold">
                          <div className="min-w-0 truncate">{f.name}</div>
                          <div className="shrink-0 text-muted-foreground">{formatMb(f.size)}</div>
                        </div>
                        <div className="mt-2 h-1.5 w-full rounded bg-muted">
                          <div className="h-1.5 w-full rounded bg-cyan-500" />
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="mt-2 flex items-end justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Note: Please upload only claim invoices format (jpg, jpeg, png, pdf).
                  </p>
                  <Button onClick={handleUpload} disabled={loading} className="min-w-[110px]">
                    {loading ? "Uploading..." : "Upload"}
                  </Button>
                </div>
              </div>
            </div>

            {/* Invoice list */}
            <div className={showValidation ? "lg:col-span-7" : "lg:col-span-4"}>
              <div className="h-full rounded-md border bg-background">
                <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
                  <h3 className="font-semibold">Invoice List</h3>
                  {documents.length > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDocuments([]);
                        setSelectedDocId(null);
                        setLocalFileByDocId({});
                        setFiles([]);
                        setShowSelectedFilesUi(false);
                        setMessage(null);
                        setError(null);
                      }}
                      disabled={loading}
                    >
                      Clear
                    </Button>
                  )}
                </div>
                <div className="max-h-[160px] space-y-1 overflow-auto p-2">
                  {documentsForList.length === 0 ? (
                    <p className="px-2 py-3 text-sm text-muted-foreground">
                      {showValidation ? "No Repairer documents to validate." : "Upload files to show list."}
                    </p>
                  ) : (
                    documentsForList.map((doc) => (
                      <div
                        key={`top-list-${doc.id}`}
                        className={`w-full rounded-sm border px-2 py-2 text-left text-xs font-semibold transition ${
                          doc.id === selectedDocId
                            ? "border-primary bg-primary/10 text-primary"
                            : "bg-card hover:bg-muted/60"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              setSelectedDocId(doc.id);
                              if (showValidation) {
                                await loadValidationForLocalDoc(doc.id);
                              } else {
                                setDocCategory(doc.document_category);
                              }
                            }}
                            className="min-w-0 flex-1 truncate text-left"
                            title={doc.original_filename || `Document ${doc.id}`}
                          >
                            {doc.original_filename || `Document ${doc.id}`}
                          </button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              removeDocumentById(doc.id);
                            }}
                            title="Remove file"
                            disabled={loading}
                          >
                            <X className="h-4 w-4 text-red-600" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Document type (top section) */}
            {!showValidation && (
              <div className="lg:col-span-3">
                <div className="h-full rounded-md border bg-background">
                  <div className="border-b bg-muted/40 px-3 py-2 text-center font-semibold">
                    Document Type
                  </div>
                  <div className="p-4">
                    <p className="mb-4 text-sm font-semibold">Choose Document Type</p>
                    <RadioGroup
                      value={docCategory}
                      onValueChange={(v) => setDocCategory(v as DigitizationDocumentCategory)}
                      className="space-y-3"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="repair" id="repair-docs-top" />
                        <Label htmlFor="repair-docs-top">Repairer Documents</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="other" id="other-docs-top" />
                        <Label htmlFor="other-docs-top">Non-Repairer Documents</Label>
                      </div>
                    </RadioGroup>

                    <div className="mt-8 flex gap-3">
                      <Button
                        type="button"
                        onClick={handleClassify}
                        disabled={loading || !selectedDoc}
                        className="h-10 min-w-[110px] bg-primary text-primary-foreground hover:bg-primary/90"
                      >
                        Classify
                      </Button>
                      <Button
                        type="button"
                        onClick={handleSubmit}
                        disabled={loading || documents.length === 0 || !allFilesClassified}
                        className={`h-10 min-w-[110px] ${
                          allFilesClassified
                            ? "bg-blue-600 text-white hover:bg-blue-700"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        Submit
                      </Button>
                    </div>
                    {documents.length > 0 && !allFilesClassified && (
                      <p className="mt-3 text-xs text-muted-foreground">
                        Classify all files before Submit. Remaining: {unclassifiedCount}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {!showValidation && <section className="relative rounded-xl border bg-card p-3 text-foreground shadow-sm">
          {loading && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70">
              <div className="please-wait-spinner" aria-label="Loading">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </div>
            </div>
          )}
          <div className="border-b pb-2 text-center text-[22px] font-semibold">
            Document Classification
          </div>

          <div className="mt-3 grid min-h-[560px] grid-cols-12 gap-3">
            <div className="col-span-12 rounded-md border bg-background">
              <div className="border-b bg-muted/40 px-3 py-2 text-center font-semibold">
                <div className="flex items-center justify-between">
                  <span className="w-[120px] text-left text-xs font-medium text-muted-foreground">
                    {canCustomZoom ? `${Math.round(viewerZoom * 100)}%` : ""}
                  </span>
                  <span>File Viewer</span>
                  <div className="flex w-[120px] justify-end gap-1">
                    {canCustomZoom && (
                      <>
                        <Button type="button" variant="outline" size="sm" onClick={zoomOut} disabled={viewerZoom <= 0.5}>
                          −
                        </Button>
                        <Button type="button" variant="outline" size="icon" onClick={zoomReset} aria-label="Reset zoom">
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={zoomIn} disabled={viewerZoom >= 3}>
                          +
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="p-2">
                <div className="h-[500px] overflow-auto rounded border bg-muted/20">
                  <div className="flex min-h-[500px] items-center justify-center">
                    {selectedDoc && isImageFile(selectedDoc.original_filename) ? (
                      <img
                        src={selectedDoc.file_url}
                        alt={selectedDoc.original_filename || "file preview"}
                        className="h-full w-full object-contain"
                        style={{ transform: `scale(${viewerZoom})`, transformOrigin: "top center" }}
                      />
                    ) : selectedDoc && isPdfFile(selectedDoc.original_filename) ? (
                      <iframe
                        src={selectedDoc.file_url}
                        title={selectedDoc.original_filename || "pdf preview"}
                        className="h-[500px] w-full rounded"
                      />
                    ) : selectedDoc ? (
                      <p className="text-sm text-muted-foreground">Preview unavailable for this document type.</p>
                    ) : (
                      <p className="text-sm text-muted-foreground">Select a file from the list.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>}

        {showValidation && (
          <section className="relative rounded-xl border bg-card p-3 text-foreground shadow-sm">
            {loading && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70">
                <div className="please-wait-spinner" aria-label="Loading">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </div>
              </div>
            )}
            <div className="border-b pb-2 text-center text-[22px] font-semibold">Data Validation</div>
            <div className="mt-3 grid min-h-[560px] grid-cols-12 gap-3">
              <div className="col-span-12 lg:col-span-5 rounded-md border bg-background">
                <div className="border-b bg-muted/40 px-3 py-2 text-center font-semibold">
                  <div className="flex items-center justify-between">
                    <span className="w-[120px] text-left text-xs font-medium text-muted-foreground">
                      {canCustomZoom ? `${Math.round(viewerZoom * 100)}%` : ""}
                    </span>
                    <span>File Viewer</span>
                    <div className="flex w-[120px] justify-end gap-1">
                      {canCustomZoom && (
                        <>
                          <Button type="button" variant="outline" size="sm" onClick={zoomOut} disabled={viewerZoom <= 0.5}>
                            −
                          </Button>
                          <Button type="button" variant="outline" size="icon" onClick={zoomReset} aria-label="Reset zoom">
                            <RotateCcw className="h-4 w-4" />
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={zoomIn} disabled={viewerZoom >= 3}>
                            +
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="p-2">
                  <div className="h-[500px] overflow-auto rounded border bg-muted/20">
                    <div className="flex min-h-[500px] items-center justify-center">
                      {selectedDoc && isImageFile(selectedDoc.original_filename || selectedDoc.file_url) ? (
                        <img
                          src={selectedDoc.file_url}
                          alt={selectedDoc.original_filename || "preview"}
                          className="h-full w-full object-contain"
                          style={{ transform: `scale(${viewerZoom})`, transformOrigin: "top center" }}
                        />
                      ) : selectedDoc && isPdfFile(selectedDoc.original_filename || selectedDoc.file_url) ? (
                        <iframe
                          src={selectedDoc.file_url}
                          title={selectedDoc.original_filename || "pdf"}
                          className="h-[500px] w-full rounded"
                        />
                      ) : selectedDoc && !selectedDoc.file_url ? (
                        <p className="text-sm text-muted-foreground">No source document available for this invoice (history edit mode).</p>
                      ) : (
                        <p className="text-sm text-muted-foreground">Select a file from the list.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="col-span-12 lg:col-span-7 rounded-md border bg-background">
                <div className="border-b bg-muted/40 px-3 py-2">
                  <div className="grid grid-cols-3 gap-2">
                    <Button variant={validationTab === "raw" ? "default" : "outline"} size="sm" onClick={() => setValidationTab("raw")}>RawData</Button>
                    <Button variant={validationTab === "core" ? "default" : "outline"} size="sm" onClick={() => setValidationTab("core")}>Core Details</Button>
                    <Button variant={validationTab === "parts" ? "default" : "outline"} size="sm" onClick={() => setValidationTab("parts")}>Parts Details</Button>
                  </div>
                </div>

                <div className="p-3">
                  {validationTab === "raw" && (
                    <pre className="max-h-[460px] overflow-auto rounded border bg-muted/20 p-3 text-xs">
{JSON.stringify(rawData, null, 2)}
                    </pre>
                  )}

                  {validationTab === "core" && (
                    <div className="space-y-4">
                      <div className="flex justify-end gap-1">

                      <Button
                          variant="outline"
                          disabled={!coreEditMode || loading}
                          onClick={() => {
                            const claimNumber = (coreDetails.claimNumber || "").trim();
                            if (!claimNumber) {
                              setError("Claim Number is required to save invoice details.");
                              return;
                            }
                            setError(null);
                            setLoading(true);
                            saveInvoiceDetails({
                              claimNumber,
                              coreDetails,
                              partsDetails: [],
                              removePartIds: [],
                            })
                              .then((res) => {
                                console.log("Saved invoice core details:", res);
                                setMessage("Core details updated.");
                                setCoreEditMode(false);
                                setCoreSnapshot(null);
                              })
                              .catch((e) => {
                                const err = e as AxiosError<any>;
                                const apiMsg = err?.response?.data?.error;
                                setError(typeof apiMsg === "string" ? apiMsg : "Failed to save invoice details.");
                              })
                              .finally(() => setLoading(false));
                          }}
                        >
                          Update
                        </Button> &nbsp; 
                        <Button onClick={() => setShowValidation(false)}>Cancel</Button> &nbsp; 

                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => {
                            if (!coreEditMode) {
                              setCoreSnapshot(coreDetails);
                              setCoreEditMode(true);
                            } else {
                              if (coreSnapshot) setCoreDetails(coreSnapshot);
                              setCoreEditMode(false);
                              setCoreSnapshot(null);
                            }
                          }}
                          title={coreEditMode ? "Cancel edit" : "Edit"}
                        >
                          {coreEditMode ? (
                            <X className="h-4 w-4" />
                          ) : (
                            <Pencil className="h-4 w-4" />
                          )}
                        </Button>
                      </div>


                      <div className="grid grid-cols-2 gap-3">
                        <div><Label>Claim Number</Label><Input disabled value={coreDetails.claimNumber} /></div>
                        <div><Label>Vehicle Number</Label><Input disabled={!coreEditMode} value={coreDetails.vehicleNumber} onChange={(e) => setCoreDetails((p) => ({ ...p, vehicleNumber: e.target.value }))} /></div>
                        <div><Label>Engine Number</Label><Input disabled={!coreEditMode} value={coreDetails.engineNumber} onChange={(e) => setCoreDetails((p) => ({ ...p, engineNumber: e.target.value }))} /></div>
                        <div><Label>Chassis Number</Label><Input disabled={!coreEditMode} value={coreDetails.chassisNumber} onChange={(e) => setCoreDetails((p) => ({ ...p, chassisNumber: e.target.value }))} /></div>
                        <div><Label>Make</Label><Input disabled={!coreEditMode} value={coreDetails.make} onChange={(e) => setCoreDetails((p) => ({ ...p, make: e.target.value }))} /></div>
                        <div><Label>Model Number</Label><Input disabled={!coreEditMode} value={coreDetails.modelNumber} onChange={(e) => setCoreDetails((p) => ({ ...p, modelNumber: e.target.value }))} /></div>
                        <div><Label>Total</Label><Input disabled={!coreEditMode} value={coreDetails.total} onChange={(e) => setCoreDetails((p) => ({ ...p, total: e.target.value }))} /></div>
                      </div>

                      <div className="rounded-md border">
                        <div className="border-b bg-primary/10 px-3 py-2 text-sm font-semibold">
                          Claim IDIT Details
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Claim Number</TableHead>
                              <TableHead>Vehicle Number</TableHead>
                              <TableHead>Engine Number</TableHead>
                              <TableHead>Chassis Number</TableHead>
                              <TableHead>Make</TableHead>
                              <TableHead>Model</TableHead>
                              <TableHead>Total</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            <TableRow>
                              <TableCell>{coreDetails.claimNumber || "—"}</TableCell>
                              <TableCell>{coreDetails.vehicleNumber || "—"}</TableCell>
                              <TableCell>{coreDetails.engineNumber || "—"}</TableCell>
                              <TableCell>{coreDetails.chassisNumber || "—"}</TableCell>
                              <TableCell>{coreDetails.make || "—"}</TableCell>
                              <TableCell>{coreDetails.modelNumber || "—"}</TableCell>
                              <TableCell>{coreDetails.total || "—"}</TableCell>
                            </TableRow>
                          </TableBody>
                        </Table>
                      </div>

                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          disabled={!coreEditMode || loading}
                          onClick={() => {
                            const claimNumber = (coreDetails.claimNumber || "").trim();
                            if (!claimNumber) {
                              setError("Claim Number is required to save invoice details.");
                              return;
                            }
                            setError(null);
                            setLoading(true);
                            saveInvoiceDetails({
                              claimNumber,
                              coreDetails,
                              partsDetails: [],
                              removePartIds: [],
                            })
                              .then((res) => {
                                console.log("Saved invoice core details:", res);
                                setMessage("Core details updated.");
                                setCoreEditMode(false);
                                setCoreSnapshot(null);
                              })
                              .catch((e) => {
                                const err = e as AxiosError<any>;
                                const apiMsg = err?.response?.data?.error;
                                setError(typeof apiMsg === "string" ? apiMsg : "Failed to save invoice details.");
                              })
                              .finally(() => setLoading(false));
                          }}
                        >
                          Update
                        </Button>
                        <Button onClick={() => setShowValidation(false)}>Cancel</Button>
                      </div>
                    </div>
                  )}

                  {validationTab === "parts" && (
                    <div className="space-y-3">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-1/2">Description</TableHead>
                            <TableHead className="w-1/8">Qty</TableHead>
                            <TableHead className="w-1/6">Unit Price</TableHead>
                            <TableHead className="w-1/4">Amount</TableHead>
                            <TableHead className="text-center">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {partsDetails.map((row) => (
                            <TableRow key={row.id}>
                              <TableCell><Input disabled={!rowEditByLocalId[row.id]} value={row.description} onChange={(e) => setPartsDetails((prev) => prev.map((p) => p.id === row.id ? { ...p, description: e.target.value } : p))} /></TableCell>
                              <TableCell><Input disabled={!rowEditByLocalId[row.id]} value={row.quantity} onChange={(e) => setPartsDetails((prev) => prev.map((p) => p.id === row.id ? { ...p, quantity: e.target.value } : p))} /></TableCell>
                              <TableCell><Input disabled={!rowEditByLocalId[row.id]} value={row.unitPrice} onChange={(e) => setPartsDetails((prev) => prev.map((p) => p.id === row.id ? { ...p, unitPrice: e.target.value } : p))} /></TableCell>
                              <TableCell><Input disabled={!rowEditByLocalId[row.id]} value={row.amount} onChange={(e) => setPartsDetails((prev) => prev.map((p) => p.id === row.id ? { ...p, amount: e.target.value } : p))} /></TableCell>
                              <TableCell className="text-center">
                                <div className="flex items-center justify-center">
                                  {/* <Button
                                    variant="ghost"
                                    size="icon"
                                    disabled={!row.dbId || !!partVerifyByDbId[row.dbId]?.verified || !!partVerifyByDbId[row.dbId]?.loading}
                                    onClick={() => {
                                      const dbId = row.dbId;
                                      if (!dbId) return;
                                      setPartVerifyByDbId((prev) => ({
                                        ...prev,
                                        [dbId]: { verified: false, masterId: null, loading: true },
                                      }));
                                      addPartToMaster(dbId)
                                        .then((res) => {
                                          setPartVerifyByDbId((prev) => ({
                                            ...prev,
                                            [dbId]: { verified: true, masterId: res.master_id, loading: false },
                                          }));
                                        })
                                        .catch(() => {
                                          setPartVerifyByDbId((prev) => ({
                                            ...prev,
                                            [dbId]: { verified: false, masterId: null, loading: false },
                                          }));
                                        });
                                    }}
                                    title={row.dbId && partVerifyByDbId[row.dbId]?.verified ? "Already in Parts Master" : "Add to Parts Master"}
                                  >
                                    {row.dbId && partVerifyByDbId[row.dbId]?.verified ? (
                                      <CircleCheck className="h-5 w-5 text-emerald-600" />
                                    ) : (
                                      <PlusCircle className="h-3 w-3 text-blue-600" />
                                    )}
                                  </Button> */}

                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    disabled={loading || !(coreDetails.claimNumber || "").trim()}
                                    onClick={() => {
                                      const isEditing = !!rowEditByLocalId[row.id];
                                      if (!isEditing) {
                                        setRowSnapshotByLocalId((prev) => ({ ...prev, [row.id]: row }));
                                        setRowEditByLocalId((prev) => ({ ...prev, [row.id]: true }));
                                        return;
                                      }

                                      const claimNumber = (coreDetails.claimNumber || "").trim();
                                      if (!claimNumber) {
                                        setError("Claim Number is required to update part details.");
                                        return;
                                      }
                                      setError(null);
                                      setLoading(true);
                                      saveInvoiceDetails({
                                        claimNumber,
                                        coreDetails,
                                        partsDetails: [
                                          {
                                            id: row.dbId,
                                            description: row.description,
                                            quantity: row.quantity,
                                            unitPrice: row.unitPrice,
                                            amount: row.amount,
                                          },
                                        ],
                                        removePartIds: [],
                                      })
                                        .then(() => {
                                          setRowEditByLocalId((prev) => ({ ...prev, [row.id]: false }));
                                          setRowSnapshotByLocalId((prev) => {
                                            const { [row.id]: _omit, ...rest } = prev;
                                            return rest;
                                          });
                                          setMessage("Part details updated.");
                                        })
                                        .catch((e) => {
                                          const err = e as AxiosError<any>;
                                          const apiMsg = err?.response?.data?.error;
                                          setError(typeof apiMsg === "string" ? apiMsg : "Failed to update part.");
                                        })
                                        .finally(() => setLoading(false));
                                    }}
                                    title={rowEditByLocalId[row.id] ? "Update row" : "Edit row"}
                                  >
                                    {rowEditByLocalId[row.id] ? (
                                      <Check className="h-3 w-3 text-blue-600" />
                                    ) : (
                                      <Pencil className="h-3 w-3 text-blue-600" />
                                    )}
                                  </Button>

                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => {
                                      if (row.dbId) setRemovedPartDbIds((prev) => [...prev, row.dbId!]);
                                      setPartsDetails((prev) => prev.filter((p) => p.id !== row.id));
                                    }}
                                    title="Delete"
                                  >
                                    <Trash2 className="h-4 w-4 text-red-600" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      <Button variant="outline" onClick={() => setPartsDetails((prev) => [...prev, { id: `part-${Date.now()}`, description: "", quantity: "", unitPrice: "", amount: "" }])}>
                        <Plus className="mr-1 h-4 w-4" /> Add Part
                      </Button>
                    </div>
                  )}
                </div>

                {validationTab !== "core" && (
                  <div className="flex justify-end gap-2 border-t p-3">
                    <Button
                      variant="outline"
                      onClick={() => {
                        const claimNumber = (coreDetails.claimNumber || "").trim();
                        if (!claimNumber) {
                          setError("Claim Number is required to save invoice details.");
                          return;
                        }
                        setError(null);
                        setLoading(true);
                        saveInvoiceDetails({
                          claimNumber,
                          coreDetails,
                          partsDetails: partsDetails.map((p) => ({
                            id: p.dbId,
                            description: p.description,
                            quantity: p.quantity,
                            unitPrice: p.unitPrice,
                            amount: p.amount,
                          })),
                          removePartIds: removedPartDbIds,
                        })
                          .then((res) => {
                            setPartsDetails((prev) =>
                              (res.parts || []).map((p, idx) => ({
                                id: prev[idx]?.id ?? `part-${Date.now()}-${idx}`,
                                dbId: p.id,
                                description: p.description ?? "",
                                quantity: p.quantity === null || p.quantity === undefined ? "" : String(p.quantity),
                                unitPrice: p.unitPrice ?? "",
                                amount: p.amount ?? "",
                              }))
                            );
                            setRemovedPartDbIds([]);
                            const claimNumber = (coreDetails.claimNumber || "").trim();
                            if (claimNumber) {
                              verifyInvoiceParts(claimNumber).then((verified) => {
                                const map: Record<number, { verified: boolean; masterId: number | null }> = {};
                                (verified.parts || []).forEach((x) => {
                                  map[x.part_detail_id] = { verified: x.verified, masterId: x.master_id };
                                });
                                setPartVerifyByDbId(map);
                              });
                            }
                            setMessage(`Saved to DB for Claim Number ${res.claim_number} (parts: ${res.parts_saved}). Redirecting...`);
                            navigate("/invoice-history");
                          })
                          .catch((e) => {
                            const err = e as AxiosError<any>;
                            const apiMsg = err?.response?.data?.error;
                            setError(typeof apiMsg === "string" ? apiMsg : "Failed to save invoice details.");
                          })
                          .finally(() => setLoading(false));
                      }}
                    >
                      Update
                    </Button>
                    <Button onClick={() => setShowValidation(false)}>Back</Button>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
    </AppLayout>
  );
}

