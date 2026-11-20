FROM python:3.13-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 QUANT_HOST=0.0.0.0 QUANT_PORT=8010
COPY quant/requirements.lock quant/pyproject.toml ./
RUN pip install --no-cache-dir -r requirements.lock
ARG INSTALL_LONGBRIDGE=false
RUN case "$INSTALL_LONGBRIDGE" in \
    true|1) pip install --no-cache-dir --no-deps longbridge==5.4.0 ;; \
    false|0) ;; \
    *) printf '%s\n' 'INSTALL_LONGBRIDGE must be true, false, 1 or 0' >&2; exit 1 ;; \
    esac
COPY quant/src ./src
COPY docs/licenses/longbridge-MIT.txt /usr/share/licenses/longbridge/LICENSE-MIT
RUN pip install --no-cache-dir --no-deps . && useradd --system --uid 10001 quant
USER quant
EXPOSE 8010
CMD ["python", "-m", "signaldeck_quant"]
