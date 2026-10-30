import { lazy } from 'react';

// Loaded on first open: the card fetches statistics and friends, which seats and lists never need.
export const LazyPlayerCard = lazy(() => import('./PlayerCard').then((module) => ({ default: module.PlayerCard })));
