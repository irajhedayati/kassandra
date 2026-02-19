FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder
ENV CASS_DRIVER_NO_EXTENSIONS=1
RUN uv pip install --system "setuptools<82"
WORKDIR /app
COPY . .
RUN uv sync --frozen --no-dev --no-install-project

FROM python:3.12-slim
LABEL author="Iraj Hedayati"

WORKDIR /app

COPY --from=builder /app/.venv /app/.venv

ENV PATH="/app/.venv/bin:$PATH"

COPY . .

EXPOSE 8501

ENTRYPOINT ["streamlit", "run", "src/app.py", "--server.port=8501", "--server.address=0.0.0.0"]
