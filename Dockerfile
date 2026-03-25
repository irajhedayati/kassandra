ARG NON_ROOT_USER=nonroot
ARG NON_ROOT_USER_ID=1000
ARG NON_ROOT_USER_GID=$NON_ROOT_USER_ID

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder
ENV CASS_DRIVER_NO_EXTENSIONS=1
RUN uv pip install --system "setuptools<82"
WORKDIR /app
COPY . .
RUN uv sync --frozen --no-dev --no-install-project

FROM python:3.12-slim
LABEL author="Iraj Hedayati"

WORKDIR /app
RUN usermod --uid $NON_ROOT_USER_ID \
    --gid $NON_ROOT_USER_GID $NON_ROOT_USER

COPY --chown=${NON_ROOT_USER}:${NON_ROOT_USER} \
     --from=builder /app/.venv /app/.venv

ENV PATH="/app/.venv/bin:$PATH"

COPY --chown=${NON_ROOT_USER}:${NON_ROOT_USER} . .

# Default environment variables
ENV PY_SANDRA_HOME=/app/config
RUN mkdir -p /app/config

EXPOSE 8501
USER ${NON_ROOT_USER_ID}
ENTRYPOINT ["/bin/sh", "-c", "streamlit run src/main.py"]
