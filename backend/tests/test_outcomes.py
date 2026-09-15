from app.api.outcomes import OutcomeEventIn


def test_outcome_event_accepts_measured_business_fields():
    event = OutcomeEventIn(
        workflow_type="resume_screening",
        workflow_id="candidate-42",
        langfuse_trace_id="a" * 32,
        automated=True,
        manual_baseline_minutes=12,
        human_active_minutes=3,
        labor_cost_per_hour_usd=20,
        ai_cost_usd=0.08,
        review_outcome="accepted",
    )
    assert event.manual_baseline_minutes - event.human_active_minutes == 9


def test_outcome_event_rejects_negative_cost():
    try:
        OutcomeEventIn(workflow_type="rag", workflow_id="req-1", ai_cost_usd=-0.01)
    except ValueError:
        return
    raise AssertionError("negative cost must be rejected")
