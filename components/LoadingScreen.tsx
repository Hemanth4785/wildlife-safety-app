/**
 * Full-screen loading. Used for app init, backend health check.
 */
import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';

interface LoadingScreenProps {
  message?: string;
  showRetryButton?: boolean;
  onRetry?: () => void;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ 
  message = 'Loading...', 
  showRetryButton = false, 
  onRetry 
}) => {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#059669" />
      <Text style={styles.message}>{message}</Text>
      {showRetryButton && onRetry && (
        <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
          <Text style={styles.retryText}>Retry Connection</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    padding: 20,
  },
  message: {
    marginTop: 16,
    fontSize: 16,
    color: '#374151',
    fontWeight: '500',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 24,
    backgroundColor: '#059669',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.41,
  },
  retryText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 16,
  },
});
