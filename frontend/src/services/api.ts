import axios from 'axios';
import { Location, Route3DHighlight, ParkingSpace, Report, Billboard } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const getParking = async (destination: Location): Promise<ParkingSpace[]> => {
  const response = await api.get(`/parking?destination=${destination.lat},${destination.lng}`);
  if (response.data.success) {
    return response.data.data;
  }
  throw new Error(response.data.error?.message || 'Failed to get parking');
};

export const reserveParking = async (parkingId: string, userId: string, photoUrl?: string) => {
  const response = await api.post('/parking/reserve', {
    parking_id: parkingId,
    user_id: userId,
    photo_url: photoUrl,
  });
  return response.data;
};

export const parkingHeartbeat = async (parkingId: string, userId: string) => {
  const response = await api.post('/parking/heartbeat', {
    parking_id: parkingId,
    user_id: userId,
  });
  return response.data;
};

export const getReports = async (location: Location, radius: number = 1000): Promise<Report[]> => {
  const response = await api.get(`/reports?lat=${location.lat}&lng=${location.lng}&radius=${radius}`);
  if (response.data.success) {
    return response.data.data;
  }
  throw new Error(response.data.error?.message || 'Failed to get reports');
};

export const createReport = async (
  type: string,
  location: Location,
  photoUrl?: string,
  expiresInMinutes?: number
): Promise<Report> => {
  const response = await api.post('/reports', {
    type,
    location,
    photo_url: photoUrl,
    expires_in_minutes: expiresInMinutes,
  });
  if (response.data.success) {
    return response.data.data;
  }
  throw new Error(response.data.error?.message || 'Failed to create report');
};

export const getBillboards = async (location: Location, radius: number = 1000): Promise<Billboard[]> => {
  const response = await api.get(`/billboards?lat=${location.lat}&lng=${location.lng}&radius=${radius}`);
  if (response.data.success) {
    return response.data.data;
  }
  throw new Error(response.data.error?.message || 'Failed to get billboards');
};

export const purchaseBillboard = async (
  billboardId: string,
  userId: string,
  adImageUrl: string,
  adTargetUrl: string,
  displayStart: string,
  displayEnd: string
) => {
  const response = await api.post(`/billboards/${billboardId}/purchase`, {
    billboard_id: billboardId,
    user_id: userId,
    ad_image_url: adImageUrl,
    ad_target_url: adTargetUrl,
    display_start: displayStart,
    display_end: displayEnd,
  });
  return response.data;
};

export const getRoute = async (from: Location, to: Location): Promise<Route3DHighlight> => {
  const response = await api.get(`/route?from=${from.lat},${from.lng}&to=${to.lat},${to.lng}`);
  if (response.data.success) {
    return response.data.data;
  }
  throw new Error(response.data.error?.message || 'Failed to get route');
};

