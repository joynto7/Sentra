from fastapi import APIRouter
from pydantic import BaseModel

from app.core.errors import NotFoundError
from app.main import app

router = APIRouter(prefix="/_test")


class Item(BaseModel):
    name: str


@router.get("/missing")
def missing() -> None:
    raise NotFoundError("Target not found.")


@router.post("/items")
def create_item(item: Item) -> Item:
    return item


app.include_router(router, prefix="/api")


def test_app_error_has_standard_shape(client):
    response = client.get("/api/_test/missing")

    assert response.status_code == 404
    assert response.json() == {"error": {"code": "not_found", "message": "Target not found."}}


def test_validation_error_lists_fields(client):
    response = client.post("/api/_test/items", json={})

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["details"][0]["field"] == "name"


def test_unknown_route_uses_standard_shape(client):
    response = client.get("/api/does-not-exist")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "http_404"
