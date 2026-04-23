/**
 * Centralised application state.
 * Every module that needs shared data imports from here.
 */

export const state = {
  zonesData: {},
  isReadOnly: false,
  authResource: 'auth',
  zoneResource: 'zone',
  suppressUrlUpdate: false,

  /** Vanity NS cache */
  vanityNsGroups: [],
  vanityNsMap: {},

  /** Pending sync data set by calculateDiff */
  pendingSync: null,
};
