import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import AsyncStorage from '@react-native-community/async-storage';

import HomeScreen from './src/screens/HomeScreen';
import ScannerScreen from './src/screens/ScannerScreen';
import BlendDetailScreen from './src/screens/BlendDetailScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

/**
 * Home stack navigator
 */
const HomeStackNavigator = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: '#8B4513' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: 'bold' },
      }}
    >
      <Stack.Screen
        name="HomeList"
        component={HomeScreen}
        options={{ title: 'Trevean Spice Blends' }}
      />
      <Stack.Screen
        name="BlendDetail"
        component={BlendDetailScreen}
        options={{ title: 'Blend Details' }}
      />
    </Stack.Navigator>
  );
};

/**
 * Root App component with navigation
 */
const App: React.FC = () => {
  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      const storedToken = await AsyncStorage.getItem('authToken');
      if (!storedToken) {
        console.log('No auth token found, initializing guest session');
      }
    } catch (error) {
      console.error('Failed to initialize app:', error);
    }
  };

  return (
    <NavigationContainer>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarStyle: { backgroundColor: '#f5f5f5', borderTopColor: '#e0e0e0' },
        }}
      >
        <Tab.Screen
          name="Home"
          component={HomeStackNavigator}
          options={{
            tabBarLabel: 'Blends',
            tabBarIcon: ({ color, size }) => <></>,
          }}
        />
        <Tab.Screen
          name="Scanner"
          component={ScannerScreen}
          options={{
            tabBarLabel: 'Scan NFC',
            tabBarIcon: ({ color, size }) => <></>,
          }}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
};

export default App;
