# Wildlife Safety App - Operational Run Guide

This guide provides step-by-step instructions to run the full Wildlife Safety stack, including the Data Pipeline, Machine Learning Models, Backend Server, and Mobile Application.

## Prerequisites

1.  **Node.js** (v18+)
2.  **Python 3.13** (for general scripting)
3.  **Python 3.10** (REQUIRED for TensorFlow/ML)
4.  **Expo Go** app on your mobile device (for testing mobile).

---

## 1. Environment Setup (One-Time)

You need **two** separate Python environments to handle dependency conflicts between modern Python and TensorFlow.

### A. General Scripting Environment (`gbif_env`)
*Uses Python 3.13 (or system default)*

```powershell
# Create environment
python -m venv gbif_env

# Activate
.\gbif_env\Scripts\activate

# Install dependencies
pip install -r backend/python/requirements.txt
```

### B. Machine Learning Environment (`lstm_env`)
*MUST use Python 3.10 for TensorFlow compatibility*

```powershell
# Create environment using specific Python 3.10 executable
py -3.10 -m venv lstm_env

# Activate
.\lstm_env\Scripts\activate

# Install dependencies (includes tensorflow, pandas, scikit-learn, joblib)
pip install -r ml/requirements.txt
```

---

## 2. Running the Data Pipeline (Daily/Weekly)

Before starting the server, you need fresh data and trained models.

### Step 1: Fetch Recent Sightings
Uses `gbif_env` to download data from iNaturalist.

```powershell
.\gbif_env\Scripts\python.exe backend/python/fetch_inat_recent.py
```
*Output: `backend/python/cache/inat_live.json` (approx 170+ records)*

### Step 2: Train ML Models
Uses `lstm_env` to train LSTM movement predictors.

```powershell
.\lstm_env\Scripts\python.exe ml/lstm_movement.py
```
*Output: `.keras` model files in `ml/models/lstm/`*

---

## 3. Starting the Application (Development)

Run these in separate terminals.

### Terminal 1: Backend Server
The Node.js server orchestrates the API and calls Python scripts as needed.

```powershell
# Install node dependencies (if first time)
npm install

# Start the server
node backend/index.js
```
*Server runs on: `http://localhost:3000` (or your LAN IP)*

### Terminal 2: Mobile/Web Frontend
Starts the Expo development server.

```powershell
# Start Expo (Offline mode is faster/more stable for local dev)
npx expo start --offline
```
*Scan the QR code with the Expo Go app on your phone.*

---

## Troubleshooting

*   **"TensorFlow not installed" error:** Ensure `lstm_env` was created with Python 3.10 and you installed `ml/requirements.txt` inside it.
*   **Mobile App "Connecting to backend...":** Ensure your phone and computer are on the same Wi-Fi. The app uses your computer's LAN IP.
*   **"Degraded" Prediction Mode:** This happens if the ML model crashes. Check the Backend Terminal logs for Python errors.
