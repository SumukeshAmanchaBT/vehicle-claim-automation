import base64
import json
import mimetypes
import os
import re
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from django.conf import settings
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .digitization_s3 import (
    build_digitization_file_url,
    cleanup_temp_path,
    digitization_doc_local_path,
    list_s3_objects,
    s3_object_exists,
    presigned_get_url,
    s3_enabled,
    upload_bytes_to_s3,
    move_s3_object,
    move_s3_prefix,
)
from .models import (
    DigitizationDocument,
    DigitizationExtraction,
    DigitizationPartLine,
    InvoiceCoreDetails,
    InvoicePartDetails,
    PartsMaster,
)


def _parse_json_from_text(text: str) -> dict[str, Any]:
    """
    Extract JSON object from model output (handles markdown code blocks).
    """
    if not text:
        return {}
    text = text.strip()

    # Try direct JSON
    if text.startswith("{") and text.endswith("}"):
        try:
            return json.loads(text)
        except Exception:
            pass

    # Try to extract the first {...} block
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        snippet = text[start : end + 1]
        try:
            return json.loads(snippet)
        except Exception:
            return {}
    return {}


def _to_decimal(value: Any) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, (int, float, Decimal)):
        return Decimal(str(value))
    if isinstance(value, str):
        cleaned = value.strip()
        if cleaned == "":
            return None
        # Remove currency symbols and commas commonly found in invoices
        cleaned = cleaned.replace(",", "")
        for prefix in ("$", "฿", "₹", "€", "£"):
            if cleaned.startswith(prefix):
                cleaned = cleaned[len(prefix) :].strip()
        try:
            return Decimal(cleaned)
        except InvalidOperation:
            return None
    return None


def _openai_extract_invoice_data(image_path: str) -> tuple[dict[str, Any], str | None]:
    """
    Extract invoice/repair parts details from an image using OpenAI Vision.
    Returns: (parsed_json, error_message)
    """
    api_key = os.getenv("OPENAI_API_KEY") or getattr(settings, "OPENAI_API_KEY", None)
    if not api_key or not str(api_key).strip():
        return {}, "OPENAI_API_KEY is not configured"
    if not os.path.isfile(image_path):
        return {}, f"File not found: {image_path}"

    try:
        with open(image_path, "rb") as f:
            image_data = base64.b64encode(f.read()).decode("utf-8")
    except OSError:
        return {}, "Failed to read file bytes"

    ext = Path(image_path).suffix.lower()
    mime = "image/jpeg"
    if ext == ".png":
        mime = "image/png"
    elif ext == ".webp":
        mime = "image/webp"
    elif ext in (".jpg", ".jpeg"):
        mime = "image/jpeg"

    prompt = (
        "You are a claims digitization assistant. "
        "Extract structured data from this repair invoice image.\n\n"
        "Return ONLY valid JSON with this schema:\n"
        "{\n"
        '  "claim_number": string|null,\n'
        '  "vehicle_number": string|null,\n'
        '  "engine_number": string|null,\n'
        '  "chassis_number": string|null,\n'
        '  "make_model": string|null,\n'
        '  "total_amount": number|null,\n'
        '  "parts": [\n'
        "    {\n"
        '      "description": string|null,\n'
        '      "quantity": number|null,\n'
        '      "unit_price": number|null,\n'
        '      "amount": number|null\n'
        "    }\n"
        "  ]\n"
        "}\n\n"
        "Rules:\n"
        "- parts must be the table rows for spare parts (NOT labour summary).\n"
        "- quantity/unit_price/amount must be numbers (no currency symbols). If missing use null.\n"
        "- If a field isn't present, use null.\n"
        "- Be robust to OCR mistakes.\n"
    )

    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        resp = client.chat.completions.create(
            model=os.getenv("OPENAI_VISION_MODEL", "gpt-4o-mini"),
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{mime};base64,{image_data}"},
                        },
                    ],
                }
            ],
            temperature=0,
            max_tokens=800,
        )
        text = (resp.choices[0].message.content or "").strip()
        if not text:
            return {}, "OpenAI returned empty content"
        data = _parse_json_from_text(text)
        return data, None
    except Exception as e:
        return {}, f"OpenAI extraction failed: {e}"


def _extract_text_from_pdf(pdf_path: str) -> tuple[str, str | None]:
    """
    Extract plain text from PDF.
    """
    if not os.path.isfile(pdf_path):
        return "", "PDF file not found"
    try:
        from PyPDF2 import PdfReader
    except Exception:
        return "", "PyPDF2 is not installed. Install with: pip install PyPDF2"

    try:
        reader = PdfReader(pdf_path)
        chunks: list[str] = []
        for page in reader.pages:
            try:
                chunks.append(page.extract_text() or "")
            except Exception:
                continue
        text = "\n".join(chunks).strip()
        if not text:
            return "", "No readable text found in PDF"
        return text, None
    except Exception as e:
        return "", f"Failed to read PDF: {e}"


def _openai_extract_kv_from_text(text: str) -> tuple[dict[str, Any], str | None]:
    """
    Use OpenAI LLM to convert document text into key-value JSON.
    """
    api_key = os.getenv("OPENAI_API_KEY") or getattr(settings, "OPENAI_API_KEY", None)
    if not api_key or not str(api_key).strip():
        # Graceful fallback when OpenAI isn't configured.
        # This keeps the UI usable and still returns key-value JSON.
        kv = _fallback_extract_kv_from_text(text)
        kv["_warning"] = "OPENAI_API_KEY is not configured; used fallback extraction."
        return kv, None
    if not text.strip():
        return {}, "Input text is empty"

    prompt = (
        "You are a claims digitization assistant.\n"
        "Extract important key-value pairs from the following claim document text.\n"
        "Return only valid JSON object.\n\n"
        "Preferred keys when available:\n"
        "claim_number, policy_number, insured_name, vehicle_number, vehicle_name, "
        "policy_type, policy_status, date_of_loss, cause_of_loss, description, claimed_amount, recommendation.\n"
        "If a key is missing, set value as null.\n"
    )
    trimmed = text[:16000]
    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        resp = client.chat.completions.create(
            model=os.getenv("OPENAI_VISION_MODEL", "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": "Return strict JSON only."},
                {"role": "user", "content": f"{prompt}\n\nDOCUMENT TEXT:\n{trimmed}"},
            ],
            temperature=0,
            max_tokens=900,
        )
        content = (resp.choices[0].message.content or "").strip()
        data = _parse_json_from_text(content)
        if not isinstance(data, dict) or not data:
            return {}, "AI response was not valid JSON object"
        return data, None
    except Exception as e:
        # Fallback keeps workflow running even if AI call fails.
        kv = _fallback_extract_kv_from_text(text)
        kv["_warning"] = "OpenAI extraction failed; used fallback extraction."
        return kv, None


def _fallback_extract_kv_from_text(text: str) -> dict[str, Any]:
    """
    Best-effort regex extraction for key-value fields.
    Used only when OPENAI is not configured or when AI fails.
    """
    # Keep all pages' text; only normalize line whitespace.
    cleaned = "\n".join([line.strip() for line in text.splitlines() if line.strip()])

    def _pick(patterns: list[str]) -> str | None:
        for pat in patterns:
            m = __import__("re").search(pat, cleaned, flags=__import__("re").I)
            if m:
                val = (m.group(1) or "").strip()
                if val:
                    return val
        return None

    claim_number = _pick([r"Claim\s*No\.?\s*[:\-]?\s*([A-Z0-9\-\/]+)"])
    policy_number = _pick([r"Policy\s*No\.?\s*[:\-]?\s*([A-Z0-9\-\/]+)"])
    insured_name = _pick([r"Insured\s*Name\s*[:\-]?\s*(.+)"])
    vehicle_number = _pick([
        r"(?:Veh\.?\s*Reg\.?\s*No\.?|Vehicle\s*No\.?|Vehicle\s*Registration\s*No\.?|Vehicle\s*Registration\s*Number)\s*[:\-]?\s*([A-Z0-9\-\/]+)"
    ])
    engine_number = _pick([r"Engine\s*No\.?\s*[:\-]?\s*([A-Z0-9\-\/]+)"])
    chassis_number = _pick([r"Chassis\s*No\.?\s*[:\-]?\s*([A-Z0-9\-\/]+)"])
    make_model = _pick([r"Make\/Model\s*[:\-]?\s*(.+)"])
    policy_type = _pick([r"Policy\s*Type\s*[:\-]?\s*(.+)"])
    policy_status = _pick([r"Policy\s*Status\s*[:\-]?\s*(.+)"])
    date_of_loss = _pick([r"(?:Date\s*of\s*Loss|Accident\s*Date)\s*[:\-]?\s*([0-9]{1,2}[\/-][0-9]{1,2}[\/-][0-9]{2,4})"])
    cause_of_loss = _pick([r"Description\s*[:\-]?\s*(.+)"])

    def _money(pats: list[str]) -> str | None:
        for pat in pats:
            m = __import__("re").search(pat, cleaned, flags=__import__("re").I)
            if m:
                val = (m.group(1) or "").strip()
                if val:
                    return val
        return None

    claimed_amount = _money([r"Claim\s*Amount\s*[:\-]?\s*[$฿₹€£]?\s*([0-9,]+(?:\.[0-9]{2})?)"])
    # Generic key:value extraction across the whole document.
    key_value_pairs: dict[str, str] = {}
    for line in cleaned.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if not key or not value:
            continue
        normalized_key = (
            key.lower()
            .replace(".", "")
            .replace("/", "_")
            .replace("-", "_")
            .replace(" ", "_")
        )
        if normalized_key not in key_value_pairs:
            key_value_pairs[normalized_key] = value

    # Parse 2-column table rows often extracted as alternating lines:
    #   <key>
    #   <value>
    lines = [ln.strip() for ln in cleaned.splitlines() if ln.strip()]
    header_tokens = {
        "field", "value", "status", "description",
        "policy coverage review", "documents submitted review",
        "business rule validation", "damage assessment", "final recommendation",
    }

    def _norm_label(label: str) -> str:
        return (
            label.lower()
            .replace(".", "")
            .replace("/", "_")
            .replace("-", "_")
            .replace(" ", "_")
            .replace("(", "")
            .replace(")", "")
            .strip("_")
        )

    def _is_potential_key(label: str) -> bool:
        ll = label.lower().strip()
        if not ll or ll in header_tokens:
            return False
        hints = (
            "claim", "policy", "insured", "vehicle", "date", "cause", "description",
            "amount", "recommendation", "status", "indicator", "score", "type",
            "period", "loss", "driver", "evidence", "injury", "escalation",
        )
        return any(h in ll for h in hints)

    for idx in range(len(lines) - 1):
        raw_k = lines[idx]
        raw_v = lines[idx + 1]
        if ":" in raw_k:
            continue  # already captured by direct key:value parser
        if not _is_potential_key(raw_k):
            continue
        if len(raw_v) > 260:
            continue
        nk = _norm_label(raw_k)
        if not nk or nk in header_tokens:
            continue
        if nk not in key_value_pairs:
            key_value_pairs[nk] = raw_v

    def _first(*keys: str) -> str | None:
        for k in keys:
            v = key_value_pairs.get(k)
            if v:
                return v
        return None

    base = {
        "claim_number": claim_number or _first("claim_no", "claim_number"),
        "policy_number": policy_number or _first("policy_no", "policy_number"),
        "insured_name": insured_name or _first("insured_name"),
        "vehicle_number": vehicle_number or _first("vehicle_no", "vehicle_number", "veh_reg_no"),
        "vehicle_name": _first("vehicle_name", "make_model", "make__model"),
        "engine_number": engine_number or _first("engine_no", "engine_number"),
        "chassis_number": chassis_number or _first("chassis_no", "chassis_number"),
        "make_model": make_model or _first("make_model"),
        "policy_type": policy_type or _first("policy_type"),
        "policy_status": policy_status or _first("policy_status"),
        "date_of_loss": date_of_loss or _first("date_of_loss", "accident_date"),
        "cause_of_loss": cause_of_loss or _first("cause_of_loss"),
        "description": _first("description", "incident_description"),
        "claimed_amount": claimed_amount or _first("claimed_amount", "claim_amount"),
        "recommendation": _first("recommendation"),
    }

    # Add any additional parsed key-values directly at top-level (flattened),
    # while preserving preferred canonical keys above.
    for k, v in key_value_pairs.items():
        if k not in base:
            base[k] = v

    return base


def _extract_and_persist(document: DigitizationDocument) -> dict[str, Any]:
    """
    Runs extraction for a single document and saves header + parts to DB.
    """
    # Only images are supported for now (for reliable vision extraction).
    ext = Path(document.file.name).suffix.lower()
    if ext not in (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"):
        return {"status": "failed", "error": f"Unsupported file type for extraction: {ext}"}

    tmp_path = None
    needs_cleanup = False
    try:
        tmp_path, needs_cleanup = digitization_doc_local_path(document)
        image_path = str(tmp_path)
    except ValueError as e:
        return {"status": "failed", "error": str(e)}
    except Exception as e:
        return {"status": "failed", "error": f"Cannot access file for extraction: {e}"}

    try:
        parsed, error = _openai_extract_invoice_data(image_path)
        extraction, _created = DigitizationExtraction.objects.get_or_create(document=document)

        # Remove existing parts so re-extract is idempotent for the latest run.
        DigitizationPartLine.objects.filter(extraction=extraction).delete()

        if error:
            extraction.status = DigitizationExtraction.STATUS_FAILED
            extraction.error_message = error
            extraction.extracted_json = json.dumps(parsed or {}, default=str)
            extraction.save(update_fields=["status", "error_message", "extracted_json", "updated_date"])
            return {"status": "failed", "error": error}

        # Best-effort parsing for numeric fields
        parts_in = parsed.get("parts") if isinstance(parsed, dict) else None
        if not isinstance(parts_in, list):
            parts_in = []

        extraction.status = DigitizationExtraction.STATUS_COMPLETED
        extraction.error_message = None
        extraction.extracted_json = json.dumps(parsed, default=str)
        extraction.claim_number = parsed.get("claim_number")
        extraction.vehicle_number = parsed.get("vehicle_number")
        extraction.engine_number = parsed.get("engine_number")
        extraction.chassis_number = parsed.get("chassis_number")
        extraction.make_model = parsed.get("make_model")
        extraction.total_amount = _to_decimal(parsed.get("total_amount"))
        extraction.save()

        part_rows: list[DigitizationPartLine] = []
        for idx, p in enumerate(parts_in):
            if not isinstance(p, dict):
                continue
            part_rows.append(
                DigitizationPartLine(
                    extraction=extraction,
                    line_index=idx,
                    description=str(p.get("description") or "").strip(),
                    quantity=_to_decimal(p.get("quantity")),
                    unit_price=_to_decimal(p.get("unit_price")),
                    amount=_to_decimal(p.get("amount")),
                )
            )

        if part_rows:
            DigitizationPartLine.objects.bulk_create(part_rows)

        return {"status": "completed", "parts_count": len(part_rows)}
    finally:
        cleanup_temp_path(tmp_path, needs_cleanup)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def digitization_upload(request):
    """
    Screen 1: Upload claim documents (creates DigitizationDocument rows).
    Expects multipart/form-data:
      - complaint_id: string
      - files: one or more files
    """
    complaint_id = request.data.get("complaint_id")
    if not complaint_id:
        return Response({"error": "complaint_id is required"}, status=status.HTTP_400_BAD_REQUEST)

    files = request.FILES.getlist("files")
    if not files:
        return Response({"error": "files is required"}, status=status.HTTP_400_BAD_REQUEST)

    documents_out = []
    for f in files:
        doc = DigitizationDocument.objects.create(
            complaint_id=str(complaint_id),
            original_filename=getattr(f, "name", "") or "",
            file=f,
        )
        file_url = build_digitization_file_url(request, doc)
        documents_out.append(
            {
                "id": doc.id,
                "complaint_id": doc.complaint_id,
                "original_filename": doc.original_filename,
                "file_url": file_url,
                "document_category": doc.document_category,
                "document_type": doc.document_type,
                "created_date": doc.created_date,
            }
        )

    return Response({"documents": documents_out}, status=status.HTTP_201_CREATED)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def digitization_classify(request):
    """
    Screen 2: Update classification for a single document.
    Body:
      - document_id: number
      - document_category: "repair" | "other" | "unclassified"
      - document_type: string
    """
    document_id = request.data.get("document_id")
    if not document_id:
        return Response({"error": "document_id is required"}, status=status.HTTP_400_BAD_REQUEST)

    category = request.data.get("document_category") or DigitizationDocument.DOCUMENT_CATEGORY_UNCLASSIFIED
    doc_type = request.data.get("document_type") or ""

    doc = get_object_or_404(DigitizationDocument, id=document_id)
    valid_categories = {c[0] for c in DigitizationDocument.DOCUMENT_CATEGORY_CHOICES}
    if category not in valid_categories:
        return Response({"error": "Invalid document_category"}, status=status.HTTP_400_BAD_REQUEST)

    doc.document_category = category
    doc.document_type = str(doc_type).strip()[:100]
    doc.save(update_fields=["document_category", "document_type"])

    file_url = build_digitization_file_url(request, doc)
    return Response(
        {
            "id": doc.id,
            "complaint_id": doc.complaint_id,
            "original_filename": doc.original_filename,
            "file_url": file_url,
            "document_category": doc.document_category,
            "document_type": doc.document_type,
        },
        status=status.HTTP_200_OK,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def digitization_extract(request):
    """
    Screen 3: Extract + persist digitized data.
    Body:
      - complaint_id: string
      - document_ids: optional list of document ids (if omitted, extracts all for complaint_id)
    """
    complaint_id = request.data.get("complaint_id")
    if not complaint_id:
        return Response({"error": "complaint_id is required"}, status=status.HTTP_400_BAD_REQUEST)

    document_ids = request.data.get("document_ids")
    if document_ids and not isinstance(document_ids, list):
        return Response({"error": "document_ids must be a list"}, status=status.HTTP_400_BAD_REQUEST)

    qs = DigitizationDocument.objects.filter(complaint_id=str(complaint_id)).order_by("created_date")
    if document_ids:
        qs = qs.filter(id__in=document_ids)

    results = []
    for doc in qs:
        results.append(
            {
                "document_id": doc.id,
                **_extract_and_persist(doc),
            }
        )

    return Response({"results": results}, status=status.HTTP_200_OK)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def digitization_list_extractions(request):
    """
    Screen 4: List uploaded documents + extracted header/parts for a complaint.
    Query:
      - complaint_id
    """
    complaint_id = request.query_params.get("complaint_id")
    if not complaint_id:
        return Response({"error": "complaint_id is required"}, status=status.HTTP_400_BAD_REQUEST)

    docs = DigitizationDocument.objects.filter(complaint_id=str(complaint_id)).order_by("created_date")
    out = []

    for doc in docs:
        extraction = getattr(doc, "extraction", None)
        parts = []
        if extraction:
            for p in extraction.parts.all().order_by("line_index"):
                parts.append(
                    {
                        "description": p.description,
                        "quantity": str(p.quantity) if p.quantity is not None else None,
                        "unit_price": str(p.unit_price) if p.unit_price is not None else None,
                        "amount": str(p.amount) if p.amount is not None else None,
                        "line_index": p.line_index,
                    }
                )

        file_url = build_digitization_file_url(request, doc)
        out.append(
            {
                "document_id": doc.id,
                "original_filename": doc.original_filename,
                "file_url": file_url,
                "document_category": doc.document_category,
                "document_type": doc.document_type,
                "extraction": extraction
                and {
                    "status": extraction.status,
                    "error_message": extraction.error_message,
                    "claim_number": extraction.claim_number,
                    "vehicle_number": extraction.vehicle_number,
                    "engine_number": extraction.engine_number,
                    "chassis_number": extraction.chassis_number,
                    "make_model": extraction.make_model,
                    "total_amount": str(extraction.total_amount) if extraction.total_amount is not None else None,
                    "parts": parts,
                },
            }
        )

    return Response({"documents": out}, status=status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def digitization_extract_kv(request):
    """
    Read selected document and extract key-value JSON using AI.
    Supports:
      - PDF: text extraction -> LLM -> JSON (+ fallback merge)
      - Images: vision extraction -> JSON
    Body:
      - document_id: number
    """
    document_id = request.data.get("document_id")
    if not document_id:
        return Response({"error": "document_id is required"}, status=status.HTTP_400_BAD_REQUEST)

    doc = get_object_or_404(DigitizationDocument, id=document_id)
    tmp_path = None
    needs_cleanup = False

    try:
        # For S3-backed files we may need to download to a temp file for extraction.
        tmp_path, needs_cleanup = digitization_doc_local_path(doc)
        file_path = str(tmp_path)

        ext = Path(doc.original_filename or doc.file.name).suffix.lower()
        kv_json: dict[str, Any] = {}

        image_exts = (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff")
        if ext in image_exts:
            kv_json, ai_error = _openai_extract_invoice_data(file_path)
            if ai_error:
                return Response({"error": ai_error}, status=status.HTTP_400_BAD_REQUEST)
        elif ext == ".pdf":
            text, text_error = _extract_text_from_pdf(file_path)
            if text_error:
                return Response({"error": text_error}, status=status.HTTP_400_BAD_REQUEST)

            fallback_kv = _fallback_extract_kv_from_text(text)
            kv_json, ai_error = _openai_extract_kv_from_text(text)
            if ai_error:
                return Response({"error": ai_error}, status=status.HTTP_400_BAD_REQUEST)

            # Ensure broader PDF fields are present in RawData even if AI returned
            # only a small canonical subset.
            if isinstance(kv_json, dict):
                for k, v in fallback_kv.items():
                    if k not in kv_json or kv_json.get(k) in (None, "", "null"):
                        kv_json[k] = v
        else:
            return Response(
                {"error": f"Unsupported file type for key-value extraction: {ext}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Persist extraction so history edit can locate the source document later.
        # Best-effort only: keep the endpoint functional even if persistence fails.
        try:
            extraction, _created = DigitizationExtraction.objects.get_or_create(document=doc)
            extraction.status = DigitizationExtraction.STATUS_COMPLETED
            extraction.error_message = None
            extraction.extracted_json = json.dumps(kv_json or {}, default=str)

            if isinstance(kv_json, dict):
                extraction.claim_number = str(kv_json.get("claim_number") or "").strip() or None
                extraction.vehicle_number = str(kv_json.get("vehicle_number") or "").strip() or None
                extraction.engine_number = str(kv_json.get("engine_number") or "").strip() or None
                extraction.chassis_number = str(kv_json.get("chassis_number") or "").strip() or None
                extraction.make_model = (
                    str(kv_json.get("make_model") or kv_json.get("vehicle_name") or "").strip()
                    or None
                )
                extraction.total_amount = _to_decimal(
                    kv_json.get("total_amount")
                    or kv_json.get("claimed_amount")
                    or kv_json.get("claim_amount")
                )

                # Persist parts lines for completeness
                DigitizationPartLine.objects.filter(extraction=extraction).delete()
                parts_in = kv_json.get("parts")
                if isinstance(parts_in, list):
                    part_rows: list[DigitizationPartLine] = []
                    for idx, p in enumerate(parts_in):
                        if not isinstance(p, dict):
                            continue
                        part_rows.append(
                            DigitizationPartLine(
                                extraction=extraction,
                                line_index=idx,
                                description=str(p.get("description") or "").strip(),
                                quantity=_to_decimal(p.get("quantity")),
                                unit_price=_to_decimal(p.get("unit_price")),
                                amount=_to_decimal(p.get("amount")),
                            )
                        )
                    if part_rows:
                        DigitizationPartLine.objects.bulk_create(part_rows)

            extraction.save()
        except Exception:
            pass

        return Response(
            {
                "document_id": doc.id,
                "filename": doc.original_filename,
                "key_value_json": kv_json,
            },
            status=status.HTTP_200_OK,
        )
    except ValueError as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as e:
        return Response({"error": f"Cannot access file: {e}"}, status=status.HTTP_400_BAD_REQUEST)
    finally:
        cleanup_temp_path(tmp_path, needs_cleanup)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def digitization_save_classified_local(request):
    """
    Save selected document to local folder with classification suffix:
      *_repair.ext or *_other.ext

    multipart/form-data:
      - file: uploaded file
      - document_category: repair | other
      - original_filename: optional
    """
    uploaded_file = request.FILES.get("file")
    if not uploaded_file:
        return Response({"error": "file is required"}, status=status.HTTP_400_BAD_REQUEST)

    category = (request.data.get("document_category") or "").strip().lower()
    if category not in ("repair", "other"):
        return Response(
            {"error": "document_category must be 'repair' or 'other'"},
            status=status.HTTP_400_BAD_REQUEST,
        )

    incoming_name = (request.data.get("original_filename") or uploaded_file.name or "").strip()
    if not incoming_name:
        incoming_name = "document"

    # Build safe renamed file: <name>_repair.ext or <name>_other.ext
    p = Path(incoming_name)
    ext = p.suffix if p.suffix else ""
    stem = p.stem if p.stem else "document"
    stem = re.sub(r"_(repair|other)$", "", stem, flags=re.I)  # avoid repeated suffixes
    suffix = "repair" if category == "repair" else "other"
    renamed_filename = f"{stem}_{suffix}{ext}"
    safe_name = Path(renamed_filename).name
    complaint_id = (request.data.get("complaint_id") or "").strip()
    if not complaint_id:
        complaint_id = "unknown"

    if s3_enabled():
        body = b"".join(chunk for chunk in uploaded_file.chunks())
        ctype, _ = mimetypes.guess_type(safe_name)
        object_key = f"digitization/classified/{complaint_id}/{safe_name}"
        try:
            upload_bytes_to_s3(
                object_key,
                body,
                content_type=ctype or "application/octet-stream",
            )
        except RuntimeError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        bucket = getattr(settings, "AWS_STORAGE_BUCKET_NAME", "")
        file_url = presigned_get_url(object_key) or ""
        return Response(
            {
                "renamed_filename": renamed_filename,
                "saved_path": f"s3://{bucket}/{object_key}",
                "saved_s3_key": object_key,
                "file_url": file_url,
                "document_category": category,
            },
            status=status.HTTP_200_OK,
        )

    target_dir = Path(r"D:\vehicle_automation_project\invoice_documents")
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / safe_name

    with open(target_path, "wb+") as destination:
        for chunk in uploaded_file.chunks():
            destination.write(chunk)

    return Response(
        {
            "renamed_filename": renamed_filename,
            "saved_path": str(target_path),
            "document_category": category,
        },
        status=status.HTTP_200_OK,
    )


def _to_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, (float, Decimal)):
        try:
            return int(value)
        except Exception:
            return None
    if isinstance(value, str):
        s = value.strip()
        if s == "":
            return None
        s = re.sub(r"[^\d\-]", "", s)
        if s in ("", "-"):
            return None
        try:
            return int(s)
        except Exception:
            return None
    return None


def _normalize_part_name(value: Any) -> str:
    s = str(value or "").strip()
    s = re.sub(r"\s+", " ", s)
    return s


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def digitization_verify_parts(request):
    """
    Verify transaction parts against parts_master for a claim.
    Body:
      - claim_number: string (required)
    """
    claim_number = (request.data.get("claim_number") or "").strip()
    if not claim_number:
        return Response({"error": "claim_number is required"}, status=status.HTTP_400_BAD_REQUEST)

    parts = list(InvoicePartDetails.objects.filter(claim_number_id=claim_number).only("id", "description"))
    out: list[dict[str, Any]] = []
    for p in parts:
        name = _normalize_part_name(p.description)
        master = None
        if name:
            master = PartsMaster.objects.filter(part_name__iexact=name).only("id").first()
        out.append(
            {
                "part_detail_id": p.id,
                "part_name": name,
                "verified": bool(master),
                "master_id": master.id if master else None,
            }
        )
    return Response({"parts": out}, status=status.HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def digitization_add_part_to_master(request):
    """
    Add a missing part from vehicle_invoice_part_details into parts_master.
    Body:
      - part_detail_id: int (required)
    """
    part_detail_id = _to_int(request.data.get("part_detail_id"))
    if not part_detail_id:
        return Response({"error": "part_detail_id is required"}, status=status.HTTP_400_BAD_REQUEST)

    user_id = getattr(getattr(request, "user", None), "id", None)
    part = get_object_or_404(InvoicePartDetails, id=part_detail_id)
    name = _normalize_part_name(part.description)
    if not name:
        return Response({"error": "part_name is empty"}, status=status.HTTP_400_BAD_REQUEST)

    obj, created = PartsMaster.objects.get_or_create(
        part_name=name,
        defaults={
            "created_by": user_id,
            "updated_by": user_id,
        },
    )
    if not created and user_id is not None:
        PartsMaster.objects.filter(id=obj.id).update(updated_by=user_id)

    # Touch transaction row audit fields to reflect verification action
    if user_id is not None:
        InvoicePartDetails.objects.filter(id=part_detail_id).update(updated_by=user_id)

    return Response(
        {
            "part_detail_id": part_detail_id,
            "part_name": name,
            "verified": True,
            "master_id": obj.id,
            "created_in_master": created,
        },
        status=status.HTTP_200_OK,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def digitization_save_invoice_details(request):
    """
    Persist validated invoice data into MySQL tables:
      - vehicle_invoice_details (upsert by claim_number)
      - vehicle_invoice_part_details (update existing rows by id, insert new rows,
        delete only explicitly removed rows)

    Body (JSON):
      - claim_number: string (required)
      - core_details: {
          claimNumber, vehicleNumber, engineNumber, chassisNumber, make, modelNumber, total
        }
      - parts_details: [{ id?, description, quantity, unitPrice, amount }]
      - remove_part_ids: optional list[int] (explicit deletions)
    """
    claim_number = (request.data.get("claim_number") or "").strip()
    if not claim_number:
        return Response({"error": "claim_number is required"}, status=status.HTTP_400_BAD_REQUEST)

    core = request.data.get("core_details") or {}
    parts = request.data.get("parts_details") or []
    remove_part_ids = request.data.get("remove_part_ids") or []
    source_document_id = _to_int(request.data.get("source_document_id"))
    if not isinstance(core, dict):
        return Response({"error": "core_details must be an object"}, status=status.HTTP_400_BAD_REQUEST)
    if not isinstance(parts, list):
        return Response({"error": "parts_details must be a list"}, status=status.HTTP_400_BAD_REQUEST)
    if remove_part_ids and not isinstance(remove_part_ids, list):
        return Response({"error": "remove_part_ids must be a list"}, status=status.HTTP_400_BAD_REQUEST)

    user_id = getattr(getattr(request, "user", None), "id", None)
    amount = _to_decimal(core.get("total"))

    from django.db import transaction

    # Normalize parts_details into a list[dict] BEFORE entering the transaction.
    # This prevents DRF/serialization quirks (list of strings, ReturnDict, etc.) from skipping inserts.
    def _coerce_part_item(item: Any) -> dict[str, Any] | None:
        """
        Coerce a single parts_details item into a plain dict.
        Handles:
        - dict / mapping-like objects
        - list/tuple of (k,v) pairs
        - JSON string
        - python-literal strings like \"({'description': ...})\" (note the parentheses + single quotes)
        """
        if item is None:
            return None
        if isinstance(item, dict):
            return item
        if isinstance(item, (list, tuple)) and all(isinstance(x, (list, tuple)) and len(x) == 2 for x in item):
            return dict(item)

        if isinstance(item, str):
            s = item.strip()
            # unwrap redundant outer parentheses sometimes produced by stringified python literals
            for _ in range(3):
                if len(s) >= 2 and s[0] == "(" and s[-1] == ")":
                    s = s[1:-1].strip()
                else:
                    break
            # First attempt: JSON
            try:
                import json as _json

                parsed = _json.loads(s)
            except Exception:
                parsed = None
            # Second attempt: python literal (single quotes)
            if parsed is None:
                try:
                    import ast as _ast

                    parsed = _ast.literal_eval(s)
                except Exception:
                    parsed = None
            # Unwrap single-item tuple/list like ({...},)
            if isinstance(parsed, (list, tuple)) and len(parsed) == 1 and isinstance(parsed[0], dict):
                parsed = parsed[0]
            if isinstance(parsed, dict):
                return parsed
            return None

        # Last resort for mapping-like objects
        try:
            return dict(item)  # type: ignore[arg-type]
        except Exception:
            return None

    normalized_parts: list[dict[str, Any]] = []
    if isinstance(parts, list):
        for item in parts:
            try:
                coerced = _coerce_part_item(item)
                if coerced is None:
                    continue
                normalized_parts.append(coerced)
            except Exception:
                continue
    parts = normalized_parts

    with transaction.atomic():
        obj, created = InvoiceCoreDetails.objects.update_or_create(
            claim_number=claim_number,
            defaults={
                "vehicle_number": (core.get("vehicleNumber") or "")[:50] or None,
                "engine_number": (core.get("engineNumber") or "")[:50] or None,
                "chassis_number": (core.get("chassisNumber") or "")[:100] or None,
                "make": (core.get("make") or "")[:50] or None,
                "model_number": (core.get("modelNumber") or "")[:50] or None,
                "amount": amount,
                "updated_by": user_id,
            },
        )
        if created and user_id is not None:
            InvoiceCoreDetails.objects.filter(claim_number=claim_number).update(created_by=user_id)

        # Link invoice -> uploaded source document (for history edit file viewer).
        # This makes the association deterministic even if AI extracted claim_number was missing.
        if source_document_id:
            try:
                src_doc = DigitizationDocument.objects.get(id=source_document_id)
                prev_complaint_id = str(src_doc.complaint_id or "").strip()
                extraction, _created = DigitizationExtraction.objects.get_or_create(document=src_doc)
                extraction.claim_number = claim_number
                if extraction.status == DigitizationExtraction.STATUS_PENDING:
                    extraction.status = DigitizationExtraction.STATUS_COMPLETED
                extraction.error_message = None
                extraction.save(update_fields=["claim_number", "status", "error_message", "updated_date"])

                # IMPORTANT: Use extracted claim_number as the canonical folder/key in S3.
                # If the file was uploaded under a temporary/session complaint_id (e.g. DIGI-...),
                # move it under digitization/<CLAIM_NUMBER>/... and update the DB key.
                if s3_enabled():
                    try:
                        # Move ALL objects for this session complaint id (including classified copies),
                        # so the DIGI-... folder disappears once we know the real claim number.
                        if prev_complaint_id and prev_complaint_id != claim_number:
                            move_s3_prefix(
                                f"digitization/{prev_complaint_id}/",
                                f"digitization/{claim_number}/",
                            )
                            move_s3_prefix(
                                f"digitization/classified/{prev_complaint_id}/",
                                f"digitization/classified/{claim_number}/",
                            )

                        current_key = str(getattr(src_doc.file, "name", "") or "")
                        new_key = current_key
                        # Expected formats:
                        # - digitization/<TEMP>/<filename>
                        # - digitization/classified/<TEMP>/<filename>
                        key_parts = current_key.split("/")
                        if len(key_parts) >= 3 and key_parts[0] == "digitization":
                            if key_parts[1] == "classified" and len(key_parts) >= 4:
                                # digitization/classified/<id>/...
                                key_parts[2] = claim_number
                                new_key = "/".join(key_parts)
                            else:
                                # digitization/<id>/...
                                key_parts[1] = claim_number
                                new_key = "/".join(key_parts)
                        if new_key and new_key != current_key:
                            move_s3_object(current_key, new_key)
                            src_doc.file.name = new_key
                    except Exception:
                        # Non-fatal: invoice save should still succeed.
                        pass

                # Also align complaint_id in DB to claim_number so subsequent listing uses real ID.
                if src_doc.complaint_id != claim_number:
                    src_doc.complaint_id = claim_number
                src_doc.save(update_fields=["complaint_id", "file"])

                # Update ALL docs that were uploaded under the session complaint id
                # so UI/history reads the real claim number everywhere.
                if prev_complaint_id and prev_complaint_id != claim_number:
                    try:
                        for d in DigitizationDocument.objects.filter(complaint_id=prev_complaint_id).only("id", "file"):
                            key = str(getattr(d.file, "name", "") or "")
                            if key.startswith(f"digitization/{prev_complaint_id}/"):
                                d.file.name = key.replace(
                                    f"digitization/{prev_complaint_id}/",
                                    f"digitization/{claim_number}/",
                                    1,
                                )
                            elif key.startswith(f"digitization/classified/{prev_complaint_id}/"):
                                d.file.name = key.replace(
                                    f"digitization/classified/{prev_complaint_id}/",
                                    f"digitization/classified/{claim_number}/",
                                    1,
                                )
                            d.complaint_id = claim_number
                            d.save(update_fields=["complaint_id", "file"])
                    except Exception:
                        pass
            except Exception:
                # Non-fatal: invoice save should still succeed.
                pass

        # Delete only explicitly removed rows
        removed_ids_int = [_to_int(x) for x in remove_part_ids]
        removed_ids_int = [x for x in removed_ids_int if x is not None]
        if removed_ids_int:
            InvoicePartDetails.objects.filter(
                claim_number_id=claim_number, id__in=removed_ids_int
            ).delete()

        # Upsert parts: update by id when provided, else create new
        saved_ids: list[int] = []
        # Build an index of existing rows to avoid inserting duplicates.
        existing_rows = list(
            InvoicePartDetails.objects.filter(claim_number_id=claim_number).only(
                "id", "description", "quantity", "unit_price", "amount"
            )
        )
        existing_by_signature: dict[tuple[str, int | None, str | None, str | None], int] = {}
        for r in existing_rows:
            desc_norm = (r.description or "").strip().lower()
            qty = r.quantity
            unit_price = str(r.unit_price) if r.unit_price is not None else None
            amt = str(r.amount) if r.amount is not None else None
            existing_by_signature[(desc_norm, qty, unit_price, amt)] = r.id

        # Also de-dupe within the incoming payload itself
        seen_incoming: set[tuple[str, int | None, str | None, str | None]] = set()

        for p in parts:
            # parts are normalized to dicts before transaction, but keep a final safety check
            if not isinstance(p, dict):
                continue
            try:
                incoming_id = _to_int(p.get("id"))
                desc_raw = (p.get("description") or "")
                desc_norm = str(desc_raw).strip()
                if desc_norm == "":
                    continue
                qty_int = _to_int(p.get("quantity"))
                unit_dec = _to_decimal(p.get("unitPrice"))
                amt_dec = _to_decimal(p.get("amount"))
                sig = (
                    desc_norm.lower(),
                    qty_int,
                    str(unit_dec) if unit_dec is not None else None,
                    str(amt_dec) if amt_dec is not None else None,
                )
                if sig in seen_incoming:
                    continue
                seen_incoming.add(sig)
            except Exception:
                continue

            # If no id provided, try to match an existing row by signature to avoid duplicates.
            if incoming_id is None and sig in existing_by_signature:
                incoming_id = existing_by_signature[sig]

            defaults = {
                "description": desc_norm[:255] or None,
                "quantity": qty_int,
                "unit_price": unit_dec,
                "amount": amt_dec,
                "updated_by": user_id,
            }

            if incoming_id is not None:
                updated_count = InvoicePartDetails.objects.filter(
                    claim_number_id=claim_number, id=incoming_id
                ).update(**defaults)
                if updated_count:
                    saved_ids.append(incoming_id)
                    existing_by_signature[sig] = incoming_id
                    continue

            # Explicitly set the FK column value. This is more robust for managed=False
            # tables where FK object assignment can behave unexpectedly with existing schemas.
            try:
                created_obj = InvoicePartDetails.objects.create(
                    claim_number_id=claim_number,
                    created_by=user_id,
                    **defaults,
                )
                saved_ids.append(created_obj.id)
                existing_by_signature[sig] = created_obj.id
            except Exception:
                continue

        # Return current parts for UI to keep DB ids
        parts_out: list[dict[str, Any]] = []
        for row in InvoicePartDetails.objects.filter(claim_number_id=claim_number).order_by("id"):
            parts_out.append(
                {
                    "id": row.id,
                    "description": row.description,
                    "quantity": row.quantity,
                    "unitPrice": str(row.unit_price) if row.unit_price is not None else "",
                    "amount": str(row.amount) if row.amount is not None else "",
                }
            )

    return Response(
        {
            "message": "Invoice details saved",
            "claim_number": claim_number,
            "parts_saved": len(saved_ids),
            "parts": parts_out,
        },
        status=status.HTTP_200_OK,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def invoice_history_list(request):
    """
    Invoice History: list invoice_core_details rows (optionally filtered).
    Query:
      - q: optional search across claim_number / vehicle_number / engine_number / chassis_number / make / model_number
    """
    q = (request.query_params.get("q") or "").strip()

    qs = InvoiceCoreDetails.objects.all().order_by("-created_date")
    if q:
        from django.db.models import Q

        qs = qs.filter(
            Q(claim_number__icontains=q)
            | Q(vehicle_number__icontains=q)
            | Q(engine_number__icontains=q)
            | Q(chassis_number__icontains=q)
            | Q(make__icontains=q)
            | Q(model_number__icontains=q)
        )

    items: list[dict[str, Any]] = []
    for row in qs[:200]:
        items.append(
            {
                "claim_number": row.claim_number,
                "vehicle_number": row.vehicle_number,
                "engine_number": row.engine_number,
                "chassis_number": row.chassis_number,
                "make": row.make,
                "model_number": row.model_number,
                "amount": str(row.amount) if row.amount is not None else None,
                "created_date": row.created_date,
                "updated_date": row.updated_date,
            }
        )

    return Response({"items": items}, status=status.HTTP_200_OK)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def invoice_history_detail(request, claim_number: str):
    """
    Invoice History: get one invoice_core_details + its invoice_part_details.
    """
    claim_number = (claim_number or "").strip()
    if not claim_number:
        return Response({"error": "claim_number is required"}, status=status.HTTP_400_BAD_REQUEST)

    core = get_object_or_404(InvoiceCoreDetails, claim_number=claim_number)
    parts_qs = InvoicePartDetails.objects.filter(claim_number_id=claim_number).order_by("id")
    parts: list[dict[str, Any]] = []
    for p in parts_qs:
        parts.append(
            {
                "id": p.id,
                "description": p.description,
                "quantity": p.quantity,
                "unit_price": str(p.unit_price) if p.unit_price is not None else None,
                "amount": str(p.amount) if p.amount is not None else None,
            }
        )

    # Best-effort: link this invoice back to its original uploaded source document.
    # We can do this via DigitizationExtraction.claim_number -> DigitizationDocument.file.
    document_info: dict[str, Any] = {
        "file_url": "",
        "original_filename": "",
    }
    def _heal_stale_s3_key(doc: DigitizationDocument) -> DigitizationDocument:
        """
        If DB still contains an old DIGI-... key but the file was moved to MC...,
        detect the new key (head_object) and update DB so edit-from-history loads.
        """
        if not s3_enabled():
            return doc
        try:
            current_key = str(getattr(doc.file, "name", "") or "")
            if not current_key or "digitization/" not in current_key:
                return doc
            # Only attempt if key contains DIGI- and we have an MC claim_number
            if "DIGI-" not in current_key or not claim_number:
                return doc

            parts = current_key.split("/")
            if len(parts) < 3 or parts[0] != "digitization":
                return doc

            candidate = current_key
            if parts[1] == "classified" and len(parts) >= 4:
                parts[2] = claim_number
                candidate = "/".join(parts)
            else:
                parts[1] = claim_number
                candidate = "/".join(parts)

            if candidate != current_key and s3_object_exists(candidate):
                doc.file.name = candidate
                if doc.complaint_id != claim_number:
                    doc.complaint_id = claim_number
                doc.save(update_fields=["complaint_id", "file"])
        except Exception:
            return doc
        return doc

    def _set_document_info_from_doc(doc: DigitizationDocument) -> None:
        """
        Populate document_info with a working URL (prefer presigned S3 when enabled).
        """
        try:
            document_info["original_filename"] = getattr(doc, "original_filename", "") or getattr(
                doc.file, "name", ""
            ).split("/")[-1]
        except Exception:
            document_info["original_filename"] = ""

        # Try the existing helper first
        try:
            document_info["file_url"] = build_digitization_file_url(request, doc) or ""
        except Exception:
            document_info["file_url"] = ""

        # If S3 is enabled but storage URL isn't directly usable, fall back to presign from key
        if not document_info.get("file_url") and s3_enabled():
            try:
                key = str(getattr(doc.file, "name", "") or "")
                document_info["file_url"] = presigned_get_url(key) or ""
            except Exception:
                pass

    try:
        extraction = (
            DigitizationExtraction.objects.filter(claim_number__iexact=claim_number)
            .order_by("-updated_date")
            .select_related("document")
            .first()
        )
        if not extraction:
            # Fallback: try a best-effort search in extracted_json for older data.
            extraction = (
                DigitizationExtraction.objects.filter(extracted_json__icontains=claim_number)
                .order_by("-updated_date")
                .select_related("document")
                .first()
            )
        if extraction and getattr(extraction, "document", None):
            doc = _heal_stale_s3_key(extraction.document)
            _set_document_info_from_doc(doc)
    except Exception:
        # If linkage fails, we still return core + parts.
        pass

    # Fallback: for records where extraction linkage is missing, we still store DigitizationDocument
    # complaint_id as the extracted claim_number (see save-invoice-details). Use that to locate the file.
    if not document_info.get("file_url"):
        try:
            doc = (
                DigitizationDocument.objects.filter(complaint_id=claim_number, file__isnull=False)
                .order_by("-created_date")
                .first()
            )
            if doc:
                doc = _heal_stale_s3_key(doc)
                _set_document_info_from_doc(doc)
        except Exception:
            pass

    return Response(
        {
            "core": {
                "claim_number": core.claim_number,
                "vehicle_number": core.vehicle_number,
                "engine_number": core.engine_number,
                "chassis_number": core.chassis_number,
                "make": core.make,
                "model_number": core.model_number,
                "amount": str(core.amount) if core.amount is not None else None,
            },
            "parts": parts,
            "document": document_info,
        },
        status=status.HTTP_200_OK,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def digitization_files_summary(request):
    """
    Summary of uploaded digitization documents (for Invoice Files Summary screen).
    Fetches from S3 only (no local /media rows).
    """
    limit = _to_int(request.query_params.get("limit")) or 200
    limit = max(1, min(limit, 500))

    if not s3_enabled():
        return Response({"items": []}, status=status.HTTP_200_OK)

    # Prefer classified objects; show at most 2 per claim (Repairer + Non Repairer)
    objs = list_s3_objects(prefix="digitization/classified/", limit=limit)
    if not objs:
        # Fallback to non-classified upload prefix if no classified objects exist yet
        objs = list_s3_objects(prefix="digitization/", limit=limit)

    # Build key -> claim_number mapping from DB (so Claim ID column shows MC... not DIGI-...)
    key_to_claim_number: dict[str, str] = {}
    try:
        docs = (
            DigitizationDocument.objects.filter(file__isnull=False)
            .select_related()
            .only("id", "file")
        )
        for d in docs[:2000]:
            try:
                k = str(d.file.name or "").strip()
            except Exception:
                continue
            if not k or k in key_to_claim_number:
                continue
            try:
                ex = DigitizationExtraction.objects.filter(document_id=d.id).only("claim_number").first()
                if ex and ex.claim_number:
                    key_to_claim_number[k] = str(ex.claim_number).strip()
            except Exception:
                continue
    except Exception:
        pass

    # Pick latest object per (claim, type). Type is Repairer/Non Repairer only.
    chosen: dict[tuple[str, str], dict[str, Any]] = {}

    for o in objs:
        key = str(o.get("key") or "")
        if not key or key.endswith("/"):
            continue
        parts = key.split("/")
        filename = parts[-1]

        # Extract uploaded-session claim id from key
        session_claim_id = ""
        if len(parts) >= 4 and parts[0] == "digitization" and parts[1] == "classified":
            session_claim_id = parts[2]
        elif len(parts) >= 3 and parts[0] == "digitization":
            session_claim_id = parts[1]

        # Determine classification (only 2 types)
        lower = filename.lower()
        classification = "Repairer" if "_repair" in lower else "Non Repairer"

        # Prefer to display real invoice claim_number if we can map the key
        display_claim_id = key_to_claim_number.get(key) or session_claim_id or ""

        url = presigned_get_url(key) or ""
        item = {
            "claim_id": display_claim_id,
            "filename": filename,
            "blob_key": key,
            "blob_url": url,
            "upload_status": "Success" if url else "Failed",
            "classification_type": classification,
            "last_modified": o.get("last_modified"),
            "size": o.get("size"),
        }

        grp_key = (display_claim_id, classification)
        prev = chosen.get(grp_key)
        if not prev:
            chosen[grp_key] = item
        else:
            # Keep the most recently modified
            if (item.get("last_modified") or 0) > (prev.get("last_modified") or 0):
                chosen[grp_key] = item

    # Return sorted by last_modified desc, up to limit
    out = sorted(chosen.values(), key=lambda x: x.get("last_modified") or 0, reverse=True)[:limit]
    return Response({"items": out}, status=status.HTTP_200_OK)

