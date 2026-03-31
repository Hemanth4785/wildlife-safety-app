export default ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    NODE_ENV: process.env.NODE_ENV || "development",
    API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL || "https://wildlife-safety-api.onrender.com",
    OPENAI_API_KEY: process.env.EXPO_PUBLIC_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "",
    OPENAI_MODEL: process.env.EXPO_PUBLIC_OPENAI_MODEL || "gpt-3.5-turbo",
    GEMINI_API_KEY: process.env.EXPO_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "",
    GEMINI_MODEL: process.env.EXPO_PUBLIC_GEMINI_MODEL || "gemini-1.5-flash"
  }
});
