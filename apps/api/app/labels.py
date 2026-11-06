"""Names HR uses for things the database stores as codes."""

from __future__ import annotations

DOCUMENT_LABEL = {
    "residency_visa": "Residency visa",
    "medical_fitness": "Medical fitness",
    "labour_card": "Labour card",
    "passport": "Passport",
    "work_permit": "Work permit",
}


STAGE_LABEL = {
    "open": "Future requirement",
    "sourcing": "Under recruitment",
    "offer_issued": "Offer issued",
    "visa_processing": "Visa processing",
    "arrived": "Arrived, pending deployment",
    "filled": "Active",
    "cancelled": "Cancelled",
}
OPEN_STAGES = ("open", "sourcing", "offer_issued", "visa_processing", "arrived")
EXIT_LABEL = {
    "resigned": "resigned",
    "terminated": "terminated",
    "absconded": "left without notice",
    "contract_ended": "contract ended",
    "other": "leaving",
}


STAGE_PHRASE = {
    "open": "requested",
    "sourcing": "being recruited",
    "offer_issued": "with an offer issued",
    "visa_processing": "in visa processing",
    "arrived": "arrived, pending deployment",
}


def stage_phrase(stage: str) -> str:
    return STAGE_PHRASE.get(stage, stage.replace("_", " "))


def stage_label(stage: str) -> str:
    return STAGE_LABEL.get(stage, stage.replace("_", " ").capitalize())


def document_label(doc_type: str) -> str:
    return DOCUMENT_LABEL.get(doc_type, doc_type.replace("_", " ").capitalize())
