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
      // GEMINI / Google GenAI temporarily disabled — use mock placeholders only.
      // GEMINI_API_KEY: process.env.GEMINI_API_KEY || process.env.EXPO_PUBLIC_GEMINI_API_KEY || "",
      API_BASE_URL: "http://192.168.0.102:3000"
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
