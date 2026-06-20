# Sales ERP — Backend API Reference

**Base URL (dev):** `http://localhost:3001`  
**Proxy:** Vite forwards `/api/*` → `http://localhost:3001`, so the frontend can call `/api/...` directly.  
**Auth:** None currently.  
**Content-Type:** `application/json` for all JSON requests. Use `multipart/form-data` only for file uploads (documents).  
**Encoding:** All `inquiryId` values in URL paths must be `encodeURIComponent`-encoded (they contain `/`).

---

## Table of Contents

1. [Inquiries](#1-inquiries)
2. [Documents](#2-documents)
3. [AI Extraction](#3-ai-extraction)
4. [Sections](#4-sections)
5. [Stage 3 — Document Check & Acknowledgment](#5-stage-3--document-check--acknowledgment)
6. [Stage 4 — Tag List Extraction](#6-stage-4--tag-list-extraction)
7. [Stage 6 — Technical Queries](#7-stage-6--technical-queries)
8. [Stage 7 — Bill of Materials](#8-stage-7--bill-of-materials)
9. [Stage 8 — Techno-Commercial Proposal](#9-stage-8--techno-commercial-proposal)
10. [Shared Types](#10-shared-types)

---

## 1. Inquiries

Base path: `/api/inquiries`

---

### `GET /api/inquiries`

List all inquiries.

**Response**
```json
[
  {
    "_id": "...",
    "inquiryId": "OEL/EST/2026/0411",
    "client": "TCE",
    "project": "IOCL Paradip",
    "scope": "Chemical Dosing Skid",
    "value": 2.07,
    "currency": "USD",
    "valueUnit": "Mn",
    "priority": "P1",
    "currentStage": 2,
    "currentStageName": "Go / No-Go Review",
    "cluster": "estimation",
    "daysToBid": -68,
    "bidDue": "12-Apr",
    "receivedDate": "2026-05-09",
    "source": "Direct intake",
    "estimator": "Sneha Bharti",
    "completedUpTo": 1
  }
]
```

---

### `GET /api/inquiries/:id`

Get a single inquiry by `inquiryId`.

**URL Params**

| Param | Type | Description |
|:--|:--|:--|
| `id` | string | `inquiryId` (URL-encoded) |

**Response** — same shape as one element above.  
**404** if not found.

---

### `POST /api/inquiries`

Create a new inquiry.

**Request Body**

| Field | Type | Required | Notes |
|:--|:--|:--:|:--|
| `inquiryId` | string | ✓ | Must be unique. Format: `OEL/EST/YYYY/NNNN` |
| `client` | string | ✓ | |
| `project` | string | ✓ | |
| `scope` | string | ✓ | Package / scope description |
| `value` | number | ✓ | Numeric amount |
| `currency` | `"USD"` \| `"INR"` | ✓ | |
| `valueUnit` | `"Mn"` \| `"Cr"` | ✓ | |
| `priority` | `"P1"` \| `"P2"` \| `"P3"` | ✓ | |
| `currentStage` | number | ✓ | 1–14 |
| `currentStageName` | string | ✓ | |
| `cluster` | `"intake"` \| `"estimation"` \| `"proposal"` \| `"bid_active"` \| `"outcome"` | ✓ | |
| `daysToBid` | number | ✓ | Negative = overdue |
| `bidDue` | string | ✓ | e.g. `"12-Apr"` |
| `receivedDate` | string | ✓ | e.g. `"2026-05-09"` |
| `source` | string | ✓ | |
| `estimator` | string | ✓ | |
| `completedUpTo` | number | ✓ | Last completed stage (0 if none) |

**Response** `201` — created inquiry object.

---

## 2. Documents

Base path: `/api/documents`

> `s3Key` and `s3Bucket` are **never sent to the client**. The API returns a short-lived `presignedUrl` (1-hour GET link) and a `hasFile: boolean` flag instead.

---

### `GET /api/documents/inquiry/:inquiryId`

All documents for an inquiry, with AI fields and presigned S3 URLs.

**Response**
```json
[
  {
    "_id": "...",
    "inquiryId": "OEL/EST/2026/0411",
    "docType": "RFQ",
    "title": "Request for Quotation",
    "rev": "A",
    "status": "read",
    "fileName": "rfq.pdf",
    "fileSize": 204800,
    "mimeType": "application/pdf",
    "uploadedBy": "system",
    "hasFile": true,
    "presignedUrl": "https://s3.amazonaws.com/...",
    "processingStatus": "done",
    "aiSummary": "...",
    "keyItems": ["4 nos Pig Launcher/Receiver", "SS316L"],
    "extractedSections": [
      { "title": "Scope of Work", "content": "...", "summary": "..." }
    ]
  }
]
```

---

### `GET /api/documents/:docId`

Single document by MongoDB `_id`.

**Response** — same shape as one element above.

---

### `GET /api/documents/:docId/analysis`

AI analysis output only (lightweight — no file metadata).

**Response**
```json
{
  "overview": "...",
  "keyItems": ["..."],
  "sections": [
    { "title": "Scope of Work", "content": "...", "summary": "..." }
  ]
}
```

---

### `POST /api/documents/inquiry/:inquiryId`

Upload a document. Stores file in S3, saves metadata to MongoDB.

**Request** — `multipart/form-data`

| Field | Type | Required | Notes |
|:--|:--|:--:|:--|
| `file` | File | ✓ | PDF, DOCX, XLSX, etc. |
| `docType` | string | ✓ | `RFQ`, `BDS`, `ITB`, `MR`, `TQ`, `Other` |
| `title` | string | ✓ | Human-readable document title |
| `rev` | string | | Revision code, e.g. `"A"` |
| `status` | `"read"` \| `"open"` \| `"queued"` | | Default: `"queued"` |

**Response** `201` — created document object (same shape as GET, with `processingStatus: "pending"`).

---

### `DELETE /api/documents/:docId`

Delete a document record from MongoDB.  
> Note: the S3 file is **not** deleted currently (planned future work).

**Response** `200`
```json
{ "message": "Document deleted." }
```

---

## 3. AI Extraction

Base path: `/api/extract`

Triggers Gemini to extract sections/summary from an uploaded PDF. Uses an **async pipeline** — trigger with POST, poll with GET.

---

### `POST /api/extract/document/:docId`

Trigger Gemini extraction for a single document. Returns `202 Accepted` immediately; extraction runs in the background.

**Response** `202`
```json
{ "message": "Extraction started.", "docId": "..." }
```

---

### `GET /api/extract/document/:docId`

Poll extraction status for a single document.

**Response**
```json
{
  "_id": "...",
  "processingStatus": "done",
  "aiSummary": "...",
  "keyItems": ["..."],
  "extractedSections": [
    { "title": "...", "content": "...", "summary": "..." }
  ]
}
```

`processingStatus` values: `pending` → `processing` → `done` | `failed`

---

### `POST /api/extract/inquiry/:inquiryId`

Bulk-trigger extraction for all pending documents in an inquiry.

**Response** `202`
```json
{ "triggered": 3, "skipped": 1 }
```

---

### `GET /api/extract/inquiry/:inquiryId`

Status overview for all documents in an inquiry.

**Response**
```json
{
  "inquiryId": "OEL/EST/2026/0411",
  "documents": [
    { "_id": "...", "title": "...", "processingStatus": "done" }
  ]
}
```

---

## 4. Sections

Base path: `/api/sections`

Extracted sections stored as independent records (one per section per document).

---

### `GET /api/sections/inquiry/:inquiryId`

All sections across every document, grouped by document.

**Response**
```json
{
  "inquiryId": "OEL/EST/2026/0411",
  "totalSections": 12,
  "documents": [
    {
      "documentId": "...",
      "docType": "RFQ",
      "documentTitle": "Request for Quotation",
      "sections": [
        {
          "_id": "...",
          "sectionIndex": 0,
          "title": "Scope of Work",
          "content": "...",
          "summary": "..."
        }
      ]
    }
  ]
}
```

---

### `GET /api/sections/document/:docId`

All sections for one document, in order.

**Response** — array of section objects (same shape as above, without the document wrapper).

---

### `GET /api/sections/:sectionId`

Single section by MongoDB `_id`.

---

### `DELETE /api/sections/:sectionId`

Delete a section.

**Response**
```json
{ "message": "Section deleted.", "sectionId": "..." }
```

---

## 5. Stage 3 — Document Check & Acknowledgment

Base path: `/api/stage3`

Synchronous Gemini calls (no polling needed).

---

### `GET /api/stage3/:inquiryId`

All stage 3 work (gap analysis + email draft).

**Response**
```json
{
  "inquiryId": "OEL/EST/2026/0411",
  "gapAnalysis": {
    "status": "done",
    "requiredSections": ["Tag List & Datasheet", "Inspection Requirements"],
    "receivedSections": ["Scope of Work", "Commercial Terms"],
    "gaps": [
      {
        "section": "Tag List & Datasheet",
        "reason": "Required for equipment sizing",
        "severity": "critical"
      }
    ],
    "recommendation": "Request Tag List before commencing estimation.",
    "analysedAt": "2026-06-19T10:00:00.000Z"
  },
  "emailDraft": {
    "status": "done",
    "subject": "Acknowledgment of RFQ — OEL/EST/2026/0411",
    "body": "Dear Sir/Madam, ...",
    "draftedAt": "2026-06-19T10:01:00.000Z"
  }
}
```

---

### `POST /api/stage3/:inquiryId/analyse`

Run gap analysis on all extracted sections for the inquiry.

**Request Body** — none required.

**Response** — `gapAnalysis` object (same shape as above).  
**409** if already processing.

---

### `GET /api/stage3/:inquiryId/analyse`

Get saved gap analysis.

**404** if not yet run.

---

### `POST /api/stage3/:inquiryId/email`

Draft an acknowledgment email. Auto-runs gap analysis first if not done.

**Request Body** — none required.

**Response** — `emailDraft` object.

---

### `GET /api/stage3/:inquiryId/email`

Get saved email draft.

---

## 6. Stage 4 — Tag List Extraction

Base path: `/api/stage4`

Extracts the structured equipment/tag list from an uploaded PDF using Gemini.

---

### `POST /api/stage4/:inquiryId/extract`

Extract tag list from a document. Synchronous — responds with the full result.  
Re-running **replaces** the existing extraction.

**Request Body**

| Field | Type | Required | Notes |
|:--|:--|:--:|:--|
| `documentId` | string (ObjectId) | | MongoDB `_id` of the document to extract from. If omitted, uses the first uploaded document for the inquiry. |

**Response**
```json
{
  "inquiryId": "OEL/EST/2026/0411",
  "sourceDocumentId": "...",
  "sourceDocumentTitle": "Request for Quotation",
  "status": "done",
  "extractedAt": "2026-06-19T10:05:00.000Z",
  "extractionNotes": "Found 1 tag list table with 4 items.",
  "tags": [
    {
      "tagNumber": "300-EE-00-2201 A/B",
      "productName": "Heat Exchanger",
      "dimensions": "ID 600mm × L 3000mm",
      "weightPerUnit": "850 kg",
      "quantity": "4 nos",
      "notes": "SS316L, ASME VIII Div 1",
      "missingFields": []
    }
  ]
}
```

Fields set to `"not specified"` when not found. `missingFields` lists which fields could not be extracted.  
**422** if no document is uploaded yet.  
**409** if extraction already in progress.

---

### `GET /api/stage4/:inquiryId`

Full extraction result (tags + status).

---

### `GET /api/stage4/:inquiryId/tags`

Tags array only (lightweight — for table rendering).

**Response**
```json
{
  "inquiryId": "OEL/EST/2026/0411",
  "count": 4,
  "tags": [ ... ]
}
```

**404** if extraction not yet run. **500** if extraction failed.

---

## 7. Stage 6 — Technical Queries

Base path: `/api/stage6`

TQ numbers (`TQ-01`, `TQ-02` …) are auto-assigned per inquiry. Status progresses one way: `draft` → `sent` → `answered`.

---

### `GET /api/stage6/:inquiryId`

All TQs for the inquiry with summary stats.

**Response**
```json
{
  "inquiryId": "OEL/EST/2026/0411",
  "summary": {
    "total": 5,
    "draft": 1,
    "sent": 3,
    "answered": 1,
    "stageState": "Waiting on client"
  },
  "tqs": [
    {
      "_id": "...",
      "tqNumber": "TQ-01",
      "tagClause": "300-EE-00-2201 A/B",
      "clauseRef": "DS-4033 Sh.2",
      "question": "Shell-side design temp shows 175°C but allowable stress block referenced is 200°C — confirm.",
      "answer": "",
      "sendTo": "EIL",
      "raisedBy": "RJ",
      "status": "sent",
      "sentAt": "2026-06-18T09:00:00.000Z",
      "answeredAt": null,
      "createdAt": "..."
    }
  ]
}
```

`stageState` values: `"No queries raised"` | `"Drafts pending review"` | `"Waiting on client"` | `"All queries answered"`

---

### `POST /api/stage6/:inquiryId/tq`

Create a new TQ. Auto-assigns the next `TQ-NN` number. Status defaults to `draft`.

**Request Body**

| Field | Type | Required | Notes |
|:--|:--|:--:|:--|
| `question` | string | ✓ | The technical question |
| `sendTo` | string | ✓ | Recipient org/person (e.g. `"EIL"`) |
| `raisedBy` | string | ✓ | Initials or name (e.g. `"RJ"`) |
| `tagClause` | string | | TAG / model number reference. Default `"–"` |
| `clauseRef` | string | | Secondary clause / datasheet ref (e.g. `"DS-4033 Sh.2"`) |

**Response** `201` — created TQ object.

---

### `GET /api/stage6/:inquiryId/tq/:tqId`

Single TQ by MongoDB `_id`.

---

### `PATCH /api/stage6/:inquiryId/tq/:tqId`

Edit fields and / or advance status.

**Request Body** — all fields optional

| Field | Type | Notes |
|:--|:--|:--|
| `tagClause` | string | |
| `clauseRef` | string | |
| `question` | string | Locked after status = `answered` |
| `answer` | string | Required before advancing to `answered` |
| `sendTo` | string | |
| `raisedBy` | string | |
| `status` | `"draft"` \| `"sent"` \| `"answered"` | One-way only. Moving to `"sent"` sets `sentAt`. Moving to `"answered"` sets `answeredAt` and requires `answer` to be non-empty. |

**Response** — updated TQ object.  
**400** if invalid status or backward transition.

---

### `DELETE /api/stage6/:inquiryId/tq/:tqId`

Delete a TQ. TQ numbers are not re-sequenced after deletion.

**Response**
```json
{ "message": "TQ-02 deleted.", "tqId": "..." }
```

---

## 8. Stage 7 — Bill of Materials

Base path: `/api/stage7`

BOM is per-inquiry. Items have their own `_id` for individual edits. `totalInr` and `grandTotalInr` are recomputed automatically on every change.

---

### `GET /api/stage7/:inquiryId`

Full BOM — items, grand total, and status.

**Response**
```json
{
  "inquiryId": "OEL/EST/2026/0411",
  "status": "done",
  "estimatedAt": "2026-06-19T11:00:00.000Z",
  "grandTotalInr": 8750000,
  "items": [
    {
      "_id": "...",
      "tagNumber": "300-EE-00-2201 A/B",
      "productName": "Heat Exchanger",
      "quantity": 4,
      "quantityUnit": "nos",
      "rateInr": 1250000,
      "totalInr": 5000000,
      "aiEstimated": true,
      "rationale": "Shell-and-tube HE in SS316L, ASME VIII — typical Indian fabricator rate.",
      "confidence": "medium",
      "notes": ""
    }
  ]
}
```

---

### `POST /api/stage7/:inquiryId/estimate`

Pull tag list from Stage 4 → call Gemini for INR unit rates → save BOM.  
Re-running **replaces** the existing BOM.  
**422** if Stage 4 extraction has not been completed first.

**Request Body** — none required.

**Response** — full BOM object (same as GET).

---

### `POST /api/stage7/:inquiryId/items`

Manually add a new line item.

**Request Body**

| Field | Type | Required | Notes |
|:--|:--|:--:|:--|
| `productName` | string | ✓ | |
| `quantity` | number | ✓ | Must be ≥ 0 |
| `rateInr` | number | ✓ | Per unit, must be ≥ 0 |
| `quantityUnit` | string | | Default `"nos"` |
| `tagNumber` | string | | |
| `notes` | string | | |

**Response** `201` — full updated BOM object.

---

### `PATCH /api/stage7/:inquiryId/items/:itemId`

Edit a single BOM item. All fields optional. Editing `rateInr` marks `aiEstimated: false` and `confidence: "manual"`. Totals recalculate automatically.

**Request Body** — any subset of `{ productName, quantity, quantityUnit, rateInr, tagNumber, notes }`

**Response** — full updated BOM object.

---

### `DELETE /api/stage7/:inquiryId/items/:itemId`

Remove a line item. Recalculates `grandTotalInr`.

**Response** — full updated BOM object.

---

## 9. Stage 8 — Techno-Commercial Proposal

Base path: `/api/stage8`

Generates a complete Markdown proposal using data from all prior stages. Supports manual editing after generation.

---

### `GET /api/stage8/:inquiryId`

Get saved proposal.

**Response**
```json
{
  "inquiryId": "OEL/EST/2026/0411",
  "status": "done",
  "title": "Techno-Commercial Offer for Supply of Chemical Dosing Skid | Our Ref: OEL/EST/2026/0411 | TCE – IOCL Paradip",
  "body": "## Reference Details\n\n| | |\n|:--|:--|...",
  "draftedAt": "2026-06-19T12:00:00.000Z",
  "editedAt": null
}
```

`body` is **GitHub-flavored Markdown**. Render with any MD renderer on the frontend.  
`editedAt` is set when the user manually edits after AI generation (null = untouched AI output).  
Returns `status: "pending"` with empty strings if no proposal exists yet.

---

### `POST /api/stage8/:inquiryId/draft`

Generate (or regenerate) the proposal. Automatically aggregates data from:
- Inquiry metadata
- RFQ extracted sections (Stage 1)
- Document gap analysis (Stage 3)
- Equipment / tag list (Stage 4)
- Answered technical queries (Stage 6)
- Bill of materials with INR pricing (Stage 7)

Synchronous. Re-running **replaces** the previous draft.  
**409** if generation already in progress.

**Request Body** — none required.

**Response** — proposal object (same as GET).

---

### `PATCH /api/stage8/:inquiryId`

Manually edit the proposal after generation.

**Request Body** — both fields optional

| Field | Type | Notes |
|:--|:--|:--|
| `title` | string | Overrides AI-generated title |
| `body` | string | Full replacement of Markdown body |

**Response** — updated proposal object. `editedAt` is set to current timestamp.  
**409** if generation is currently in progress.

---

## 10. Shared Types

### WorkStatus
```
"pending" | "processing" | "done" | "failed"
```

### TQStatus
```
"draft" | "sent" | "answered"
```

### Inquiry — cluster
```
"intake" | "estimation" | "proposal" | "bid_active" | "outcome"
```

### Inquiry — priority
```
"P1" | "P2" | "P3"
```

### Document — processingStatus
```
"pending" | "processing" | "done" | "failed"
```

### Stage 6 — stageState
```
"No queries raised" | "Drafts pending review" | "Waiting on client" | "All queries answered"
```

### Stage 7 — confidence
```
"high" | "medium" | "low" | "manual"
```

---

## Error Responses

All errors follow this shape:

```json
{ "error": "Human-readable message.", "details": "Optional — raw error string." }
```

| Code | When |
|--:|:--|
| `400` | Invalid input (missing required field, bad ObjectId, invalid enum value) |
| `404` | Resource not found |
| `409` | Conflict — concurrent operation in progress |
| `422` | Prerequisite not met (e.g. Stage 4 not done before Stage 7 estimate) |
| `500` | Server / Gemini / S3 error |
