# Stage 0: Node toolchain (npm + npx live here)
FROM node:20-slim AS node

# Stage 1: Python runtime
FROM python:3.12-slim
WORKDIR /app

# Define build argument with default value
ARG AWS_REGION=us-east-1

# --- Add node/npm/npx into the python image ---
# node binary
COPY --from=node /usr/local/bin/node /usr/local/bin/node
# npm + npx live under node_modules in official images
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
# create convenient launchers
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

COPY requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Set AWS region environment variable using the build arg
ENV AWS_REGION=${AWS_REGION}
ENV AWS_DEFAULT_REGION=${AWS_REGION}

# Signal that this is running in Docker for host binding logic
ENV DOCKER_CONTAINER=1

# If you will run npx at runtime as non-root, give it a writable cache dir
ENV NPM_CONFIG_CACHE=/home/bedrock_agentcore/.npm

# Create non-root user
RUN useradd -m -u 1000 bedrock_agentcore
USER bedrock_agentcore

EXPOSE 8080
EXPOSE 8000

COPY . .

CMD ["python", "-m", "agent"]