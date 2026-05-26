import { useReducer, useContext, createContext } from './react.js';

export const AppContext = createContext(null);

export const initialState = {
  view: 'upload',
  ready: false,
  toast: null,
  pendingReview: null,
  batchQueue: [],
  batchStats: null,
  refreshKey: 0,
  helpAnchor: null,
  previousView: null
};

export function reducer(state, action) {
  switch (action.type) {
    case 'SET_READY':       return { ...state, ready: true, view: action.view || state.view };
    case 'SET_VIEW':        return { ...state, previousView: state.view, view: action.view || state.view, helpAnchor: action.anchor || null };
    case 'TOAST':           return { ...state, toast: action.toast };
    case 'CLEAR_TOAST':     return { ...state, toast: null };
    case 'SET_REVIEW':      return { ...state, pendingReview: action.payload, view: 'review' };
    case 'CLEAR_REVIEW':    return { ...state, pendingReview: null };
    case 'SET_BATCH':       return { ...state, batchQueue: action.queue, batchStats: action.stats };
    case 'BATCH_ADVANCE':   return { ...state, batchQueue: state.batchQueue.slice(1) };
    case 'CLEAR_BATCH':     return { ...state, batchQueue: [], batchStats: null };
    case 'REFRESH':         return { ...state, refreshKey: state.refreshKey + 1 };
    default: return state;
  }
}

export function useApp() { return useContext(AppContext); }
