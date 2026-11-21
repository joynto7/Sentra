FROM python:3.12.14-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt
COPY . .

# The policy the gateway keeps enforcing when Sentra can't be reached (UC-8.1, quality req.)
RUN useradd --create-home --uid 1000 shield && mkdir -p /var/lib/sentra-shield \
    && chown -R shield /app /var/lib/sentra-shield
USER shield

EXPOSE 8443
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8443"]
