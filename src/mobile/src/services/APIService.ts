/**
 * REST API Service for Trevean backend
 */

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:4000/api/v1';

class APIService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_BASE;
  }

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Fetch detailed blend information by ID
   */
  async fetchBlend(blendId: string) {
    return this.request(`/blends/${blendId}`);
  }

  /**
   * Fetch all available blends
   */
  async fetchBlends(page: number = 1, limit: number = 20) {
    return this.request(`/blends?page=${page}&limit=${limit}`);
  }

  /**
   * Record a scan event in the backend
   */
  async recordScanEvent(blendId: string, tagUid: string, deviceType: string) {
    return this.request('/scans', {
      method: 'POST',
      body: JSON.stringify({ tagUid, blendId, deviceType }),
    });
  }

  /**
   * Fetch recipes for a blend
   */
  async fetchRecipes(blendId: string, page: number = 1, limit: number = 10) {
    return this.request(`/recipes?blendId=${blendId}&page=${page}&limit=${limit}`);
  }

  /**
   * Fetch tag info by UID
   */
  async fetchTag(uid: string) {
    return this.request(`/tags/${uid}`);
  }
}

export default new APIService();
