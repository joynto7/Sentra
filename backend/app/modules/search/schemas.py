"""The answer of the search box. Only these fields leave the API: what the list pages show every member."""

import uuid

from pydantic import BaseModel, Field


class SearchIn(BaseModel):
    q: str = Field(max_length=100)


class TargetHit(BaseModel):
    id: uuid.UUID
    name: str
    type: str
    environment: str
    status: str
    endpoint_host: str


class FindingHit(BaseModel):
    code: str
    title: str
    severity: str
    status: str
    target_name: str


class CampaignHit(BaseModel):
    code: str
    name: str
    target_name: str
    run_number: int | None  # set when the words were a run's code, such as R-231-4


class TargetHits(BaseModel):
    total: int
    items: list[TargetHit]


class FindingHits(BaseModel):
    total: int
    items: list[FindingHit]


class CampaignHits(BaseModel):
    total: int
    items: list[CampaignHit]


class SearchOut(BaseModel):
    targets: TargetHits
    findings: FindingHits
    campaigns: CampaignHits
