import axios from 'axios';
import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
let accessTokenCache: string | null = null;

supabase.auth.getSession().then(({ data }) => {
  accessTokenCache = data.session?.access_token ?? null;
}).catch(() => {
  accessTokenCache = null;
});

supabase.auth.onAuthStateChange((_event, session) => {
  accessTokenCache = session?.access_token ?? null;
});

const api = axios.create({
  baseURL: `${API_URL}/api`,
});

// Attach auth token to every request
api.interceptors.request.use(async (config) => {
  let token = accessTokenCache;
  if (!token) {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token ?? null;
    accessTokenCache = token;
  }
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
