FROM python:3.13-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 QUANT_HOST=0.0.0.0 QUANT_PORT=8010
COPY quant/requirements.lock quant/pyproject.toml ./
RUN pip install --no-cache-dir -r requirements.lock
COPY quant/src ./src
RUN pip install --no-cache-dir --no-deps . && useradd --system --uid 10001 quant
USER quant
EXPOSE 8010
CMD ["python", "-m", "signaldeck_quant"]
