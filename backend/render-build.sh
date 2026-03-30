#!/usr/bin/env bash
# exit on error
set -o errexit

# Install Node dependencies
npm install

# Force Python version check and log
echo "Checking Python environment..."
export PYTHON_VERSION=3.10.11
echo "Current Python version: $(python3 --version)"

# Install Python dependencies globally in the Render environment
python3 -m pip install --upgrade pip
python3 -m pip install --no-cache-dir tensorflow==2.15.0 pandas==2.1.4 numpy==1.26.4 scikit-learn==1.3.2 haversine==2.8.0 joblib==1.3.2
