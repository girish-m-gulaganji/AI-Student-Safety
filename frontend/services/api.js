import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { emitAuthLogout } from "../utils/authEvents";

const API_BASE = "http://10.79.83.100:5000/api";
console.log("API_BASE resolved to", API_BASE);

const API = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
  timeout: 10000,
});

// Attach token from AsyncStorage key APP_USER_V1
API.interceptors.request.use(async (config) => {
  try {
    const raw = await AsyncStorage.getItem("APP_USER_V1");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.token) {
        config.headers["Authorization"] = `Bearer ${parsed.token}`;
        console.log("API: attaching token to request");
      } else {
        console.log("API: no token found in storage");
      }
    }
  } catch (e) {
    // ignore
  }
  return config;
});

// Auto logout on 401
API.interceptors.response.use(
  (res) => res,
  async (error) => {
    const status = error?.response?.status;
    console.warn(
      "API response error",
      status,
      error?.response?.data || error?.message || error
    );
    if (status === 401) {
      try {
        await AsyncStorage.removeItem("APP_USER_V1");
      } catch {}
      emitAuthLogout();
    }
    return Promise.reject(error);
  }
);

// ----------- Auth helpers -------------
export const register = (data) =>
  API.post("/auth/register", {
    name: data.name,
    email: data.email,
    password: data.password,
  });

export const login = (data) =>
  API.post("/auth/login", { email: data.email, password: data.password });

// ----------- Emergency contacts helpers -------------
export const getEmergencyContacts = () => API.get("/emergency-contacts");

export const addEmergencyContact = (data) =>
  API.post("/emergency-contacts/add", data);

export const deleteEmergencyContact = (contactId) =>
  API.delete(`/emergency-contacts/${contactId}`);

// ----------- Misc helpers -------------
export const updateToken = (data) =>
  API.post("/users/update-token", {
    userId: data.userId,
    deviceToken: data.deviceToken,
    location: data.location || null,
  });

export const createAlert = (data) => API.post("/alerts/create", data);

export const getAlerts = () => API.get("/alerts/list");

export default API;
