# syntax=docker/dockerfile:1
FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8001

WORKDIR /app

# System deps required by pdfplumber / Pillow
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      curl \
      libjpeg62-turbo \
      zlib1g \
 && rm -rf /var/lib/apt/lists/*

# Install Python deps separately for better caching
COPY pyproject.toml ./
RUN pip install --no-cache-dir .

# Copy application code
COPY . .

# Create non-root user
RUN useradd --create-home --shell /bin/bash --uid 1000 appuser \
 && chown -R appuser:appuser /app
USER appuser

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=5 \
  CMD curl -fsS "http://localhost:${PORT:-8001}/health" || exit 1

# Use shell form so ${PORT} expands at container start.
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8001}
