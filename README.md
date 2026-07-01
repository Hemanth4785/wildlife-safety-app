## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Python Environment Setup

This project uses Python for backend data fetching and ML prediction. To set up the environments:

1. **Backend Environment (`gbif_env`)**:
   Required for fetching data from GBIF/iNaturalist.
   ```bash
   python -m venv gbif_env
   # Windows
   .\gbif_env\Scripts\activate
   # Mac/Linux
   source gbif_env/bin/activate
   
   pip install -r backend/python/requirements.txt
   ```

2. **ML Environment (`lstm_env`)**:
   Required for LSTM movement prediction and Random Forest risk classification.
   **IMPORTANT:** Must use **Python 3.10** for TensorFlow compatibility.
   ```bash
   py -3.10 -m venv lstm_env
   # Windows
   .\lstm_env\Scripts\activate
   # Mac/Linux
   source lstm_env/bin/activate
   
   pip install -r ml/requirements.txt
   ```

## Detailed Run Guide

For step-by-step operational instructions (including data fetching and model training), please read [RUN_INSTRUCTIONS.md](RUN_INSTRUCTIONS.md).
