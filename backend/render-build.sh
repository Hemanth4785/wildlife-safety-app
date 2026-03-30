#!/usr/bin/env bash
# exit on error
set -o errexit

# Install Node dependencies
npm install

# Verify Python version
echo "Using Python version: $(python3 --version)"

# Install Python dependencies globally in the Render environment
python3 -m pip install --upgrade pip
python3 -m pip install --no-cache-dir -r ../ml/requirements.txt
