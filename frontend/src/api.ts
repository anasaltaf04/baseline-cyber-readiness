import type { Answer, Profile, Report } from './types';

/**
 * CloudFront serves the API from this same origin, so there is no base URL to
 * configure and no cross-origin request for the browser to make.
 */
const BASE = '';

export class ApiError extends Error {
  readonly status: number;
  readonly details: string[];

  constructor(message: string, status: number, details: string[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function parseError(response: Response): Promise<ApiError> {
  let message = 'Something went wrong. Please try again.';
  let details: string[] = [];
  try {
    const body = await response.json();
    if (body?.error?.message) message = body.error.message;
    if (Array.isArray(body?.error?.details)) details = body.error.details;
  } catch {
    // A non-JSON error body is not worth surfacing; the default is friendlier.
  }
  return new ApiError(message, response.status, details);
}

export async function createAssessment(
  answers: Record<string, Answer>,
  profile: Profile,
): Promise<Report> {
  // Generating the plan involves a model call, so allow well over the
  // Lambda's own 30-second ceiling before giving up on the browser side.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  try {
    const response = await fetch(`${BASE}/assessments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        Object.keys(profile).length ? { answers, profile } : { answers },
      ),
      signal: controller.signal,
    });
    if (!response.ok) throw await parseError(response);
    return (await response.json()) as Report;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('This is taking longer than expected.', 0);
    }
    throw new ApiError('We could not reach the server. Check your connection.', 0);
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchAssessment(id: string): Promise<Report> {
  try {
    const response = await fetch(`${BASE}/assessments/${encodeURIComponent(id)}`);
    if (!response.ok) throw await parseError(response);
    return (await response.json()) as Report;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('We could not reach the server. Check your connection.', 0);
  }
}
