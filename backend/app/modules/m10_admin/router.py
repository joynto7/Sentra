"""All Module 10 endpoints. The module has two owners, so each part has its own routes file:
governance (members, audit log, data settings) here; operations (LLM providers, usage limits,
system health) join in Sprint 4."""

from fastapi import APIRouter

from app.modules.m10_admin.governance_routes import router as governance_router

router = APIRouter()
router.include_router(governance_router)
