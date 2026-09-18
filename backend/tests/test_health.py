from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_root_endpoint():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert "message" in data
    assert "environment" in data


def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data.get("status") == "ok"
    assert "circuit_breakers" in data


def test_liveness_always_200_and_dependency_free():
    """/health/live must never touch a real dependency — patching both
    checks to explode and it must still answer 200, since a liveness probe
    that can fail because Postgres/Redis is having a bad day would make an
    orchestrator kill a perfectly fine process over someone else's outage."""
    with patch("app.api.health._check_database", side_effect=Exception("boom")), \
         patch("app.api.health._check_redis", side_effect=Exception("boom")):
        response = client.get("/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "alive"}


def test_readiness_reports_ok_when_dependencies_are_up():
    response = client.get("/health/ready")
    # This runs against the real dev DB (SQLite, always reachable) but a
    # real Redis may or may not be running wherever these tests execute —
    # only the shape and the status/HTTP-code agreement are asserted here;
    # the two failure-injection tests below cover the actual failure paths.
    data = response.json()
    assert set(data["checks"].keys()) == {"database", "redis"}
    assert (response.status_code == 200) == (data["status"] == "ready")
    assert (response.status_code == 503) == (data["status"] == "not_ready")


def test_readiness_503_when_database_unreachable():
    with patch("app.api.health._check_database", return_value=False), \
         patch("app.api.health._check_redis", return_value=True):
        response = client.get("/health/ready")
    assert response.status_code == 503
    data = response.json()
    assert data["status"] == "not_ready"
    assert data["checks"] == {"database": "failed", "redis": "ok"}


def test_readiness_503_when_redis_unreachable():
    with patch("app.api.health._check_database", return_value=True), \
         patch("app.api.health._check_redis", return_value=False):
        response = client.get("/health/ready")
    assert response.status_code == 503
    data = response.json()
    assert data["status"] == "not_ready"
    assert data["checks"] == {"database": "ok", "redis": "failed"}


def test_readiness_200_when_both_dependencies_recover():
    """Simulates the recovery case: both dependencies were failing, then
    both come back — must return to 200/ready, not stay stuck at 503."""
    with patch("app.api.health._check_database", return_value=False), \
         patch("app.api.health._check_redis", return_value=False):
        down = client.get("/health/ready")
    assert down.status_code == 503

    with patch("app.api.health._check_database", return_value=True), \
         patch("app.api.health._check_redis", return_value=True):
        recovered = client.get("/health/ready")
    assert recovered.status_code == 200
    assert recovered.json() == {"status": "ready", "checks": {"database": "ok", "redis": "ok"}}


def test_readiness_check_failure_does_not_hang():
    """A check that raises (not just returns False) must still be caught and
    reported as failed, not propagate as a 500 or hang past the configured
    per-check timeout."""
    import time

    def slow_and_broken():
        raise ConnectionError("simulated hard failure")

    with patch("app.api.health._check_database", side_effect=slow_and_broken):
        started = time.monotonic()
        response = client.get("/health/ready")
        elapsed = time.monotonic() - started
    assert response.status_code == 503
    assert response.json()["checks"]["database"] == "failed"
    assert elapsed < 10, f"readiness check took {elapsed:.1f}s, expected a fast failure"
