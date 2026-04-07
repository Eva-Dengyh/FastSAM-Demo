# Backend Dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies including git
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install uv
RUN pip install uv

# Copy dependency files
COPY backend/pyproject.toml backend/uv.lock* ./

# Install dependencies
RUN uv sync --frozen --no-dev

# Copy application code
COPY backend/app ./app

# Create models directory
RUN mkdir -p /app/models

# Expose port
EXPOSE 8000

# Environment variables
ENV PYTHONUNBUFFERED=1

# Start command
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]