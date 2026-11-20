"""All Module 10 endpoints. The module has two owners, so each part has its own routes file:
governance (members, audit log, data settings) in `governance_routes.py`; operations (LLM
providers, usage limits, system health) in `operations_routes.py`."""

from fastapi import APIRouter

from app.modules.m10_admin.governance_routes import router as governance_router
from app.modules.m10_admin.operations_routes import router as operations_router

router = APIRouter()
router.include_router(governance_router)
router.include_router(operations_router)
