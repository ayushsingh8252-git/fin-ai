from app.services.cost_governance import budget_status


def test_budget_status_warns_before_limit():
    result = budget_status(spend=8, limit=10, warning_ratio=0.8)
    assert result["status"] == "warning"
    assert result["remaining_usd"] == 2


def test_budget_status_marks_over_budget():
    result = budget_status(spend=12, limit=10, warning_ratio=0.8)
    assert result["status"] == "over_budget"
    assert result["utilization"] == 1.2


def test_budget_status_is_explicit_when_unconfigured():
    assert budget_status(spend=1, limit=None, warning_ratio=0.8)["status"] == "not_configured"
