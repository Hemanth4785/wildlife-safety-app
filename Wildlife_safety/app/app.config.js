const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

module.exports = ({ config }) => {
  // Priority: .env / shell → EAS env → app.json placeholder (never commit real keys in app.json)
  const googleMapsAndroidKey =
    process.env.GOOGLE_MAPS_ANDROID_API_KEY ||
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY ||
    config.android?.config?.googleMaps?.apiKey ||
    "AIzaSyDummyKeyForNativeInitializationOnly";

  return {
    ...config,
    android: {
      ...config.android,
      config: {
        ...(config.android?.config || {}),
        googleMaps: {
          ...(config.android?.config?.googleMaps || {}),
          apiKey: googleMapsAndroidKey,
        },
      },
    },
    extra: {
      ...config.extra,
      NODE_ENV: process.env.NODE_ENV || "development",
      API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL || "https://wildlife-safety-api.onrender.com",
      ML_SERVICE_URL: process.env.EXPO_PUBLIC_ML_SERVICE_URL || "https://wildlife-safety-app-1.onrender.com",
      OPENAI_API_KEY: process.env.EXPO_PUBLIC_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "",
      OPENAI_MODEL: process.env.EXPO_PUBLIC_OPENAI_MODEL || "gpt-3.5-turbo",
      GEMINI_API_KEY: process.env.EXPO_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "",
      GEMINI_MODEL: process.env.EXPO_PUBLIC_GEMINI_MODEL || "gemini-1.5-flash",
    },
  };
};
