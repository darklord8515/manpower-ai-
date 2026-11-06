"""Names HR uses for things the database stores as codes."""

from __future__ import annotations

DOCUMENT_LABEL = {
    "residency_visa": "Residency visa",
    "medical_fitness": "Medical fitness",
    "labour_card": "Labour card",
    "passport": "Passport",
    "work_permit": "Work permit",
}


def document_label(doc_type: str) -> str:
    return DOCUMENT_LABEL.get(doc_type, doc_type.replace("_", " ").capitalize())
