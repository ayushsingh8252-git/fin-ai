from app.config import Settings


def test_default_settings():
    settings = Settings()
    assert settings.PORT == 8000
    assert "sqlite" in settings.DATABASE_URL
    assert settings.FRAUD_ELA_THRESHOLD == 35.0


def test_custom_settings_override(monkeypatch):
    monkeypatch.setenv("PORT", "9000")
    monkeypatch.setenv("ENVIRONMENT", "test")
    monkeypatch.setenv("PINECONE_INDEX_NAME", "custom-rules")

    custom_settings = Settings()
    assert custom_settings.PORT == 9000
    assert custom_settings.ENVIRONMENT == "test"
    assert custom_settings.PINECONE_INDEX_NAME == "custom-rules"
