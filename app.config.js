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
      package: "com.wildlifesafety.app"
    },
    web: {
      favicon: "./assets/favicon.png"
    },
    extra: {
      GEMINI_API_KEY: process.env.GEMINI_API_KEY || process.env.EXPO_PUBLIC_GEMINI_API_KEY || ""
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
