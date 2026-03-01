export default ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
    OPENAI_API_KEY: process.env.EXPO_PUBLIC_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "",
    OPENAI_MODEL: process.env.EXPO_PUBLIC_OPENAI_MODEL || "gpt-3.5-turbo",
    GEMINI_API_KEY: process.env.EXPO_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "",
    GEMINI_MODEL: process.env.EXPO_PUBLIC_GEMINI_MODEL || "gemini-1.5-flash"
  }
});
