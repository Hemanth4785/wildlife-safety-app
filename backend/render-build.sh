#!/usr/bin/env bash
# exit on error
set -o errexit

# Install Node dependencies
npm install

# Install Python dependencies globally in the Render environment
# We use python3 -m pip to ensure we use the correct environment
python3 -m pip install --upgrade pip
python3 -m pip install -r ../ml/requirements.txt
