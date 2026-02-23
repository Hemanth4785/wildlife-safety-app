export default {
  expo: {
    name: "Wildlife Safety",
    slug: "wildlife-safety",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "light",
    splash: {
      image: "./assets/splash.png",
      resizeMode: "contain",
      backgroundColor: "#059669"
    },
    assetBundlePatterns: [
      "**/*"
    ],
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.wildlifesafety.app"
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#059669"
      },
      package: "com.wildlifesafety.app",
      usesCleartextTraffic: true
    },
    web: {
      favicon: "./assets/favicon.png"
    },
    extra: {
      API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL || "http://10.211.106.199:3000",
      OPENAI_API_KEY: process.env.EXPO_PUBLIC_OPENAI_API_KEY || process.env.OPENAI_API_KEY || "",
      OPENAI_MODEL: process.env.EXPO_PUBLIC_OPENAI_MODEL || "gpt-3.5-turbo",
      GEMINI_API_KEY: process.env.EXPO_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY || "",
      GEMINI_MODEL: process.env.EXPO_PUBLIC_GEMINI_MODEL || "gemini-1.5-flash"
    },
    plugins: [
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission: "Allow Wildlife Safety to use your location to provide safe route predictions."
        }
      ],
      "expo-secure-store"
    ]
  }
};
