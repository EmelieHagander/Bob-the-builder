FROM python:3.13-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgl1 libglu1-mesa libgomp1 libcairo2 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY bob_cad ./bob_cad
RUN useradd --uid 10001 --create-home cad
USER cad
EXPOSE 8080
CMD ["python", "-m", "bob_cad.server"]
