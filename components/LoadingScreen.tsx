/**
 * Loading screen component with skeleton UI
 */
import React from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { SpinnerIcon } from './icons';

interface LoadingScreenProps {
  message?: string;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ message = 'Loading...' }) => {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#059669" />
      <View style={styles.spinnerContainer}>
        <SpinnerIcon width={32} height={32} color="#059669" />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
  },
  spinnerContainer: {
    marginTop: 16,
  },
});
