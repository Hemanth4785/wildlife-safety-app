# React Native Conversion Guide

This document outlines the conversion from the web application to React Native.

## Completed Components

✅ **Core Infrastructure:**
- Package.json updated with React Native dependencies
- AsyncStorage utility created (replaces localStorage)
- Icons converted to React Native SVG format
- App.tsx converted to React Native
- BottomNav converted
- LoginView converted
- Dashboard converted
- useAnimalData hook updated to use AsyncStorage and React Native Geolocation

## Remaining Components to Convert

### High Priority

1. **MapView** (components/MapView.tsx)
   - **Status**: Needs complete rewrite
   - **Changes Required:**
     - Replace `react-leaflet` with `react-native-maps`
     - Replace Leaflet MapContainer, TileLayer, Marker, Polyline, Circle with React Native Maps equivalents
     - Convert all map-related components to use React Native Maps API
     - Update map styling and interactions
     - Replace HTML popups with React Native Modals or custom components
   - **Key Dependencies**: `react-native-maps`

2. **GuideView** (components/GuideView.tsx)
   - Convert HTML form elements to React Native TextInput, TouchableOpacity
   - Replace CSS classes with StyleSheet
   - Update chat interface to use ScrollView and FlatList

3. **ReportsView** (components/ReportsView.tsx)
   - Convert form inputs to React Native components
   - Replace HTML tables/lists with FlatList
   - Update styling

4. **ProfileView** (components/ProfileView.tsx)
   - Convert form elements
   - Update avatar selection
   - Replace styling

### Medium Priority

5. **OnboardingGuide** (components/OnboardingGuide.tsx)
   - Convert to React Native screens
   - Update navigation
   - Replace styling

6. **AnimalDetailModal** (components/AnimalDetailModal.tsx)
   - Convert to React Native Modal component
   - Update styling

7. **AvatarSelectionModal** (components/AvatarSelectionModal.tsx)
   - Convert to React Native Modal
   - Update grid layout

8. **PredictionPanel** (components/PredictionPanel.tsx)
   - Convert to React Native components
   - Update styling

## Key Conversion Patterns

### HTML to React Native

```typescript
// Web
<div className="container">
  <button onClick={handleClick}>Click</button>
</div>

// React Native
<View style={styles.container}>
  <TouchableOpacity onPress={handleClick}>
    <Text>Click</Text>
  </TouchableOpacity>
</View>
```

### CSS to StyleSheet

```typescript
// Web (Tailwind)
<div className="p-4 bg-white rounded-lg shadow">

// React Native
<View style={styles.card}>
// styles:
const styles = StyleSheet.create({
  card: {
    padding: 16,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
});
```

### Forms

```typescript
// Web
<input type="text" value={value} onChange={(e) => setValue(e.target.value)} />

// React Native
<TextInput
  value={value}
  onChangeText={setValue}
  style={styles.input}
/>
```

### Lists

```typescript
// Web
<ul>
  {items.map(item => <li key={item.id}>{item.name}</li>)}
</ul>

// React Native
<FlatList
  data={items}
  keyExtractor={(item) => item.id}
  renderItem={({ item }) => <Text>{item.name}</Text>}
/>
```

## Installation Steps

1. Install dependencies:
```bash
npm install
# or
yarn install
```

2. For iOS:
```bash
cd ios && pod install && cd ..
```

3. Run the app:
```bash
# iOS
npm run ios

# Android
npm run android
```

## Environment Variables

Create a `.env` file in the root directory:
```
GEMINI_API_KEY=your_api_key_here
```

## Notes

- All `localStorage` calls have been replaced with AsyncStorage
- `navigator.geolocation` has been replaced with `@react-native-community/geolocation`
- Leaflet maps need to be replaced with `react-native-maps`
- All CSS/Tailwind classes need to be converted to StyleSheet
- Modal components should use React Native's `Modal` component
- Navigation can be enhanced with React Navigation if needed

## MapView Conversion Notes

The MapView component is the most complex conversion. Key points:

1. Use `react-native-maps` MapView component
2. Replace Leaflet markers with MapView.Marker
3. Replace Polyline with MapView.Polyline
4. Replace Circle with MapView.Circle
5. Use custom callouts instead of Leaflet popups
6. Update map controls and interactions for mobile

Example:
```typescript
import MapView, { Marker, Polyline } from 'react-native-maps';

<MapView
  style={styles.map}
  region={region}
  onRegionChange={setRegion}
>
  <Marker coordinate={coordinate} />
  <Polyline coordinates={path} />
</MapView>
```
