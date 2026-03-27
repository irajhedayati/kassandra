# --- Build Stage ---
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder

# Disable C extensions for cassandra-driver to simplify build
ENV CASS_DRIVER_NO_EXTENSIONS=1
# Workaround for some setuptools issues in slim images
RUN uv pip install --system "setuptools<82"

WORKDIR /app

# Copy dependency files first to leverage Docker cache
COPY pyproject.toml uv.lock ./

# Install dependencies into a virtual environment
# --frozen ensures we use the exact versions from uv.lock
# --no-dev excludes development dependencies
RUN uv sync --frozen --no-dev --no-install-project

# --- Final Stage ---
FROM python:3.12-slim-bookworm AS runtime

LABEL author="Iraj Hedayati"

# Arguments for non-root user configuration
ARG NON_ROOT_USER=nonroot
ARG NON_ROOT_USER_ID=1000
ARG NON_ROOT_USER_GID=1000

# Create a non-root user for security
RUN groupadd -g ${NON_ROOT_USER_GID} ${NON_ROOT_USER} && \
    useradd -u ${NON_ROOT_USER_ID} -g ${NON_ROOT_USER_GID} -m ${NON_ROOT_USER}

WORKDIR /app

# Copy the virtual environment from the builder stage
COPY --from=builder /app/.venv /app/.venv

# Update PATH to use the virtual environment's binaries
ENV PATH="/app/.venv/bin:$PATH"

# Copy the application source code
# Ensure the non-root user owns the files
COPY --chown=${NON_ROOT_USER}:${NON_ROOT_USER} . .

# Set up configuration directory with proper permissions
ENV PY_SANDRA_HOME=/app/config
RUN mkdir -p /app/config && \
    chown -R ${NON_ROOT_USER}:${NON_ROOT_USER} /app/config

# Streamlit uses port 8501 by default
EXPOSE 8501

# Switch to non-root user
USER ${NON_ROOT_USER}

# Run the application
# Streamlit command is available in the virtual env's bin
ENTRYPOINT ["streamlit", "run", "src/main.py", "--server.port=8501", "--server.address=0.0.0.0"]
