<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1TGANIHUWfAkVW3SBq0FCeehUPusIFZhZ

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
   ```bash
   python -m venv lstm_env
   # Windows
   .\lstm_env\Scripts\activate
   # Mac/Linux
   source lstm_env/bin/activate
   
   pip install -r ml/requirements.txt
   ```
