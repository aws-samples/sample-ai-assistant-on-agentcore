# Stage 0: get node/npm/npx
FROM node:20-slim AS node

# Stage 1: runtime
FROM python:3.12-slim
WORKDIR /app

# copy node toolchain
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# (rest of your Dockerfile as-is)
ARG AWS_REGION=us-east-1
COPY requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

ENV AWS_REGION=${AWS_REGION}
ENV AWS_DEFAULT_REGION=${AWS_REGION}
ENV DOCKER_CONTAINER=1
ENV NPM_CONFIG_CACHE=/home/bedrock_agentcore/.npm

RUN useradd -m -u 1000 bedrock_agentcore
USER bedrock_agentcore

EXPOSE 8080
COPY . .
CMD ["python", "-m", "agent"]