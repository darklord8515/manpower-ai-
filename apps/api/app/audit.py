"""Append-only audit trail.

The application role may INSERT into audit_log but never UPDATE or DELETE.
"""

from __future__ import annotations

import ipaddress
import uuid

from fastapi import Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.deps import AuthUser


def _client_ip(request: Request) -> str | None:
    host = request.client.host if request.client else None
    try:
        return str(ipaddress.ip_address(host)) if host else None
    except ValueError:
        return None


def write_audit(
    session: Session,
    request: Request,
    action: str,
    entity_type: str,
    user: AuthUser | None = None,
    entity_id: uuid.UUID | None = None,
) -> None:
    session.execute(
        text(
            """INSERT INTO audit_log (user_id, role_codes, action, entity_type, entity_id, ip)
               VALUES (:user_id, :roles, :action, :entity_type, :entity_id, CAST(:ip AS inet))"""
        ),
        {
            "user_id": user.id if user else None,
            "roles": list(user.roles) if user else None,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "ip": _client_ip(request),
        },
    )
    session.commit()
