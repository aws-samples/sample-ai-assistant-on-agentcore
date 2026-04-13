#!/bin/bash

build_path=build

[[ -z "$build_path" ]] && echo "ERROR: build_path is not defined" && exit 1

pwd
ROOT="$PWD"

# Define build paths
# authorizer_build_path="${build_path}/authorizer_code/"
# backend_build_path="${build_path}/backend_code/"
# auth_layer_path="${build_path}/authorization_deps_code/"
kb_indexer_build_path="${build_path}/kb_indexer_code/"
expiry_cleanup_build_path="${build_path}/expiry_cleanup_code/"
task_executor_build_path="${build_path}/task_executor_code/"

# Clean up existing build directories
# rm -rf "$authorizer_build_path"
# rm -rf "$backend_build_path"
# rm -rf "$auth_layer_path"
rm -rf "$kb_indexer_build_path"
rm -rf "$expiry_cleanup_build_path"
rm -rf "$task_executor_build_path"

# Create new build directories
# mkdir -p "$authorizer_build_path"
# mkdir -p "$backend_build_path"
# mkdir -p "$auth_layer_path"
mkdir -p "$kb_indexer_build_path"
mkdir -p "$expiry_cleanup_build_path"
mkdir -p "$task_executor_build_path"

# echo "Building lambda layers"
# cd "$ROOT"

# # Build authorizer lambda layer
# if [[ -f ../backend/dependencies/requirements-authorizer.txt ]]; then
#     echo "Installing authorizer packages..."
#     pip3 install --platform manylinux2014_x86_64 --implementation cp --only-binary=:all: --python-version 3.12 -r ../backend/dependencies/requirements-authorizer.txt --target "$auth_layer_path/python"
# fi

# cd "$ROOT"
# echo "Building authorizer lambda"
# cp -r ../backend/authorizer/* "$authorizer_build_path/"

# cd "$ROOT"
# echo "Building backend lambda"
# cp -r ../backend/app/* "$backend_build_path/"

# # Install backend Python dependencies if requirements file exists
# if [[ -f ../backend/app/requirements.txt ]]; then
#     echo "Installing backend packages..."
#     pip3 install --platform manylinux2014_x86_64 --implementation cp --only-binary=:all: --python-version 3.12 -r ../backend/app/requirements.txt --target "$backend_build_path"
# fi

cd "$ROOT"
echo "Building kb_indexer lambda"
cp -r ../backend/kb_indexer/*.py "$kb_indexer_build_path/"
# Note: boto3 is included in Lambda runtime, no need to install dependencies

cd "$ROOT"
echo "Building expiry_cleanup lambda"
cp -r ../backend/expiry_cleanup/*.py "$expiry_cleanup_build_path/"

cd "$ROOT"
echo "Building task_executor lambda"
cp -r ../backend/task_executor/*.py "$task_executor_build_path/"